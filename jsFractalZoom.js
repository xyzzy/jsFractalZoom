/*
 * Globals settings and values
 *
 * @constructor
 */
function Config() {
	this.power = true;
	this.autoPilot = false;
	this.speed = 0;
	this.rotateSpeed = 0;
	this.rotateIncrement = 0.2; // angle increment
	this.offsetSpeed = 0;
	this.offsetImcrement = 0.1; // cycle increment
	this.depth = 0;
	this.framerate = 0;
	this.formula = '';
	this.incolour = '';
	this.outcolour = '';
	this.plane = '';
	this.width = 1;
	this.height = 1;

	this.offset = 0; // color palette cycle timer updated
	this.angle = 0; // viewport angle timer updated

	this.msecPerFrame = 1000 / this.framerate;
	this.rsin = Math.sin(this.angle * Math.PI / 180);
	this.rcos = Math.cos(this.angle * Math.PI / 180);
}

/**
 * Set rotation angle
 *
 * @param {number} angle - range -1.0 to +1.0
 */
Config.prototype.setAngle = function(angle) {
	this.angle = angle;
	this.rsin = Math.sin(angle * Math.PI / 180);
	this.rcos = Math.cos(angle * Math.PI / 180);
};

/**
 * Set colour palette cycle offset
 *
 * @param {number} offset - range -1.0 to +1.0
 */
Config.prototype.setOffset = function(offset) {
	this.offset = offset;
};

/**
 * DOM bindings and event handlers
 *
 * @constructor
 * @param config {Config}
 */
