/*
 *  This file is part of jsFractalZoom, Fractal zoomer written in javascript
 *  Copyright (C) 2020, xyzzy@rockingship.org
 *
 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU Affero General Public License as published
 *  by the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU Affero General Public License for more details.
 *
 *  You should have received a copy of the GNU Affero General Public License
 *  along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

"use strict";

function memcpy(dst, dstOffset, src, srcOffset, length) {
	src = src.subarray(srcOffset, srcOffset + length);
	dst.set(src, dstOffset);
}

/*
 * Timing considerations
 *
 * Constructing a frame is a time consuming process that would severely impair the event/messaging queues and vsync.
 * To make the code more responsive, frame constructing is split into 4 phases:
 *
 * - COPY, pre-fill a frame with data from a previous frame.
 * 	The time required depends on window size and magnification factor (zoom speed).
 * 	Times are unstable and can vary between 1 and 15mSec, typically 15mSec
 *
 * - UPDATE, improve quality by recalculating inaccurate pixels
 * 	The time required depends on window size and magnification factor.
 * 	Times are fairly short, typically well under 1mSec.
 * 	In contrast to COPY/PAINT which are called once and take long
 * 	UPDATES are many and take as short as possible to keep the system responsive.
 *
 * - IDLE, wait until animationEndFrameCallback triggers an event (VSYNC)
 *      Waiting makes the event queue maximum responsive.
 *
 * - PAINT, Create RGBA imagedata ready to be written to DOM canvas
 * 	The time required depends on window size and rotation angle.
 * 	Times are fairly stable and can vary between 5 and 15mSec, typically 12mSec.
 *
 * There is also an optional embedded IDLE state. No calculations are performed 2mSec before a vsync,
 * so that the event/message queues are highly responsive to the handling of requestAnimationEndFrame()
 * for worst case situations that a long UPDATE will miss the vsync (animationEndFrameCallback).
 *
 * IDLEs may be omitted if updates are fast enough.
 *
 * There are also 2 sets of 2 alternating buffers, internal pixel data and context2D RGBA data.
 *
 * Read/write time diagram: R=Read, W=write, I=idle, rAF=requestAnimationEndFrame, AF=animationEndFrameCallback
 *
 *               COPY0  UPDATE0     COPY1  UPDATE1     COPY2  UPDATE2     COPY0  UPDATE0     COPY1  UPDATE1
 * pixel0:      <--W--> WWWWIIWWWW <--R-->                               <--W--> WWWWIIWWWW <--R-->
 * worker0                                <----paint---->                                          <----paint---->
 * pixel1:                         <--W--> WWWWIIWWWW <--R-->                               <--W--> WWWWIIWWWW
 * worker1                                                   <----paint---->
 * pixel2:      <--R-->                               <--W--> WWWWIIWWWW <--R-->
 * worker2             <----paint---->                                          <----paint---->
 *                 ^rAF               ^rAF               ^rAF               ^rAF               ^rAF
 *                    ^AF imagedata2     ^AF imagedata0      ^AF imagedata1     ^AF imagedata2     ^AF imagedata0
 */

/**
 * Set the center coordinate and radius.
 *
 * @callback Calculator
 * @param {float}   x	- Center x of view
 * @param {float}   y	- Center y or view
 * @return {int} - RGBA value for pixel
 */

/**
 * Frame, used to transport data between workers
 *
 * NOTE: data only, do not include functions to minimize transport overhead
 *
 * @class
 * @param {int}   viewWidth   - Screen width (pixels)
 * @param {int}   viewHeight  - Screen height (pixels)
 */
function Frame(viewWidth, viewHeight) {

	/** @member {number} - start of round-trip */
	this.now = 0;
	/** @member {number} - duration in worker (not full round-reip) */
	this.msec = 0;

	/** @member {int}
	    @description Display width (pixels) */
	this.viewWidth = viewWidth;

	/** @member {int}
	    @description display diameter (pixels) */
	this.viewHeight = viewHeight;

	/** @member {number} - height */
	this.diameter = Math.ceil(Math.sqrt(viewWidth * viewWidth + viewHeight * viewHeight));

	/** @member {float}
	    @description Rotational angle (degrees) */
	this.angle = 0;

	/** @member {ArrayBuffer}
	    @description Canvas pixel buffer (UINT8x4) */
	this.rgbaBuffer = new ArrayBuffer(viewWidth * viewHeight * 4);

	/** @member {ArrayBuffer}
	    @description Pixels (UINT16) */
	this.pixelBuffer = new ArrayBuffer(this.diameter * this.diameter * 2);

	/** @member {ArrayBuffer}
	    @description Worker RGBA palette (UINT8*4) */
	this.paletteBuffer = new ArrayBuffer(65536 * 4);
}

