<a href="https://rockingship.github.io/jsFractalZoom/jsFractalZoom.html?x=-0.8665722560433728&y=0.2308933773688535&r=3.021785750590329e-7&a=0&density=0.0362&iter=10080&theme=6&seed=2140484823" target="_blank"><img src="assets/favimage-840x472.jpg" width="100%" alt="favimage"/></a>

## NOTE: This document is under active construction

# Welcome to the wonderful world of (fractal) zooming

When insufficient resources force you to prioritize which pixels to render first...

This project has 3 Components:

  - [XaoS](http://xaos.sourceforge.net/black/index.php) inspired fractals as sample content.
  - The `zoomer` engine.
  - The `splash` video codec.

The only requirement is the implementation of:

```
    /**
     * This is done for every pixel. optimize well!
     * Easy extendable for 3D.
     * Return the pixel value for the given floating point coordinate.
     * Zoomer will use it to fill integer pixel positions. 
     * The positions are ordered in decreasing significance.
     *
     * @param {Zoomer}      zoomer  - 😊
     * @param {ZoomerFrame} frame   - Pixels/Palette/Rotate
     * @param {float}       x       - X coordinate
     * @param {float}       y       - Y coordinate
     * @return {int} - Pixel value           
     */
    onUpdatePixel: (zoomer, frame, x, y) => {
        return <YourCodeHere>;
    }
```

## Experience the fractal zoomer

Click on the image above to start the zoomer at the presented location.  
Or, start from scratch: [https://rockingship.github.io/jsFractalZoom/jsFractalZoom.html](https://rockingship.github.io/jsFractalZoom/jsFractalZoom.html)

How to use:
  - press the enlarge button in the top right (or F11) to enable full-screen.
  - fly around in high speed to nice places.
  - adjust the "density" using the mouse-wheel to help focus.
  - drag the image by holding down the mouse-wheel to a photogenic position.
  - staying static allows for faster loading speed.
  - the loading is "complete"  when the "complete" indicator reached "1" (located in the top bar).
   - the control panel can be resized using the bottom left resize button.

Saving:
  - saves as a PNG file.
  - the panels and text will be removed in the image.
  - the navigation and setting from capture are stored in the PNG file.
  - drop the PNG on the zoomer page to load the stored information.

Saving a multi-monitor desktop wallpaper:
  - find nice location
  - press "URL" to copy setting
  - paste in URL bar and add `&w=<width>&h=<height>` at the end. Replace `<width>` and `<height>` with your total multi-monitor dimensions.
  - load new URL
  - wait until "complete" reaches 1
  - save
  - enjoy your new wallpaper!

Tips for using in 4K:
  - switch to the HD (1080p) browser resolution for faster navigation.
  - switch to 4K for maximum quality.

For desktop use (primary design target):
  - use "ctrl+" /"ctrl-" to chang display resolution. For highest quality match resolution to your screen.
  - left mouse button: zoom in
  - right mouse button: zoom out
  - press mouse wheel to drag
  - turn mouse wheel to focus (adjusts "density" setting)

For touchscreen use:
  - enable full-screen mode, hold phone horizontally if buttons are too small.
  - can be used both portrait and landscape mode.
  - disable rotate in the zoomer menu for better performance.
  - use 1 finger to drag.
  - use 2 fingers to zoom: stretch to zoom in, pinch to zoom out.
    For unobstructed viewing while zooming you can release 1 finger.
  - use 3 finger to focus: release one finger and pinch or stretch with the remaining two to adjust "density".

## Concept

It's about how to construct a frame for animations/video.  
Normally a frame is constructed by scanning rows from top-left to bottom-right.  
Problems start when calculating pixels takes (much) long than available time.  
Reusing pixels from previous frames becomes important to reduce calculations.  
We perceive motion as zooming for speed and shifting for direction.  
Zooming/shifting is instantaneous and (usually) enlarges the image which introduces motion blur.  
Our eye and brain needs to accommodate to the change and will not notice the difference between blur or sharp.  
As our mind starts to focus on areas of interest it will digest detail and colour aided by the eye's macula (gele vlek).  
Areas seen outside the macula are monochrome and blurry.  
The zoomer/splash engine tries to prioritize the pixels our mind and macula desires the most.  
It is driven by the idea that our brain is most sensitive to contrast changes, so areas with high change (high motion) is what we look at first.  
Scoring is used to quantify the amount of change and sharpness, the ordering of pixel rendering is based on decreasing scoring.  
Idealistically we would want to score all the pixels individually, but that requires too much resources to be practically feasible.  
Second best choice is to average the scoring by row and column.  
Each row and column receives a scoring based on the difference between the old/previous and new/next frame.  
The engine basically peeks into the future to indicate which rows and columns are going to change the most.  
This is done for each dimensional axis and stored in the major component called the ruler.  
Screens are considered two-dimensional pixel planes using x/row and y/column coordinates.  
This is different than 3D content which usually gets transformed to 2D before being projected onto the screen.  
As a side note for advanced modeling, the engine is prepared for upgrading to multi-dimensional pixel planes.

Here is an example with three consecutive frames.  
The first is the starting landscape followed by two incremental steps depicting a forward angled movement.  
For simplicity only a single scan-line is illustrated.

First step is to zoom and shift the landscape which introduces blur because many pixels are discarded and replaced by neighbouring copies.  
As we will not be travelling at the speed of light the motion angle and pixel duplication will be minimal.  
Landscape ranges from `2.0 <= x <= 3.8` and the zoom is changing the range to `24 <= x <= 3.2`

![copy frame 1-2](assets/copyFrame12-900x506.jpg)

Second step determine the scan-line sequence and calculate pixels which makes the landscape sharp.  
Note that it is expected by design that not all scan-lines can be processed within the available frame construction duration.  
As a side note this is lossy behaviour, only when all scan lines have been processed will the new landscape be lossless.

![calc frame 2](assets/calcFrame2-900x506.jpg)

The third frame repeats the process as the directional vector stays unchanged.  
Main difference now is that the landscape contains areas which inherit and increase the level of blurriness.

![calc frame 3](assets/calcFrame3-900x506.jpg)

A score of 0 implies that the pixel coordinate is exact and has not drifted.  
With multi-dimensional rulers (used by screens), a pixel is exact if the drift/score in all dimensions is zero.  
When calculating a frame, scan rows and columns will intersect, the number of intersections will increase as construction advances.  
The intersections form corners of rectangles that are filled by the calculated pixel value.  
In the beginning the rectangles are large giving a pixelated effect and get smaller/sharper when additional scanlines start to sub-divide the area.

![scanlines](assets/scanline-900x506.gif)

## The `zoomer` architecture

The `zoomer` engine lets you visually navigate through a procedurally generated landscape.  
It assumes that calculating pixel value is highly expensive.  
Maximises reuse of data from the previous frame to avoid unnecessary calculations,  
New pixel values are calculated in order of significance.

###  Navigation

The directional viewing vector consists of three components:

  - The x,y coordinates, extendable to 3D or more
  - radius
  - rotational angle

Updating the directional vector is user defined.

### States

`zoomer` is a timed state machine to construct frames.  
Frame construction has been split into phases/states.

The states are:

  - `COPY` (New frame)  
    Construct rulers for scaling/shifting pixels from previous frame.  
    Copy pixels using an `indexed memcpy()`.  
    Determine calculate order for rows/columns.

  - `UPDATE` (Calculate blurry pixels)  
    Update key pixels along an axis, called a scanline.  
    Key pixels are pixels that have been scanned along in all directions.  
    Flood fill neighbours to create motion blur using `interleaved memcpy()`.

  - `RENDER` (RGBA frame buffer)
    Copy pixel values from the backing store to a RGBA storage.  
    Optional palettes are applied.  
    Apply rotation where/when necessary using `angled memcpy()`.

  - `PAINT` (Forward to display)
    Write RGBA storage to the display.  
    Most probably being a canvas using `putImageData()`.  
    `putImageData()` can be CPU intensive and has therefore a dedicated state.

State timings:

The `COPY`, `UPDATE` and `PAINT` states are run from the main event queue, `RENDER` is done by web-workers.
The duration of a complete frame is `max(COPY+UPDATE+PAINT,RENDER)`.
The Phased Locked Loop should tune `COPY+UPDATE+PAINT` to equal the requested frame rate

Running on an AMD FX-8320E, state durations (mSec) have been grossly averaged in the following table:

|  platform       |   COPY  |  UPDATE  |  RENDER  |  PAINT  |  MAX FPS |
|:----------------|:-------:|:--------:|:--------:|:-------:|:--------:|
|  Firefox 1080p  |   7     |  30      |  11      |    9    | 21
|  Firefox 4K     |   50    |  30      |  150     |   62    |  7
|  Chrome 1080p   |   11    |  29      |  9       |    2    | 23
|  Chrome 4K      |   38    |  28      |  31      |   12    | 12

The timings were measured with a requested FPS of 20.  
PLL nicely stabilises taking into account a massive amount of statistical noise.  
The 4K are clearly too much to handle, the engine will automatically reduce FPS until balance is reached.

The choice to perform `RENDER` as web-worker is because:

  - during initial design timings were longer  because of less optimiations
  - The requirement for a previous frame complicated the reference implementation too much for parallel implementation.

NOTE: `requestAnimationFrame` is basically unusable because (at least) Firefox has added jitter as anti-fingerprinting feature.

###  Phased Locked Loop

The time needed for `COPY`, `RENDER` and `PAINT` is constant.  
The `UPDATE` timings for calculating a pixel is undetermined.  
Duration and overhead of time measurement functions is considered a factor more than calculating pixel values.
The stability of framerate depends on the accuracy of timing predictions.

Phased Locked Loop predicts the number of calculations/iterations based on averages from the past.  
Two time measurements are made, before and after a predetermined number of iterations.  
The number of iterations for the next round is adjusted heuristically.

Phase Lock Loop is self adapting to environmental changes like Javascript Engine, CPU and display.

### Coordinates

Pixel values use three different types of coordinates:

  - x,y (float) formula coordinate
  - u,v (int) screen position
  - i,j (int) backing store location

Which unit is applicable depends on the position in the data path:

formula `<-xy->` backingStore `<-ij->` clip/rotation `<-uv->` screen/canvas

### Backing store

Backing store has three functions:

  - Separation of storage/logic
    Pixel data objects (frames) can easily transfer to web-workers or other distributed agent.

  - Contains the previous frame
    Ruler construction requires scoring based on frame differences.
    Scoring is currently the amount of pixel drift, and can be adapted to different models.

  - Holds inter-frame
    Updating scanlines can fill neighbouring pixels.  
    Encoders/Decoders share temporal synced pixel data

### Rotation

<img src="assets/rotate-400x400.webp" width="400" height="400" alt="rotate"/>

When rotating is enabled the pixel storage (backing store) needs to hold all the pixels for all angles.  
The size of the storage is the diagonal of the screen/canvas squared.  
Rotation uses fixed point sin/cos.  
The sin/cos can be loop unrolled to make clipping/rotating high speed.

Rotation requires square backing store, otherwise it is shrink-to-fit width*height.

Rotation has two penalties:
 - Needs to calculate about 2.5 times more pixels than displayed
 - Extra loop overhead

`Zoomer` can easily enable/disable rotational mode on demand.

### `memcpy()`

Javascript as a language does not support acceleration of array copy.  
In languages like `C`/`C++`, it is advertised as library function `memcpy()`.  
With Javascript, the only access to `memcpy()` is through `Array.subarray`

```
    /**
     * zoomerMemcpy Accelerated array copy.
     *
     * @param {ArrayBuffer} dst       - Destination array
     * @param {int}         dstOffset - Starting offset in destination
     * @param {ArrayBuffer} src       - Source array
     * @param {int}         srcOffset - Starting offset in source
     * @param {int}         length    - Number of elements to be copyied
     */
    function zoomerMemcpy(dst, dstOffset, src, srcOffset, length) {
        src = src.subarray(srcOffset, srcOffset + length);
        dst.set(src, dstOffset);
    }
```

Within `zoomer`, three variations of `memcpy()` are used:

#### Indexed

Indexed `memcpy` transforms the contents using a lookup table.  
Palettes are lookup tables translating from pixel value to RGBA.  
Copying/scaling/shifting pixel values from previous frame to next after ruler creation.

A conceptual implementation:
```
    function memcpyIndexed(dst, src, cnt) {
      for (let i=0; i<cnt; i++)
        dst[i] = SomeLookupTable[src[i]];
    }  
```

#### Interleaved

There are two kinds of scan-lines: scan-rows and scan-columns.  
Only scan-rows can profit from hardware acceleration.  
CPU instruction-set lacks multi dimensional support.  
Auto-increment is always word based.  
Acceleration support for arbitrary offset is missing.

A conceptual implementation:
```
    // increment can be negative
    // an option could be to have separate increments for source/destination
    function memcpyInterleave(dst, src, cnt, offset) {
      for (let i=0; i<cnt; i++)
          dst[i*offset] = src[i*offset];
    }  
```

#### Angled

Clip and rotate when copying pixels from the backing store to RGBA

A conceptual implementation:
```
    /**
     * memcpy with clip and rotate. (partially optimised)
     *
     * @param {ArrayBuffer} dst         - Destination array (rgba[]) 
     * @param {ArrayBuffer} src         - Source array (pixel[])
     * @param {int}         viewWidth   - Viewport width (pixels)
     * @param {int}         viewHeight  - Viewport height (pixels)
     * @param {int}         pixelWidth  - Backing store width (pixels)
     * @param {int}         pixelHeight - Backing store height (pixels)
     */
    function memcpyAngle(dst, src, angle, viewWidth, viewHeight, pixelWidth, pixelHeight) {
        // Loop unroll slating increments
        // Fixed point floats
        // with 4K displays rounding errors are negligible. 
        const rsin = Math.sin(angle * Math.PI / 180); // sine for view angle
        const rcos = Math.cos(angle * Math.PI / 180); // cosine for view angle
        const xstart = Math.floor((pixelWidth - viewHeight * rsin - viewWidth * rcos) * 32768);
        const ystart = Math.floor((pixelHeight - viewHeight * rcos + viewWidth * rsin) * 32768);
        const xstep = Math.floor(rcos * 65536);
        const ystep = Math.floor(rsin * 65536);

        // copy pixels
        let vu = 0;
        for (let j = 0, x = xstart, y = ystart; j < viewHeight; j++, x += xstep, y += ystep) {
            for (let i = 0, ix = x, iy = y; i < viewWidth; i++, ix += ystep, iy -= xstep) {
                dst[vu++] = src[(iy >> 16) * pixelWidth + (ix >> 16)];
            }
        }
    }
```

### Rulers

Rulers are the main component of the zoomer engine and are used for the following:

  - Metadata for pixel storage
    Attaches coordinates to pixel locations.  
    The engine separates data from logic, metadata is considered part of the logic and is not passed to web-workers.

  - Create lookup tables for `memcpy_indexed()`
    Every pixel of a new frame is inherited from the previous frame.  
    Rulers indicate the source location that are the best choice based on pixel drift.  
    Scaling/shifting allows seamless changing of frame size, which can be used to set the quality/size of key-frames.

  - Scan-line scoring and ordering.
    Determines the sequence in which scan-lines are processed.

There are rulers for every dimensional axis.  
Scaling and shifting introduces motion-blur, scan-line calculations introduces sharpness.  
Scan-line calculations update ruler scoring. which in turn dynamically changes the order of scan-lines.  
Ordering of scan-lines is independent of their dimensional-axis.

For the fractal zoomer, rulers contain the following information:

  - exact coordinate
  - drifted coordinate
  - score
  - source location in previous frame

## The `zoomer` API

Zoomer is full-screen canvas orientated.  
All interaction with the physical environment (DOM) is done through callbacks.  
Coordinates are floating point, pixel locations are integer.  
Scaling those two is a design fundamental.  
Rotation is also fully integrated with a minimal performance penalty.  
`devicePixelDensity` is a natural environment and integrates seamlessly.

Being full-screen oriented, HTML positioning is absolute.  
CSS for centering and padding the canvas.  
Javascript to glue resources.

### Application components

A main design principle is to separate pixel data, UI resources and render logic.  
An application consists of five areas:

  - HTML/CSS

    Zoomer is primarily full-screen canvas orientated.  
    Being full-screen oriented, HTML positioning is absolute.
    CSS for centering and padding the canvas.

  - Callbacks

    User supplied callbacks to glue canvas, resources and events to the engine

  - Function object `ZoomerFrame`

    Pixel data, rotation,data transfer to workers
    deliberately does not contain metadata describing the location of the pixel values.
    object inaccessable when transferred to web workers

  - Function object `ZoomerView`

    Rulers, rotation
    deliberately does not contain pixel values.

  - Function object `Zoomer`

    Scheduling+timing, worker communication

### Sample/skeleton implementation HTML/CSS

The following template is a bare minimum:

```
<!DOCTYPE html>
<html lang="en">
<head>
    <title>Example</title>
    <meta charset="UTF-8">
    <style>
        body {
            position: absolute;
            border: none;
            margin: auto;
            padding: 0;
            height: 100%;
            width: 100%;
            top: 0;
            right: 0;
            bottom: 0;
            left: 0;
        }
        #idZoomer {
            position: absolute;
            border: none;
            margin: auto;
            padding: 0;
            width: 100%;
            height: 100%;
            top: 0;
            right: 0;
            bottom: 0;
            left: 0;
        }
    </style>
    <script type="text/javascript" src="zoomer.js"></script>
</head>
<body>
<canvas id="idZoomer"> </canvas>
<script type="text/javascript">
    "use strict";

    window.addEventListener("load", function () {

        /**
         * Get canvas to draw on (mandatory)
         * @type {HTMLElement}
         */
        const domZoomer = document.getElementById("idZoomer");

        /**
         * Get context 2D (mandatory), "desynchronized" is faster but may glitch hovering mouse (optional)
         * @type {CanvasRenderingContext2D}
         */
        const ctx = domZoomer.getContext("2d", {desynchronized: true});

        // get available client area
        const realWidth = Math.round(document.body.clientWidth * window.pixelDensityRatio);
        const realHeight = Math.round(document.body.clientHeight * window.pixelDensityRatio);

        // set canvas size (mandatory)		
        domZoomer.width = realWidth;
        domZoomer.height = realHeight;

        /**
         * Create zoomer (mandatory)
         * @type {Zoomer}
         */
        const zoomer = new Zoomer(realWidth, realHeight, false, OPTIONS);

        /**
         * Create a small key frame (mandatory)
         * @type {ZoomerView}
         */
        const keyView = new ZoomerView(64, 64, 64, 64);

        // Calculate all the pixels (optional), or choose any other content 
        keyView.fill(initialX, initialY, initialRadius, initialAngle, zoomer, zoomer.onUpdatePixel);

        // set initial position and inject key frame (mandatory)
        zoomer.setPosition(initialX, initialY, initialRadius, initialAngle, keyView);

        // start engine (mandatory)
        zoomer.start();
    });
</script>
</body>
</html>
```

### Sample/skeleton implementation Javascript

The only mandatory addition is the contents of `OPTIONS` which are initial values for any or all `zoomer` properties.

All callbacks have the zoomer instance as first argument for easy engine access.  
In combination with arrow functions, `this` is caller/DOM namespace and `zoomer` is engine/webworker namespace.

Most important properties are:

```
const OPTIONS = {
    /**
     * Frames per second.
     * Rendering frames is expensive, too high setting might render more than calculate.
     * If a too high setting causes a frame to drop, `zoomer` will lower this setting with 10%
     *
     * @member {float} - Frames per second
     */
    frameRate: 20,

    /**
     * Disable web-workers.
     * Offload frame rendering to web-workers.
     * When ever the default changes, you will appreciate it explicitly being noted.
     * You cannot use webworkers if you add protected recources to frames.
     *
     * @member {boolean} - disable/Enable web workers.
     */
    disableWW: false,

    /**
     * Additional resources added to new frames.
     * Frames are passed to webworkers.
     * Frames are re-used without reinitialising.
     *
     * Most commonly, setup optional palette,
     *
     * @param {Zoomer}      zoomer - Running engine
     * @param {ZoomerFrame} frame  - Frame being initialized.
     */
    onInitFrame: (zoomer, frame) => {
        // allocate RGBA palette.

        /* frame.palette = new Uint32Array(65536); */
    },

    /**
     * Start of a new frame.
     * Process timed updates (piloting), set x,y,radius,angle.
     *
     * @param {Zoomer}      zoomer    - Running engine
     * @param {ZoomerView}  calcView  - View about to be constructed
     * @param {ZoomerFrame} calcFrame - Frame about to be constructed
     * @param {ZoomerView}  dispView  - View to extract rulers
     * @param {ZoomerFrame} dispFrame - Frame to extract pixels
     */
    onBeginFrame: (zoomer, calcView, calcFrame, dispView, dispFrame) => {
        // set navigation direction
        
        /* zoomer.setPosition(centerX, centerY, radius, angle); */
    },

   /**
     * This is done for every pixel. optimize well!
     * Easy extendable for 3D.
     * Return the pixel value for the given floating point coordinate.
     * Zoomer will use it to fill integer pixel positions. 
     * The positions are ordered in decreasing significance.
     *
     * @param {Zoomer}      zoomer  - Running engine
     * @param {ZoomerFrame} frame   - Pixel/Palette/Rotate
     * @param {float}       x       - X coordinate
     * @param {float}       y       - Y coordinate
     * @return {int} - Pixel value           
     */
    onUpdatePixel: (zoomer, frame, x, y) => {
        // calculate pixel
        
        return 0; /* your code here */
    },

    /**
     * Start extracting (rotated) RGBA values from (paletted) pixels.
     * Extract rotated view from pixels and store them in specified imagedata.
     * Called just before submitting the frame to a web-worker.
     *
     * @param {Zoomer}      zoomer - Running engine
     * @param {ZoomerFrame} frame  - Frame about to render
     */
    onRenderFrame: (zoomer, frame) => {
        // update palette
        
        /* updatePalette(frame.palette); */
    },

    /**
     * Frame construction complete. Update statistics. Check resize.
     *
     * @param {Zoomer}      zoomer - Running engine
     * @param {ZoomerFrame} frame  - Frame before releasing to pool
     */
    onEndFrame: (zoomer, frame) => {
        // statistics
        
        /* console.log('fps', zoomer.avgFrameRate); */
    },

    /**
     * Inject frame into canvas.
     * This is a callback to keep all canvas resource handling/passing out of Zoomer context.
     *
     * @param {Zoomer}      zoomer - Running engine
     * @param {ZoomerFrame} frame  - Frame to inject
     */
    onPutImageData: (zoomer, frame) => {
        // get final buffer
        const imageData = new ImageData(new Uint8ClampedArray(frame.rgba.buffer), frame.viewWidth, frame.viewHeight);

        // draw frame onto canvas. `ctx` is namespace of caller.
        ctx.putImageData(imagedata, 0, 0);
    },

}
```

## Function declaration

There are two styles of function declaration, traditional and arrow notation.
Both are identical in functionality and performance.
Difference is the binding of `this`.
With `function()` the bind is the web-worker event queue, with `() => { }` the bind is the DOM event queue.

```
  (a,b,c) => { }       - Strongly advised
  function(a,b,c) { }  - Expert mode
```

To aid in scope de-referencing all callbacks have as first parameter a reference to the engine internals.

```
    this.domStatus = document.getElementById("idStatus");

    this.zoomer = new Zoomer(width, height, enableAngle, {
       onEndFrame: (zoomer, frame) => {
            /*
             * `this` references the caller scope
             * `zoomer` references engine scope
             * `frame` references web-worker pixel data
             */
			this.domStatusLoad.innerText = "FPS:" + zoomer.frameRate;
        }
    });
```

### Demos

There are 3 demos. All are work-in-progress and may not work in any/all situations.

[jsFractalZoom-formula.html](https://rockingship.github.io/jsFractalZoom/jsFractalZoom-formula.html)
The original with most of the formula's working.

[jsFractalZoom-navigation.html](https://rockingship.github.io/jsFractalZoom/jsFractalZoom-navigation.html)
The original with most of the navigation working.

[jsFractalZoom.html](https://rockingship.github.io/jsFractalZoom/jsFractalZoom.html)
The current unification and completion.


There are two sample implementations of the `zoomer` engine.

  - `jsFractalZoom` is a full featured UI/UX frontend
  - `viewer` a minimalistic reference implementation

Both illustrate how to integrate the engine with your application.


# Background

`jsFractalZoom` is an fractal generator/zoomer written in javascript. It was inspired by XaoS, [https://xaos.sourceforge.net/black/index.php](https://xaos.sourceforge.net/black/index.php).

The project was originally created in May 2011, resurrected in 2018 and extended in 2020.

The 2020 version is canvas based. The 2018 engine created GIF images using an ultra fast GIF encoder [https://github.com/xyzzy/jsGifEncoder](https://github.com/xyzzy/jsGifEncoder).
 
## Versioning

This project adheres to [Semantic Versioning](http://semver.org/spec/v2.0.0.html).
For the versions available, see the [tags on this repository](https://github.com/xyzzy/jsFractalZoom/tags).

## License

This project is licensed under Affero GPLv3 - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

* All the inspiration from the XaoS project.