function GUI(config) {
	/** @type {Config} - Reference to config object */
	this.config = config;

	/*
	 * DOM elements and their matching id's
	 */
	this.domMain = 'main';
	this.domStatusQuality = 'idStatusQuality';
	this.domStatusLoad = 'idStatusLoad';
	this.domStatusRect = 'idStatusRect';
	this.domPowerButton = 'idPowerButton';
	this.domAutoPilotButton = 'idAutoPilotButton';
	this.domHomeButton = 'idHomeButton';
	this.domFormulaButton = 'idFormulaButton';
	this.domFormulaList = 'idFormulaList';
	this.domIncolourButton = 'idIncolourButton';
	this.domIncolourList = 'idIncolourList';
	this.domOutcolourButton = 'idOutcolourButton';
	this.domOutcolourList = 'idOutcolourList';
	this.domPlaneButton = 'idPlaneButton';
	this.domPlaneList = 'idPlaneList';
	this.domSpeedLeft = 'idSpeedLeft';
	this.domSpeedRail = 'idSpeedRail';
	this.domSpeedThumb = 'idSpeedThumb';
	this.domRotateLeft = 'idRotateLeft';
	this.domRotateRail = 'idRotateRail';
	this.domRotateThumb = 'idRotateThumb';
	this.domCycleLeft = 'idCycleLeft';
	this.domCycleRail = 'idCycleRail';
	this.domCycleThumb = 'idCycleThumb';
	this.domRandomPaletteButton = 'idRandomPaletteButton';
	this.domDefaultPaletteButton = 'idDefaultPaletteButton';
	this.domDepthLeft = 'idDepthLeft';
	this.domDepthRail = 'idDepthRail';
	this.domDepthThumb = 'idDepthThumb';
	this.domFramerateLeft = 'idFramerateLeft';
	this.domFramerateRail = 'idFramerateRail';
	this.domFramerateThumb = 'idFramerateThumb';
	this.domWxH = 'WxH';

	/** @type {number} - Main loop timer id */
	this.timerId = 0;
	/** @type {number} - Timestamp next vblank */
	this.vblank = 0;
	/** @type {number} - Number of frames painted */
	this.frameNr = 0;
	/** @type {number} - Number of scanlines calculated for current frame */
	this.numLines = 0;

	/** @type {number} - Damping coefficient low-pass filter for following fields */
	this.coef = 0.05;
		/** @type {number} - Average time in mSec spent in stage1 (Draw) */
	this.statState1 = 0;
	/** @type {number} - Average time in mSec spent in stage2 (Zoom) */
	this.statState2 = 0;
	/** @type {number} - Average time in mSec spent in stage3 (Lines) */
	this.statState3 = 0;
	// per second differences
	this.mainloopNr = 0;
	this.lastNow = 0;
	this.lastFrame = 0;
	this.lastLoop = 0;


	/** @type {Uint8Array} - temporary red palette after rotating palette index */
	this.tmpRed = new Uint8Array(256);
	/** @type {Uint8Array} - temporary red palette after rotating palette index */
	this.tmpGreen = new Uint8Array(256);
	/** @type {Uint8Array} - temporary red palette after rotating palette index */
	this.tmpBlue = new Uint8Array(256);

	/** @type {number} - width of viewport */
	this.viewWidth = undefined;
	/** @type {number} - height of viewport */
	this.viewHeight = undefined;
	/** @type {number} - diameter of the pixel data */
	this.diameter = undefined;
	/** @type {Uint8Array} - pixel data (must be square) */
	this.pixels = undefined;
	/** @type {CanvasRenderingContext2D} */
	this.ctx = undefined;
	/** @type {ImageData} - direct access to canvas pixel data */
	this.imagedata1 = undefined;
	/** @type {ImageData} - direct access to canvas pixel data */
	this.imagedata2 = undefined;

	/*
	 * Find the elements and replace the string names for DOM references
	 */
	for (var property in this) {
		if (this.hasOwnProperty(property) && property.substr(0,3) === 'dom') {
			this[property] = document.getElementById(this[property]);
		}
	}

	// init viewport
	this.setViewport(this.domMain);

	// initial palette
	this.paletteRed = [230, 135, 75, 254, 255, 246, 223, 255, 255, 197, 255, 255, 214, 108, 255, 255];
	this.paletteGreen = [179, 135, 75, 203, 244, 246, 223, 212, 224, 146, 235, 247, 214, 108, 255, 255];
	this.paletteBlue = [78, 135, 75, 102, 142, 246, 223, 111, 123, 45, 133, 145, 214, 108, 153, 255];
	// grayscale
	this.paletteRed = [0x00,0x10,0x20,0x30,0x40,0x50,0x60,0x70,0x80,0x90,0xa0,0xb0,0xc0,0xd0,0xe0,0xf0];
	this.paletteGreen = [0x00,0x10,0x20,0x30,0x40,0x50,0x60,0x70,0x80,0x90,0xa0,0xb0,0xc0,0xd0,0xe0,0xf0];
	this.paletteBlue = [0x00,0x10,0x20,0x30,0x40,0x50,0x60,0x70,0x80,0x90,0xa0,0xb0,0xc0,0xd0,0xe0,0xf0];

	// register global key bindings before widgets override
	document.addEventListener('keydown', this.handleKeyDown.bind(this));
	document.addEventListener('keyup', this.handleKeyUp.bind(this));

	// construct sliders
	this.speed = new Aria.Slider(this.domSpeedThumb, this.domSpeedRail);
	this.rotate = new Aria.Slider(this.domRotateThumb, this.domRotateRail);
	this.cycle = new Aria.Slider(this.domCycleThumb, this.domCycleRail);
	this.depth = new Aria.Slider(this.domDepthThumb, this.domDepthRail);
	this.framerate = new Aria.Slider(this.domFramerateThumb, this.domFramerateRail);

	// construct controlling listbox button
	this.formula = new Aria.ListboxButton(this.domFormulaButton, this.domFormulaList);
	this.incolour = new Aria.ListboxButton(this.domIncolourButton, this.domIncolourList);
	this.outcolour = new Aria.ListboxButton(this.domOutcolourButton, this.domOutcolourList);
	this.plane = new Aria.ListboxButton(this.domPlaneButton, this.domPlaneList);

	// construct buttons
	this.power = new Aria.Button(this.domPowerButton, true);
	this.autoPilot = new Aria.Button(this.domAutoPilotButton, true);
	this.home = new Aria.Button(this.domHomeButton, false);

	// construct radio group
	this.paletteGroup = new Aria.RadioGroup(document.getElementById('idPaletteGroup'));
	this.randomPalette = this.paletteGroup.radioButtons[0];
	this.defaultPalette = this.paletteGroup.radioButtons[1];

	// add listener for mainview focus
	this.domMain.addEventListener('focus', this.handleFocus.bind(this));
	this.domMain.addEventListener('blur', this.handleBlur.bind(this));

	// replace static mainloop with a bound instance
	this.mainloop = this.mainloop.bind(this);
	this.animationFrame = this.animationFrame.bind(this);

	// attach event listeners
	var self = this;

	// sliders
	this.speed.setCallbackValueChange(function(newValue) {
		self.config.speed = newValue;
		self.domSpeedLeft.innerHTML = newValue;
		self.domMain.innerHTML = JSON.stringify(config, null, '<br/>');
	});
	this.rotate.setCallbackValueChange(function(newValue) {
		self.config.rotateSpeed = newValue / 100; // scale to -1.0 <= angle <= +1.0
		self.domRotateLeft.innerHTML = newValue;
		self.domMain.innerHTML = JSON.stringify(config, null, '<br/>');
	});
	this.cycle.setCallbackValueChange(function(newValue) {
		self.config.offsetSpeed = newValue / 100; // scale to -1.0 <= angle <= +1.0
		self.domCycleLeft.innerHTML = newValue;
		self.domMain.innerHTML = JSON.stringify(config, null, '<br/>');
	});
	this.depth.setCallbackValueChange(function(newValue) {
		self.config.depth = newValue;
		self.domDepthLeft.innerHTML = newValue;
		self.domMain.innerHTML = JSON.stringify(config, null, '<br/>');
	});
	this.framerate.setCallbackValueChange(function(newValue) {
		self.config.framerate = newValue;
		self.config.msecPerFrame = 1000 / self.config.framerate;
		self.domFramerateLeft.innerHTML = newValue;
	});

	// listboxes
	this.formula.listbox.setCallbackFocusChange(function(focusedItem) {
		self.config.formula = focusedItem.id;
		self.domFormulaButton.innerText = focusedItem.innerText;
		self.domMain.innerHTML = JSON.stringify(config, null, '<br/>');
	});
	this.incolour.listbox.setCallbackFocusChange(function(focusedItem) {
		self.config.incolour = focusedItem.id;
		self.domIncolourButton.innerText = focusedItem.innerText;
		self.domMain.innerHTML = JSON.stringify(config, null, '<br/>');
	});
	this.outcolour.listbox.setCallbackFocusChange(function(focusedItem) {
		self.config.outcolour = focusedItem.id;
		self.domOutcolourButton.innerText = focusedItem.innerText;
		self.domMain.innerHTML = JSON.stringify(config, null, '<br/>');
	});
	this.plane.listbox.setCallbackFocusChange(function(focusedItem) {
		self.config.plane = focusedItem.id;
		self.domPlaneButton.innerText = focusedItem.innerText;
		self.domMain.innerHTML = JSON.stringify(config, null, '<br/>');
	});

	// buttons
	this.power.setCallbackValueChange(function(newValue) {
		/*
		 * toggle mainloop
		 */
		if (newValue)
			self.start();
		else
			self.stop();
	});
	this.autoPilot.setCallbackValueChange(function(newValue) {
		self.config.autoPilot = newValue;
		self.domMain.innerHTML = JSON.stringify(config, null, '<br/>');
	});
	this.home.setCallbackValueChange(function(newValue) {
		self.domMain.innerHTML = 'HOME';
	});

	this.counter = 0;
	this.paletteGroup.setCallbackFocusChange(function(newButton) {
		self.domMain.innerHTML = newButton.domButton.id + ' ' + (self.counter++);
	});
}