/**
 * Extract rotated viewport from pixels and store them in specified imagedata
 * The pixel data is palette based, the imagedata is RGB
 *
 * @param {Frame} frame
 */
function renderFrame(frame) {

	frame.durationRender = performance.now();

	// typed wrappers for Arrays
	const rgba = new Uint32Array(frame.rgbaBuffer);
	const pixels16 = new Uint16Array(frame.pixelBuffer);
	const palette32 = new Uint32Array(frame.paletteBuffer);

	/**
	 **!
	 **! The following loop is a severe performance hit
	 **!
	 **/

	const {viewWidth, viewHeight, diameter, angle} = frame;

	if (angle === 0) {

		// FAST extract viewport
		let i = (diameter - viewWidth) >> 1;
		let j = (diameter - viewHeight) >> 1;

		// copy pixels
		let ji = j * diameter + i;
		let vu = 0;

		if (palette32) {
			// Palette translated
			for (let v = 0; v < viewHeight; v++) {
				for (let u = 0; u < viewWidth; u++)
					rgba[vu++] = palette32[pixels16[ji++]];
				ji += diameter - viewWidth;
			}
		} else if (diameter === viewWidth) {
			// 1:1
			memcpy(rgba, vu, pixels16, ji, viewWidth * viewHeight)
		} else {
			// cropped
			for (let v = 0; v < viewHeight; v++) {
				memcpy(rgba, vu, pixels16, ji, viewWidth);
				vu += viewWidth;
				ji += viewWidth;

				ji += diameter - viewWidth;
			}
		}

	} else {

		// SLOW viewport rotation
		const rsin = Math.sin(angle * Math.PI / 180); // sine for viewport angle
		const rcos = Math.cos(angle * Math.PI / 180); // cosine for viewport angle
		const xstart = Math.floor((diameter - viewHeight * rsin - viewWidth * rcos) * 32768);
		const ystart = Math.floor((diameter - viewHeight * rcos + viewWidth * rsin) * 32768);
		const ixstep = Math.floor(rcos * 65536);
		const iystep = Math.floor(rsin * -65536);
		const jxstep = Math.floor(rsin * 65536);
		const jystep = Math.floor(rcos * 65536);

		// copy pixels
		let vu = 0;
		for (let j = 0, x = xstart, y = ystart; j < viewHeight; j++, x += jxstep, y += jystep) {
			for (let i = 0, ix = x, iy = y; i < viewWidth; i++, ix += ixstep, iy += iystep) {
				rgba[vu++] = palette32[pixels16[(iy >> 16) * diameter + (ix >> 16)]];
			}
		}
	}

	frame.durationRender = performance.now() - frame.durationRender;
}

/**
 * Viewport to the fractal world.
 *
 * @class
 * @param {int}   viewWidth   - Screen width (pixels)
 * @param {int}   viewHeight  - Screen height (pixels)
 */