/**
 * Set viewport dimensions and allocate storage
 *
 * @param {Element} domView
 */
GUI.prototype.setViewport = function (domView) {
	// get canvas and set size property
	this.viewWidth = domView.clientWidth;
	this.viewHeight = domView.clientHeight;
	domView.width = this.viewWidth;
	domView.height = this.viewHeight;

	// calculate and allocate pixel store (must be square so viewport can rotate within it)
	this.diameter = Math.ceil(Math.sqrt(this.viewWidth * this.viewWidth + this.viewHeight * this.viewHeight));
	this.pixels = new Uint8Array(this.diameter * this.diameter);

	// access canvas pixels
	this.ctx = domView.getContext("2d");

	this.imagedata1 = this.ctx.createImageData(this.viewWidth, this.viewHeight);
	this.imagedata2 = this.ctx.createImageData(this.viewWidth, this.viewHeight);

	// update config
	this.config.width = this.viewWidth;
	this.config.height = this.viewHeight;

	// update GUI
	this.domWxH.innerHTML = '[' + this.viewWidth + 'x' + this.viewHeight + ']';

	// test image
	for (var i=0; i<this.diameter*this.diameter; i++)
		this.pixels[i] = (i)%16;
};

/*
 * Paint viewport with pixel data
 */
GUI.prototype.paintViewport = function () {

	// make references local
	var paletteSize = this.paletteRed.length;
	var tmpRed = this.tmpRed;
	var tmpGreen = this.tmpGreen;
	var tmpBlue = this.tmpBlue;
	var viewWidth = this.viewWidth; // viewport width
	var viewHeight = this.viewHeight; // viewport height
	var pixels = this.pixels; // pixel data
	var diameter = this.diameter; // pixel scanline width (it's square)
	var rgba = (this.frameNr&1) ? this.imagedata1.data : this.imagedata2.data; // canvas pixel data
	var i, j, x, y, ix, iy, ji, c;

	// palette offset must be integer and may not be negative
	var offset = Math.round(this.config.offset % paletteSize);
	if (offset < 0)
		offset += paletteSize;

	// apply colour cycling
	for (i = 0; i < paletteSize; i++) {
		tmpRed[i] = this.paletteRed[(i + offset) % paletteSize];
		tmpGreen[i] = this.paletteGreen[(i + offset) % paletteSize];
		tmpBlue[i] = this.paletteBlue[(i + offset) % paletteSize];
	}

	this.rsin = Math.sin(this.config.angle * Math.PI / 180);
	this.rcos = Math.cos(this.config.angle * Math.PI / 180);

	// viewport rotation
	var sin = this.config.rsin; // sine for viewport angle
	var cos = this.config.rcos; // cosine for viewport angle
	var xstart = Math.floor((diameter - viewHeight * sin - viewWidth * cos) * 32768);
	var ystart = Math.floor((diameter - viewHeight * cos + viewWidth * sin) * 32768);
	var ixstep = Math.floor(cos * 65536);
	var iystep = Math.floor(sin * -65536);
	var jxstep = Math.floor(sin * 65536);
	var jystep = Math.floor(cos * 65536);

	// copy pixels
	ji = 0;
	for (j = 0, x = xstart, y = ystart; j < viewHeight; j++, x += jxstep, y += jystep) {
		for (i = 0, ix = x, iy = y; i < viewWidth; i++, ix += ixstep, iy += iystep) {
			c = pixels[(iy >> 16) * diameter + (ix >> 16)];

			rgba[ji++] = tmpRed[c];
			rgba[ji++] = tmpGreen[c];
			rgba[ji++] = tmpBlue[c];
			rgba[ji++] = 255;
		}
	}
};

/**
 * Handle keyboard down event
 *
 * @param {KeyboardEvent} event
 */
GUI.prototype.handleKeyDown = function (event) {
	var type = event.type;

	// Grab the keydown and click events
	switch (event.keyCode) {
		case 0x41: // A
		case 0x61: // a
			this.autoPilot.buttonDown();
			this.domAutoPilotButton.focus();
			break;
		case 0x44: // D
		case 0x64: // d
			this.paletteGroup.radioButtons[1].buttonDown();
			this.domDefaultPaletteButton.focus();
			break;
		case 0x46: // F
		case 0x66: // f
			if (!this.formula.toggleListbox(event))
				this.domMain.focus();
			break;
		case 0x49: // I
		case 0x69: // i
			if (!this.incolour.toggleListbox(event))
				this.domMain.focus();
			break;
		case 0x4f: // O
		case 0x6f: // o
			if (!this.outcolour.toggleListbox(event))
				this.domMain.focus();
			break;
		case 0x50: // P
		case 0x70: // p
			if (!this.plane.toggleListbox(event))
				this.domMain.focus();
			break;
		case 0x51: // Q
		case 0x71: // q
			this.power.buttonDown();
			this.domPowerButton.focus();
			break;
		case 0x52: // R
		case 0x72: // r
			this.paletteGroup.radioButtons[0].buttonDown();
			this.domRandomPaletteButton.focus();
			break;
		case Aria.KeyCode.HOME:
			this.home.buttonDown();
			this.domHomeButton.focus();
			break;
		case Aria.KeyCode.UP:
			this.speed.moveSliderTo(this.speed.valueNow + 1);
			this.domSpeedThumb.focus();
			break;
		case Aria.KeyCode.DOWN:
			this.speed.moveSliderTo(this.speed.valueNow - 1);
			this.domSpeedThumb.focus();
			break;
		case Aria.KeyCode.PAGE_UP:
			this.rotate.moveSliderTo(this.rotate.valueNow + 1);
			this.domRotateThumb.focus();
			break;
		case Aria.KeyCode.PAGE_DOWN:
			this.rotate.moveSliderTo(this.rotate.valueNow - 1);
			this.domRotateThumb.focus();
			break;
		default:
			return;
	}

	event.preventDefault();
	event.stopPropagation();

};