function Viewport(viewWidth, viewHeight) {

	/** @member {number} - width of viewport */
	this.viewWidth = viewWidth;
	/** @member {number} - height of viewport */
	this.viewHeight = viewHeight;
	/** @member {number} - diameter of the pixel data */
	this.diameter = Math.ceil(Math.sqrt(this.viewWidth * this.viewWidth + this.viewHeight * this.viewHeight));
	/** @member {Uint16Array} - pixel data (must be square) */
	this.pixels16 = undefined;

	/*
	 * Visual center
	 */

	/** @var {float}
	    @description Center X coordinate - vsync updated */
	this.centerX = 0;

	/** @var {float}
	    @description Center Y coordinate - vsync updated */
	this.centerY = 0;

	/** @var {float}
	    @description Distance between center and viewport corner - vsync updated */
	this.radius = 0;

	/** @member {number} - distance between center and horizontal viewport edge (derived from this.radius) */
	this.radiusX = 0;
	/** @member {number} - distance between center and vertical viewport edge  (derived from this.radius) */
	this.radiusY = 0;

	/*
	 * Rulers
	 */

	/** @var {Float64Array}
	    @description Logical x coordinate, what it should be */
	this.xCoord = new Float64Array(this.diameter);

	/** @var {Float64Array}
	    @description Physical x coordinate, the older there larger the drift */
	this.xNearest = new Float64Array(this.diameter);

	/** @var {Float64Array}
	    @description Cached distance between Logical/Physical */
	this.xError = new Float64Array(this.diameter);

	/** @var {Int32Array}
	    @description Inherited index from previous update */
	this.xFrom = new Int32Array(this.diameter);

	/** @var {Float64Array}
	    @description Logical y coordinate, what it should be */
	this.yCoord = new Float64Array(this.diameter);

	/** @var {Float64Array}
	    @description Physical y coordinate, the older there larger the drift */
	this.yNearest = new Float64Array(this.diameter);

	/** @var {Float64Array}
	    @description Cached distance between Logical/Physical */
	this.yError = new Float64Array(this.diameter);

	/** @var {Int32Array}
	    @description Inherited index from previous update */
	this.yFrom = new Int32Array(this.diameter);

	/*
	 * Statistics
	 */
	Viewport.doneX = 0;
	Viewport.doneY = 0;
	Viewport.doneCalc = 0;

	/**
	 *
	 * @param {number} start - start coordinate
	 * @param {number} end - end coordinate
	 * @param {Float64Array} newCoord - coordinate stops
	 * @param {Float64Array} newNearest - nearest evaluated coordinate stop
	 * @param {Float64Array} newError - difference between newCoord[] and newNearest[]
	 * @param {Uint16Array} newFrom - matching oldNearest[] index
	 * @param {Float64Array} oldNearest - source ruler
	 * @param {Float64Array} oldError - source ruler
	 */
	this.makeRuler = (start, end, newCoord, newNearest, newError, newFrom, oldNearest, oldError) => {

		/*
		 *
		 */
		let iOld, iNew;
		for (iOld = 0, iNew = 0; iNew < newCoord.length && iOld < oldNearest.length; iNew++) {

			// determine coordinate current tab stop
			const currCoord = (end - start) * iNew / (newCoord.length - 1) + start;

			// determine errors
			let currError = Math.abs(currCoord - oldNearest[iOld]);
			let nextError = Math.abs(currCoord - oldNearest[iOld + 1]);

			// bump if next source stop is better
			while (nextError <= currError && iOld < oldNearest.length - 1) {
				iOld++;
				currError = nextError;
				nextError = Math.abs(currCoord - oldNearest[iOld + 1]);
			}

			// populate
			newCoord[iNew] = currCoord;
			newNearest[iNew] = oldNearest[iOld];
			newError[iNew] = currError;
			newFrom[iNew] = iOld;
		}

		// copy the only option
		while (iNew < newCoord.length) {
			newNearest[iNew] = oldNearest[iOld];
			newError[iNew] = Math.abs(newCoord[iNew] - oldNearest[iOld]);
			newFrom[iNew] = iOld;
		}
	};

	/**
	 * Set the center coordinate and radius.
	 * Inherit pixels from oldViewport based on rulers.
	 * Previous viewport/frame may have different dimensions.
	 *
	 * @param {Frame}    frame		- Current frame
	 * @param {float}    centerX		- Center x of view
	 * @param {float}    centerY		- Center y or view
	 * @param {float}    radius		- Radius of view
	 * @param {Viewport} previousViewport	- Previous frame to inherit pixels from
	 */
	this.setPosition = (frame, centerX, centerY, radius, previousViewport) => {

		this.frame = frame;
		this.pixels16 = new Uint16Array(frame.pixelBuffer);

		this.centerX = centerX;
		this.centerY = centerY;
		this.radius = radius;
		this.radiusX = radius * this.viewWidth / this.diameter;
		this.radiusY = radius * this.viewHeight / this.diameter;

		/*
		 * setup new rulers
		 */
		this.makeRuler(this.centerX - this.radius, this.centerX + this.radius, this.xCoord, this.xNearest, this.xError, this.xFrom, previousViewport.xNearest, previousViewport.xError);
		this.makeRuler(this.centerY - this.radius, this.centerY + this.radius, this.yCoord, this.yNearest, this.yError, this.yFrom, previousViewport.yNearest, previousViewport.yError);

		/**
		 **!
		 **! The following loop is a severe performance hit
		 **!
		 **/

		/*
		 * copy/inherit pixels TODO: check oldPixelHeight
		 */
		const xFrom = this.xFrom;
		const yFrom = this.yFrom;
		const newDiameter = this.diameter;
		const oldDiameter = previousViewport.diameter;
		const newPixels16 = this.pixels16;
		const oldPixels16 = previousViewport.pixels16;
		let ji = 0;

		// first line
		let k = yFrom[0] * oldDiameter;
		for (let i = 0; i < newDiameter; i++)
			newPixels16[ji++] = oldPixels16[k + xFrom[i]];

		// followups
		for (let j = 1; j < newDiameter; j++) {
			if (yFrom[j] === yFrom[j - 1]) {
				// this line is identical to the previous
				let k = ji - newDiameter;
				for (let i = 0; i < newDiameter; i++)
					newPixels16[ji++] = newPixels16[k++];

			} else {
				// extract line from previous frame
				let k = yFrom[j] * oldDiameter;
				for (let i = 0; i < newDiameter; i++)
					newPixels16[ji++] = oldPixels16[k + xFrom[i]];
			}
		}

		// keep the froms with lowest error
		for (let i = 1; i < newDiameter; i++) {
			if (xFrom[i - 1] === xFrom[i] && this.xError[i - 1] > this.xError[i])
				xFrom[i - 1] = -1;
			if (yFrom[i - 1] === yFrom[i] && this.yError[i - 1] > this.yError[i])
				yFrom[i - 1] = -1;
		}
		for (let i = newDiameter - 2; i >= 0; i--) {
			if (xFrom[i + 1] === xFrom[i] && this.xError[i + 1] > this.xError[i])
				xFrom[i + 1] = -1;
			if (yFrom[i + 1] === yFrom[i] && this.yError[i + 1] > this.yError[i])
				yFrom[i + 1] = -1;
		}
	};

	/**
	 * Test if rulers have reached resolution limits
	 *
	 * @returns {boolean}
	 */
	this.reachedLimits = () => {
		/*
		 * @date 2020-10-12 18:30:14
		 * NOTE: First duplicate ruler coordinate is sufficient to mark endpoint.
		 *       This to prevent zooming full screen into a single pixel
		 */
		for (let ij = 1; ij < this.diameter; ij++) {
			if (this.xCoord[ij - 1] === this.xCoord[ij] || this.yCoord[ij - 1] === this.yCoord[ij])
				return true;

		}
		return false;
	};

	/**
	 * Simple background renderer
	 *
	 * @param {Calculator} calculate
	 */
	this.renderLines = (calculate) => {

		const {xCoord, xNearest, xError, xFrom, yCoord, yNearest, yError, yFrom} = this;

		// which tabstops have the worst error

		let worstXerr = xError[0];
		let worstXi = 0;
		let worstYerr = yError[0];
		let worstYj = 0;
		const diameter = this.diameter;

		for (let i = 1; i < diameter; i++) {
			if (xError[i] > worstXerr) {
				worstXi = i;
				worstXerr = xError[i];
			}
		}
		for (let j = 1; j < diameter; j++) {
			if (yError[j] > worstYerr) {
				worstYj = j;
				worstYerr = yError[j];
			}
		}

		if (worstXerr + worstYerr === 0)
			return; // nothing to do

		/**
		 **!
		 **! The following loop is a severe performance hit
		 **!
		 **/

		const pixels16 = this.pixels16;

		if (worstXerr > worstYerr) {

			let i = worstXi;
			let x = xCoord[i];

			let ji = 0 * diameter + i;
			let last = calculate(x, yCoord[0]);
			pixels16[ji] = last;
			ji += diameter;
			Viewport.doneCalc++;

			for (let j = 1; j < diameter; j++) {
				/*
				 * Logic would say 'yFrom[j] === -1', but haven't been able to figure out why this works better
				 * ..and 3 other places
				 */
				if (yError[j] === 0 || yFrom[j] !== -1) {
					last = calculate(x, yCoord[j]);
					Viewport.doneCalc++;
				}
				pixels16[ji] = last;
				ji += diameter;
			}

			for (let u = i + 1; u < diameter; u++) {
				if (xError[u] === 0 || xFrom[u] !== -1)
					break;

				for (let v = 0; v < diameter; v++) {
					pixels16[v * diameter + u] = pixels16[v * diameter + i];
				}
			}

			xNearest[i] = x;
			xError[i] = 0;
			Viewport.doneX++;

		} else {

			let j = worstYj;
			let y = yCoord[j];

			let ji = j * diameter + 0;
			let last = calculate(xCoord[0], y);
			pixels16[ji++] = last;
			Viewport.doneCalc++;
			for (let i = 1; i < diameter; i++) {
				if (xError[i] === 0 || xFrom[i] !== -1) {
					last = calculate(xCoord[i], y);
					Viewport.doneCalc++;
				}
				pixels16[ji++] = last;
			}

			for (let v = j + 1; v < diameter; v++) {
				if (yError[v] === 0 || yFrom[v] !== -1)
					break;

				for (let u = 0; u < diameter; u++) {
					pixels16[v * diameter + u] = pixels16[j * diameter + u];
				}
			}

			yNearest[j] = y;
			yError[j] = 0;
			Viewport.doneY++;
		}
	};

	/**
	 *
	 */
	this.fill = () => {

		// NOTE: attached frame will leak and GC
		this.frame = new Frame(this.viewWidth, this.viewHeight);3
		this.pixels16 = new Uint16Array(this.frame.pixelBuffer);

		this.radiusX = this.radius * this.viewWidth / this.diameter;
		this.radiusY = this.radius * this.viewHeight / this.diameter;

		const {xCoord, xNearest, yCoord, yNearest, pixels16, pixelWidth, pixelHeight} = this;

		for (let i = 0; i < xCoord.length; i++)
			xNearest[i] = xCoord[i] = ((this.centerX + this.radius) - (this.centerX - this.radius)) * i / (xCoord.length - 1) + (this.centerX - this.radius);
		for (let i = 0; i < yCoord.length; i++)
			yNearest[i] = yCoord[i] = ((this.centerY + this.radius) - (this.centerY - this.radius)) * i / (yCoord.length - 1) + (this.centerY - this.radius);

		const calculate = Formula.calculate;
		let ji = 0;
		for (let j = 0; j < this.diameter; j++) {
			let y = (this.centerY - this.radius) + this.radius * 2 * j / this.diameter;
			for (let i = 0; i < this.diameter; i++) {
				// distance to center
				let x = (this.centerX - this.radius) + this.radius * 2 * i / this.diameter;
				pixels16[ji++] = calculate(x, y);
			}
		}
	};
}