/**
 * Handle keyboard up event
 *
 * @param {KeyboardEvent} event
 */
GUI.prototype.handleKeyUp = function (event) {
	var type = event.type;

	// Grab the keydown and click events
	switch (event.keyCode) {
		case 0x41: // A
		case 0x61: // a
			this.autoPilot.buttonUp();
			this.domMain.focus();
			break;
		case 0x44: // D
		case 0x64: // d
			this.paletteGroup.radioButtons[1].buttonUp();
			this.domMain.focus();
			break;
		case 0x51: // Q
		case 0x71: // q
			this.power.buttonUp();
			this.domMain.focus();
			break;
		case 0x52: // R
		case 0x62: // r
			this.paletteGroup.radioButtons[0].buttonUp();
			this.domMain.focus();
			break;
		case Aria.KeyCode.HOME:
			this.home.buttonUp();
			this.domMain.focus();
			break;
		case Aria.KeyCode.UP:
			this.domMain.focus();
			break;
		case Aria.KeyCode.DOWN:
			this.domMain.focus();
			break;
		case Aria.KeyCode.PAGE_DOWN:
			this.domMain.focus();
			break;
		case Aria.KeyCode.PAGE_UP:
			this.domMain.focus();
			break;
	}

	event.preventDefault();
	event.stopPropagation();

};

/**
 * Handle focus event
 *
 * @param {FocusEvent} event
 */
GUI.prototype.handleFocus = function (event) {
	this.domMain.classList.add('focus');
};

/**
 * Handle blur event
 *
 * @param {FocusEvent} event
 */
GUI.prototype.handleBlur = function (event) {
	this.domMain.classList.remove('focus');
};

/**
 * start the mainloop
 */
GUI.prototype.start = function() {
	this.state = 1;
	this.vblank = performance.now() + this.config.msecPerFrame; // vblank wakeup time
	this.numLines = 0;
	this.statState1 = this.statState2 = this.statState3 = this.config.msecPerFrame / 2;
	this.timerId = window.setTimeout(this.mainloop, 1);
};

/**
 * stop the mainloop
 */
GUI.prototype.stop = function() {
	clearTimeout(this.timerId);
	this.timerId = null;
};

/**
 * Syncronise screen updates
 *
 * @param {number} time
 */
GUI.prototype.animationFrame = function(time) {
	// paint image
	// NOTE: opposite buffer than used in paintViewport()
	if (this.frameNr&1)
		this.ctx.putImageData(this.imagedata2, 0, 0);
	else
		this.ctx.putImageData(this.imagedata1, 0, 0);
};