/**
 *
 * When using angles:
 * The frame must be square and its size must be the diagonal of the viewing area.
 *
 * Viewing direction is the center x,y and radius. Angle is part of `Frame` rendering.
 *
 * @class
 * @param {HTMLCanvasElement}	domZoomer		- Element to detect a resize	 -
 * @param {Object}		[options]   		- Template values for new frames. These may be changed during runtime.
 * @param {float}		[options.frameRate]	- Frames per second
 * @param {float}		[options.updateSlice]	- UPDATEs get sliced into smaller  chucks to stay responsive and limit overshoot
 * @param {float}		[options.coef]		- Low-pass filter coefficient to dampen spikes
 * @param {boolean}		[options.disableWW]	- Disable Web Workers
 * @param {function}		[options.onResize]	- Called when canvas resize detected.
 * @param {function}		[options.onBeginFrame]	- Called before start frame. Set x,y,radius,angle.
 * @param {function}		[options.onRenderFrame]	- Called directly before rendering. Set palette.
 * @param {function}		[options.onEndFrame]	- Called directly after frame complete. Update statistics
 * @param {function}		[options.onPutImageData] - Inject frame into canvas.
 */
function Zoomer(domZoomer, options = {

	/**
	 * DOM element to check for resizes
	 *
	 * @member {Element} - DOM element to check for resizes
	 */
	domZoomer: null,

	/**
	 * Frames per second.
	 * Rendering frames is expensive, too high setting might render more than calculate.
	 *
	 * @member {float} - Frames per second
	 */
	frameRate: 20,

	/**
	 * Update rate in milli seconds used to slice UPDATE state.
	 * Low values keep the event queue responsive.
	 *
	 * @member {float} - Frames per second
	 */
	updateSlice: 2,

	/**
	 * Low-pass coefficient to dampen spikes for averages
	 *
	 * @member {float} - Low-pass filter coefficient to dampen spikes
	 */
	coef: 0.05,

	/**
	 * Disable web-workers.
	 * Offload frame rendering to web-workers
	 *
	 * @member {boolean} - Frames per second
	 */
	disableWW: false,

	/**
	 * Size change detected for `domZoomer`
	 *
	 * @param {Zoomer} zoomer      - This
	 * @param {int}    viewWidth   - Screen width (pixels)
	 * @param {int}    viewHeight  - Screen height (pixels)
	 * @param {int}    pixelWidth  - Storage width (pixels)
	 * @param {int}    pixelHeight - Storage Heignt (pixels)
	 */
	onResize: (zoomer, viewWidth, viewHeight, pixelWidth, pixelHeight) => {
	},

	/**
	 * Start of a new frame.
	 * Process timed updates (piloting), set x,y,radius,angle.
	 *
	 * @param {Zoomer}   zoomer            - This
	 * @param {Viewport} currentViewport   - Current viewport
	 * @param {Frame}    currentFrame      - Current frame
	 * @param {Viewport} previousViewport  - Previous viewport to extract rulers/pixels
	 * @param {Frame}    previousFrame     - Previous frame
	 */
	onBeginFrame: (zoomer, currentViewport, currentFrame, previousViewport, previousFrame) => {
	},

	/**
	 * Start extracting (rotated) RGBA values from (paletted) pixels.
	 * Extract rotated viewport from pixels and store them in specified imnagedata.
	 * Called just before submitting the frame to a web-worker.
	 * Previous frame is complete, current frame is under construction.
	 *
	 * @param {Zoomer}   zoomer        - This
	 * @param {Frame}    previousFrame - Previous frame
	 */
	onRenderFrame: (zoomer, previousFrame) => {
	},

	/**
	 * Frame construction complete. Update statistics.
	 * Frame might be in transit to the web-worker and is not available as parameter.
	 *
	 * @param {Zoomer}   zoomer       - This
	 * @param {Frame}    currentFrame - Current frame
	 */
	onEndFrame: (zoomer, currentFrame) => {
	},

	/**
	 * Inject frame into canvas.
	 * This is a callback to keep all canvas resource handling/passing out of Zoomer context.
	 *
	 * @param {Zoomer}   zoomer - This
	 * @param {Frame}    frame  - Frame to inject
	 */
	onPutImageData: (zoomer, frame) => {

		// get final buffer
		const rgba = new Uint8ClampedArray(frame.rgbaBuffer);
		const imagedata = new ImageData(rgba, frame.viewWidth, frame.viewHeight);

		// draw frame onto canvas
		this.ctx.putImageData(imagedata, 0, 0);
	}

}) {
	/*
	 * defaults
	 */

	/** @member {float}
	    @description UPDATE get sliced in smaler time chucks */
	this.updateSlice = options.updateSlice ? options.updateSlice : 2;

	/** @member {float}
	    @description Damping coefficient low-pass filter for following fields */
	this.coef = options.coef ? options.coef : 0.05;

	/** @member {float}
	    @description Disable Web Workers and perform COPY from main event queue */
	this.disableWW = options.disableWW ? options.disableWW : false;

	/** @member {function}
	    @description `domZoomer` resize detected */
	this.onResize = options.onResize ? options.onResize : undefined;

	/** @member {function}
	    @description Creation of frame. set x,y,radius,angle */
	this.onBeginFrame = options.onBeginFrame ? options.onBeginFrame : undefined;

	/** @member {function}
	    @description Rendering of frame. set palette. */
	this.onRenderFrame = options.onRenderFrame ? options.onRenderFrame : undefined;

	/** @member {function}
	    @description Frame submitted. Statistics. */
	this.onEndFrame = options.onEndFrame ? options.onEndFrame : undefined;

	/** @member {function}
	    @description Inject frame into canvas. */
	this.onPutImageData = options.onPutImageData ? options.onPutImageData : undefined;

	/*
	 * Authoritative Visual center
	 */

	/** @var {float}
	    @description Center X coordinate - vsync updated */
	this.centerX = 0;

	/** @var {float}
	    @description Center Y coordinate - vsync updated */
	this.centerY = 0;

	/** @var {float}
	    @description Distance between center and viewport corner - vsync updated */
	this.radius = 0;

	/** @var {float}
	    @description Current viewport angle (degrees) */
	this.angle = 0;

	/** @member {int}
	    @description Display width (pixels) */
	this.viewWidth = domZoomer.clientWidth;

	/** @member {int}
	    @description display diameter (pixels) */
	this.viewHeight = domZoomer.clientHeight;

	/*
	 * Main state settings
	 */

	/**
	 * @member {number} state
	 * @property {number}  0 STOP
	 * @property {number}  1 COPY
	 * @property {number}  2 RENDER
	 * @property {number}  3 UPDATE
	 * @property {number}  4 PAINT
	 */
	this.state = 0;

	const STOP = 0;
	const COPY = 1;
	const UPDATE = 2;
	const IDLE = 3;

	/** @member {int}
	    @description Current frame number*/
	this.frameNr = 0;

	/** @member {Viewport}
	    @description Viewport #0 for even frames */
	this.viewport0 = new Viewport(this.viewWidth, this.viewHeight);

	/** @member {Viewport}
	    @description Viewport #1 for odd frames*/
	this.viewport1 = new Viewport(this.viewWidth, this.viewHeight);

	/** @member {Viewport}
	    @description Active viewport */
	this.currentViewport = this.viewport0;

	/** @member {Frame[]}
	    @description list of free frames */
	this.frames = [];

	/** @member {Worker[]}
	    @description Web workers */
	this.WWorkers = [];

	/*
	 * Statistics
	 */

	/** @member {int}
	    @description Number of times mainloop called */
	this.mainLoopNr = 0;

	/** @member {int[]}
	    @description Number of times state has been performed */
	this.stateCounters = [0, 0, 0, 0, 0];

	/** @member {float[]}
	    @description average duration of states in milli seconds */
	this.avgStateDuration = [0, 0, 0, 0, 0];

	/** @member {number} - Timestamp next vsync */
	this.vsync = 0;
	/** @member {number} - Average time in mSec spent in COPY */
	this.statStateCopy = 0;
	/** @member {number} - Average time in mSec spent in UPDATE */
	this.statStateUpdate = 0;
	/** @member {number} - Average time in mSec spent in PAINT */
	this.statStatePaint1 = 0;
	this.statStatePaint2 = 0;

	// per second differences
	this.counters = [0, 0, 0, 0, 0, 0, 0];

	/**
	 * Allocate a new frame, reuse if same size otherwise let it garbage collect
	 *
	 * @param {int}   viewWidth   - Screen width (pixels)
	 * @param {int}   viewHeight  - Screen height (pixels)
	 * @param {float} angle       - Angle (degrees)
	 * @return {Frame}
	 */
	this.allocFrame = (viewWidth, viewHeight, angle) => {
		// find frame with matching dimensions
		for (; ;) {
			/** @var {Frame} */
			let frame = this.frames.shift();

			// allocate new if list empty
			if (!frame)
				frame = new Frame(viewWidth, viewHeight);

			// return if dimensions match
			if (frame.viewWidth === viewWidth && frame.viewHeight === viewHeight) {
				frame.frameNr = this.frameNr;
				frame.angle = angle;
				return frame;
			}
		}
	}

	/**
	 * Set the center coordinate and radius.
	 * NOTE: set angle before position
	 *
	 * @param {float}    centerX              - Center x of view
	 * @param {float}    centerY              - Center y or view
	 * @param {float}    radius               - Radius of view
	 * @param {float}    [angle]              - Angle of view
	 * @param {Viewport} [previousViewport]   - Previous viewport to inherit keyFrame rulers/pixels
	 */
	this.setPosition = (centerX, centerY, radius, angle, previousViewport) => {
		this.centerX = centerX;
		this.centerY = centerY;
		this.radius = radius;
		this.angle = angle ? angle : 0;

		// optionally inject keyFrame into current viewport
		if (previousViewport) {
			const frame = this.allocFrame(this.viewWidth, this.viewHeight, this.angle);
			this.currentViewport.setPosition(frame, this.centerX, this.centerY, this.radius, previousViewport);
		}
	};

	/**
	 * start the state machine
	 */
	this.start = () => {
		this.state = COPY;
		this.vsync = performance.now() + (1000 / Config.framerateNow); // vsync wakeup time
		this.statStateCopy = this.statStateUpdate = this.statStatePaint1 = this.statStatePaint2 = 0;
		postMessage("mainloop", "*");
	};

	/**
	 * stop the state machine
	 */
	this.stop = () => {
		this.state = STOP;
	};

	/**
	 * GUI mainloop called by timer event
	 *
	 * @returns {boolean}
	 */
	this.mainloop = () => {
		if (!this.state) {
			// return and don't call again
			return false;
		}
		this.mainloopNr++;

		// make local for speed
		const config = this.config;
		const viewport = (this.frameNr & 1) ? this.viewport1 : this.viewport0;


		// current time
		let last;
		let now = performance.now();

		if (this.vsync === 0 || now > this.vsync + 2000) {
			// Missed vsync by more than 2 seconds, resync
			this.vsync = now + (1000 / Config.framerateNow);
			this.state = COPY;
			console.log("resync");
		}

		if (this.state === UPDATE) {
			/*
			 * UPDATE. calculate inaccurate pixels
			 */
			this.counters[UPDATE]++;
			last = now;

			if (now >= this.vsync - 2) {
				// don't even start if there is less than 2mSec left till next vsync
				this.state = IDLE;
			} else {
				/*
				 * update inaccurate pixels
				 */

				// end time is 2mSec before next vertical sync
				let endtime = this.vsync - 2;
				if (endtime > now + 2)
					endtime = now + 2;

				/*
				 * Calculate lines
				 */

				let numLines = 0;
				while (now < endtime) {
					viewport.renderLines(Formula.calculate);

					now = performance.now();
					numLines++;
				}

				// update stats
				this.statStateUpdate += ((now - last) / numLines - this.statStateUpdate) * this.coef;

				postMessage("mainloop", "*");
				return true;
			}
		}

		if (this.state === IDLE) {
			/*
			 * IDLE. Wait for vsync
			 */
			this.counters[IDLE]++;

			if (now >= this.vsync) {
				// vsync is NOW
				this.state = COPY;
				this.vsync += (1000 / Config.framerateNow); // time of next vsync
			} else {
				postMessage("mainloop", "*");
				return true;
			}
		}

		/**
		 ***
		 *** Start of new cycle
		 ***
		 **/
		this.counters[1]++;
		last = now;

		/*
		 * test for DOM resize
		 */
		if (domZoomer.clientWidth !== this.viewWidth || domZoomer.clientHeight !== this.viewHeight) {

			this.viewWidth = domZoomer.clientWidth;
			this.viewHeight = domZoomer.clientHeight;

			// set property
			domZoomer.width = this.viewWidth
			domZoomer.height = this.viewHeight

			const previousViewport0 = this.viewport0;
			const previousViewport1 = this.viewport1;
			const previousViewport = this.currentViewport;

			// create new viewports
			this.viewport0 = new Viewport(this.viewWidth, this.viewHeight);
			this.viewport1 = new Viewport(this.viewWidth, this.viewHeight);
			this.currentViewport = (this.frameNr & 1) ? this.viewport1 : this.viewport0;

			// copy the contents
			const frame = this.allocFrame(this.viewWidth, this.viewHeight, this.angle);
			this.currentViewport.setPosition(frame, this.centerX, this.centerY, this.radius, previousViewport);

			// TODO: 5 arguments
			if (this.onResize) this.onResize(this, this.currentViewport.viewWidth, this.currentViewport.viewHeight);
		}

		/*
		 * COPY
		 */

		const previousViewport = this.currentViewport;
		const previousFrame = previousViewport.frame;

		this.frameNr++;
		const frame = this.allocFrame(this.viewWidth, this.viewHeight, this.angle);

		this.currentViewport = (this.frameNr & 1) ? this.viewport1 : this.viewport0;
		this.currentViewport.setPosition(frame, this.centerX, this.centerY, this.radius, previousViewport);

		if (this.onBeginFrame) this.onBeginFrame(this, this.currentViewport, this.currentViewport.frame, previousViewport, previousFrame);

		/*
		 * Create palette
		 */
		previousFrame.now = performance.now();

		if (this.onRenderFrame) this.onRenderFrame(this, previousFrame);

		/*
		 * The message queue is overloaded, so call direct until improved design
		 */
		if (!this.disableWW) {
			this.WWorkers[this.frameNr & 3].postMessage(previousFrame, [previousFrame.rgbaBuffer, previousFrame.pixelBuffer, previousFrame.paletteBuffer]);
		} else {
			renderFrame(previousFrame);

			if (this.onPutImageData) this.onPutImageData(this, previousFrame);

			this.statStatePaint1 += ((performance.now() - previousFrame.now) - this.statStatePaint1) * this.coef;
			this.statStatePaint2 += ((previousFrame.msec) - this.statStatePaint2) * this.coef;

			// move request to free list
			this.frames.push(previousFrame);
			previousViewport.frame = undefined;
		}

		/*
		 * update stats
		 */
		now = performance.now();
		this.statStateCopy += ((now - last) - this.statStateCopy) * this.coef;

		if (this.onEndFrame) this.onEndFrame(this);

		this.state = UPDATE;
		postMessage("mainloop", "*");
		return true;
	};

	/**
	 * Use message queue as highspeed queue handler. SetTimeout() is throttled.
	 *
	 * @param {message} event
	 */
	this.handleMessage = (event) => {
		if (event.source === window && event.data === "mainloop") {
			event.stopPropagation();
			this.mainloop();
		}
	};

	/*
	 * create 2 workers
	 */

	if (this.disableWW) {
		let dataObj = "( function () { \n";
		dataObj += memcpy;
		dataObj += "\n";
		dataObj += renderFrame;
		dataObj += "\n";
		dataObj += "addEventListener(\"message\", (e) => { \n";
		dataObj += "const frame = e.data;\n";
		dataObj += "renderFrame(frame);\n";
		dataObj += "postMessage(frame, [frame.rgbaBuffer, frame.pixelBuffer, frame.paletteBuffer]);\n";
		dataObj += "})})\n";

		const blob = new Blob([dataObj]);
		const blobURL = (URL ? URL : webkitURL).createObjectURL(blob);

		// create workers
		for (let i = 0; i < 2; i++) {
			this.WWorkers[i] = new Worker(blobURL);

			this.WWorkers[i].addEventListener("message", (e) => {
				/** @var {Frame} */
				const frame = e.data;

				// perform PAINT

				const stime = performance.now();

				if (this.onPutImageData) this.onPutImageData(this, frame);

				// stastics
				const etime = performance.now();

				this.avgFrameConstruct += (frame.durationConstruct - this.avgFrameConstruct) * this.coef;
				this.avgFrameRender += (frame.durationRender - this.avgFrameRender) * this.coef;
				this.avgFrameRoundTrip += (frame.durationRoundTrip - this.avgFrameRoundTrip) * this.coef;

				// return frame to free pool
				this.frames.push(frame);

				this.avgCycleDuration += ((etime - this.imeStart[COPY]) - this.avgCycleDuration) * this.coef;

				this.avgStateDuration[0] += (frame.durationRender - this.avgStateDuration[0]) * this.coef;
				this.avgStateDuration[PAINT] += ((etime - stime) - this.avgStateDuration[PAINT]) * this.coef;

				this.onEndFrame(this);
			});
		}
	}
}