/**
 * GUI mainloop called by timer event
 *
 * @returns {boolean}
 */
GUI.prototype.mainloop = function() {
	if (!this.timerId)
		return false;

	this.mainloopNr++;

	// make local for speed
	var config = this.config;

	// current time
	var now = performance.now();

	if (now > this.vblank + 2000) {
		// Missed vblannk by more than 2 seconds, resync
		this.vblank= now + config.msecPerFrame;
		this.state = 1;
	}

	/*
	 * Fast path
	 */
	if (this.state === 3) {
		// end time is 2mSec before next vertical blank
		var endtime = this.vblank - 2;
		if (endtime > now + 2)
			endtime = now + 2;

		/*
		 * Calculate lines
		 */
		while (now < endtime) {
			// var cnt = navEngine.onquality(now, endtime-avg4);

			now = performance.now();
			this.numLines++;
		}

		/*
		 * Wait for vblank
		 */
		if (now < endtime) {
			// yield and return as quick as possible
			this.timerId = window.setTimeout(this.mainloop, 0);
			return true;
		}
		if (now < this.vblank) {
			// wait
			this.timerId = window.setTimeout(this.mainloop, 1);
			return true;
		}

		/*
		 * Update stats
		 */
		if (this.numLines > 0) {
			this.statState3 += (this.numLines - this.statState3) * this.coef;
		}

		/*
		 * Request to paint previously prepared frame
		 */
		this.frameNr++; // switch frames, must do before calling requestAnimationFrame()
		this.vblank += config.msecPerFrame; // time of next vblank
		window.requestAnimationFrame(this.animationFrame);

		/*
		 * Reset state
		 */
		this.state = 1;

		// yield and return as quick as possible
		this.timerId = window.setTimeout(this.mainloop, 0);
		return;
	}

	/*
	 * test for viewport resize
	 */
	if (this.domMain.clientWidth !== this.viewWidth || this.domMain.clientHeight !== this.viewHeight)
		this.setViewport(this.domMain);

	/*
	 * Update colour palette cycle offset and viewport angle
	 */
	if (config.offsetSpeed)
		config.setOffset(config.offset + config.msecPerFrame * config.offsetImcrement * config.offsetSpeed);
	if (config.rotateSpeed)
		config.setAngle(config.angle + config.msecPerFrame * config.rotateIncrement * config.rotateSpeed);

	var last = now;
	if (this.state === 1) {
		/*
		 * State1: Paint viewport
		 */

		this.paintViewport();

		now = performance.now();
		this.statState1 += ((now - last) - this.statState1) * this.coef;

		this.state = 2;

	} else if (this.state === 2) {
		/*
		 * State2: zoom/autopilot
		 */
//		navEngine.ontick(now, endtime);

		now = performance.now();
		this.statState2 += ((now - last) - this.statState2) * this.coef;

		this.state = 3;
	}

	// this.domMain.innerHTML = ((avgS+avgU)*100/config.frametime).toFixed()+'% (sys:'+avgS.toFixed()+'mSec+usr:'+avgU.toFixed()+'mSec) ['+stxt+']';
	this.domStatusRect.innerHTML =
		'paint:' + this.statState1.toFixed(3) +
		'mSec('+ (this.statState1*100/config.msecPerFrame).toFixed(0) +
		'%), zoom:' + this.statState2.toFixed(3) +
		'mSec, lines:' + this.statState3.toFixed(0);
	;

	if (Math.floor(now/1000) !== this.lastNow) {
		this.domStatusLoad.innerHTML = 'FPS:'+(this.frameNr - this.lastFrame) + ' IPS:' + (this.mainloopNr - this.lastLoop);
		this.lastNow = 	Math.floor(now/1000);
		this.lastFrame = this.frameNr;
		this.lastLoop = this.mainloopNr;
	}

	// yield and return as quick as possible
	this.timerId = window.setTimeout(this.mainloop, 0);

	return true;
};
