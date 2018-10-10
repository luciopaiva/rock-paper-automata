/**
 * @callback TimingCallback
 * @param {Number} value
 */

/**
 * Helper for performance measuring.
 */
class Timing {

    constructor () {
        /** @type {Map<String, TimingCallback>} */
        this.callbackByLabel = new Map();
        /** @type {Map<String, Number[]>} */
        this.measurementsByLabel = new Map();

        this.samplesPerAverage = 30;
    }

    measure(label, fn) {
        const start = performance.now();
        fn();
        const measurements = this.measurementsByLabel.get(label);
        measurements.push(performance.now() - start);
        if (measurements.length >= this.samplesPerAverage) {
            const avg = measurements.reduce((acc, val) => acc + val, 0) / measurements.length;
            this.measurementsByLabel.set(label, []);
            const callback = this.callbackByLabel.get(label);
            callback(avg);
        }
    }

    on(label, callback) {
        this.callbackByLabel.set(label, callback);
        this.measurementsByLabel.set(label, []);
    }
}

class Canvas {

    /**
     * @param {RockPaperAutomata} simulation
     * @param {HTMLCanvasElement} canvas
     * @param {Number} width
     * @param {Number} height
     */
    constructor (simulation, canvas, width, height) {
        this.simulation = simulation;
        this.canvas = canvas;
        this.width = width;
        this.height = height;
        this.levelByAutomatonIndex = Array(this.width * this.height).fill(0);
        this.canvas.setAttribute("width", width.toString());
        this.canvas.setAttribute("height", height.toString());
        this.context = canvas.getContext("2d");

        // Auxiliary canvas for free-hand drawing; this is a hack I came up with because there's no way to get rid of
        // anti-aliasing in HTML canvases and we must have pure colors only. The hack consists of reading from the
        // drawing canvas and translating it into pure colors in the main canvas, while also resetting cell levels
        // accordingly.
        this.drawingCanvas = document.createElement("canvas");
        this.drawingCanvas.setAttribute("width", width.toString());
        this.drawingCanvas.setAttribute("height", height.toString());
        this.drawingContext = this.drawingCanvas.getContext("2d");
        this.reset(this.drawingContext);

        this.canvas.addEventListener("mousemove", this.onMouseMove.bind(this));
        this.canvas.addEventListener("mousedown", this.onMouseDown.bind(this));
        this.canvas.addEventListener("mouseup", this.onMouseUp.bind(this));
        this.lastMouseX = 0;
        this.lastMouseY = 0;
        this.isMouseDown = false;

        this.paintColor = "white";

        this.reset();
    }

    setPaintColor(color) {
        // black will be translated into white when drawing, because later we'll need to distinguish what has been drawn
        this.paintColor = color === "black" ? "white" : color;
    }

    onMouseMove(event) {
        if (this.isMouseDown) {
            const curX = event.clientX - this.canvas.offsetLeft;
            const curY = event.clientY - this.canvas.offsetTop;

            const lineWidth = 20;
            this.drawingContext.beginPath();
            this.drawingContext.moveTo(this.lastMouseX, this.lastMouseY);
            this.drawingContext.lineTo(curX, curY);
            this.drawingContext.strokeStyle = this.paintColor;
            this.drawingContext.fillStyle = this.paintColor;
            this.drawingContext.lineCap = "round";
            this.drawingContext.lineWidth = lineWidth;
            this.drawingContext.stroke();
            this.drawingContext.closePath();

            const x0 = Math.max(1, Math.min(this.lastMouseX, curX) - lineWidth);
            const y0 = Math.max(1, Math.min(this.lastMouseY, curY) - lineWidth);
            const x1 = Math.min(this.width - 1, Math.max(this.lastMouseX, curX) + lineWidth);
            const y1 = Math.min(this.height - 1, Math.max(this.lastMouseY, curY) + lineWidth);
            this.transposeDrawingAndReset(x0, y0, x1, y1);

            this.lastMouseX = curX;
            this.lastMouseY = curY;
        }
    }

    onMouseDown(event) {
        this.isMouseDown = true;
        this.lastMouseX = event.clientX - this.canvas.offsetLeft;
        this.lastMouseY = event.clientY - this.canvas.offsetTop;
    }

    onMouseUp(event) {
        this.isMouseDown = false;
    }

    /**
     * @return {ImageData}
     */
    getUnderlyingBufferCopy(context = this.context) {
        return context.getImageData(0, 0, this.width, this.height);
    }

    /**
     * Paint the whole canvas black and set opacity to maximum.
     */
    reset(customContext = this.context) {
        const imageData = this.getUnderlyingBufferCopy(customContext);
        const buffer = imageData.data;
        buffer.fill(0);
        // raise opacity levels
        for (let i = 3; i < buffer.length; i += 4) {
            buffer[i] = 255;
        }
        customContext.putImageData(imageData, 0, 0);
    }

    canvasCoordToDataIndex(x, y) {
        return 4 * (y * this.width + x);
    }

    canvasCoordToLevelIndex(x, y) {
        return y * this.width + x;
    }

    setLevelAtCoord(x, y, level) {
        this.levelByAutomatonIndex[this.canvasCoordToLevelIndex(x, y)] = level;
    }

    getLevelAtCoord(x, y) {
        return this.levelByAutomatonIndex[this.canvasCoordToLevelIndex(x, y)];
    }

    isPixelBlank(buffer, x, y) {
        const [r, g, b] = this.getRGB(buffer, x, y);
        return (r + g + b) === 0;
    }

    paintSectors() {
        const x = this.width / 2;
        const y = this.height / 2;
        const radius = this.width;

        this.context.beginPath();
        this.context.moveTo(x, y);
        this.context.arc(x, y, radius, 0, 2 * Math.PI / 3, false);
        this.context.lineTo(x, y);
        this.context.fillStyle = "green";
        this.context.fill();

        this.context.beginPath();
        this.context.moveTo(x, y);
        this.context.arc(x, y, radius, 2 * Math.PI / 3, 4 * Math.PI / 3, false);
        this.context.lineTo(x, y);
        this.context.fillStyle = "blue";
        this.context.fill();

        this.context.beginPath();
        this.context.moveTo(x, y);
        this.context.arc(x, y, radius, 4 * Math.PI / 3, 0, false);
        this.context.lineTo(x, y);
        this.context.fillStyle = "red";
        this.context.fill();

        this.clearMargins();
        this.resetLevelsAndSaturateChannels();
    }

    clearMargins() {
        // do not let the pixels in the border be painted
        const imageData = this.getUnderlyingBufferCopy();
        const buffer = imageData.data;
        for (let x = 0; x < this.width; x++) {
            this.setRGB(buffer, x, 0, 0, 0, 0);
            this.setRGB(buffer, x, this.height-1, 0, 0, 0);
        }
        for (let y = 0; y < this.height; y++) {
            this.setRGB(buffer, 0, y, 0, 0, 0);
            this.setRGB(buffer, this.width-1, y, 0, 0, 0);
        }
        this.context.putImageData(imageData, 0, 0);
    }

    transposeDrawingAndReset(x0, y0, x1, y1) {
        const inputImageData = this.getUnderlyingBufferCopy(this.drawingContext);
        const inputBuffer = inputImageData.data;
        const outputImageData = this.getUnderlyingBufferCopy();
        const outputBuffer = outputImageData.data;

        // ToDo extract method here (same code as resetLevelsAndSaturateChannels())
        for (const y of range(y0, y1)) {
            for (const x of range(x0, x1)) {
                const [r, g, b] = this.getRGB(inputBuffer, x, y);
                if (r + g + b === 0) {
                    continue;
                }
                if (r > 200 && g > 200 && b > 200) {  // consider this as white
                    // white input translates into black output
                    outputBuffer[this.canvasCoordToDataIndex(x, y) + 0] = 0;
                    outputBuffer[this.canvasCoordToDataIndex(x, y) + 1] = 0;
                    outputBuffer[this.canvasCoordToDataIndex(x, y) + 2] = 0;
                } else if (r > 0 && r > g && r > b) {  // red is the predominant color
                    outputBuffer[this.canvasCoordToDataIndex(x, y) + 0] = 255;
                    outputBuffer[this.canvasCoordToDataIndex(x, y) + 1] = 0;
                    outputBuffer[this.canvasCoordToDataIndex(x, y) + 2] = 0;
                } else if (g > 0 && g > r && g > b) {  // green is the predominant color
                    outputBuffer[this.canvasCoordToDataIndex(x, y) + 0] = 0;
                    outputBuffer[this.canvasCoordToDataIndex(x, y) + 1] = 255;
                    outputBuffer[this.canvasCoordToDataIndex(x, y) + 2] = 0;
                } else if (b > 0 && b > r && b > g) {  // blue is the predominant color
                    outputBuffer[this.canvasCoordToDataIndex(x, y) + 0] = 0;
                    outputBuffer[this.canvasCoordToDataIndex(x, y) + 1] = 0;
                    outputBuffer[this.canvasCoordToDataIndex(x, y) + 2] = 255;
                }
                this.setLevelAtCoord(x, y, this.simulation.initialLevel);
            }
        }

        // reset drawing canvas
        inputBuffer.fill(0);
        this.drawingContext.putImageData(inputImageData, 0, 0);

        this.context.putImageData(outputImageData, 0, 0);
    }

    resetLevelsAndSaturateChannels(x0 = 0, y0 = 0, x1 = this.width, y1 = this.height) {
        // now find all colored pixels and raise their levels
        const imageData = this.getUnderlyingBufferCopy();
        const buffer = imageData.data;

        // ToDo extract method here (same code as transposeDrawingAndReset())
        for (let y = y0; y < y1; y++) {
            for (let x = x0; x < x1; x++) {
                const [r, g, b] = this.getRGB(buffer, x, y);
                if (r + g + b === 0) {
                    continue;
                }
                if (r > 0 && r > g && r > b) {  // red is the predominant color
                    buffer[this.canvasCoordToDataIndex(x, y) + 0] = 255;
                    buffer[this.canvasCoordToDataIndex(x, y) + 1] = 0;
                    buffer[this.canvasCoordToDataIndex(x, y) + 2] = 0;
                } else if (g > 0 && g > r && g > b) {  // green is the predominant color
                    buffer[this.canvasCoordToDataIndex(x, y) + 0] = 0;
                    buffer[this.canvasCoordToDataIndex(x, y) + 1] = 255;
                    buffer[this.canvasCoordToDataIndex(x, y) + 2] = 0;
                } else if (b > 0 && b > r && b > g) {  // blue is the predominant color
                    buffer[this.canvasCoordToDataIndex(x, y) + 0] = 0;
                    buffer[this.canvasCoordToDataIndex(x, y) + 1] = 0;
                    buffer[this.canvasCoordToDataIndex(x, y) + 2] = 255;
                }
                this.setLevelAtCoord(x, y, this.simulation.initialLevel);
            }
        }
        this.context.putImageData(imageData, 0, 0);
    }

    paintRandomPoints(howMany) {
        const imageData = this.getUnderlyingBufferCopy();
        const buffer = imageData.data;

        for (let i = 0; i < howMany; i++) {
            const x = 1 + Math.trunc(Math.random() * (this.width - 2));
            const y = 1 + Math.trunc(Math.random() * (this.height - 2));
            if (!this.isPixelBlank(buffer, x, y)) {
                continue; // we don't want to color it again; also, don't bother decrementing i
            }
            const rgOrB = Math.trunc(Math.random() * 3);
            buffer[this.canvasCoordToDataIndex(x, y) + rgOrB] = 255;
            this.setLevelAtCoord(x, y, this.simulation.initialLevel);
        }

        this.context.putImageData(imageData, 0, 0);
    }

    /**
     * Prepares two copies of this canvas' underlying buffer: one for reading and another for writing. It's important
     * that the writing buffer is not used for reading, since it may read something that was written in this same
     * drawing iteration, compromising the simulation's global state integrity.
     *
     * @param {function(Uint8ClampedArray, Uint8ClampedArray)} callback - will be called when the two copies are ready
     */
    doWork(callback) {
        const originalImageData = this.getUnderlyingBufferCopy();
        const originalBuffer = originalImageData.data;

        const workingImageData = this.getUnderlyingBufferCopy();
        const workingBuffer = workingImageData.data;

        callback.call(this, originalBuffer, workingBuffer);

        this.context.putImageData(workingImageData, 0, 0);
    }

    getRGB(buffer, x, y) {
        const r = buffer[this.canvasCoordToDataIndex(x, y) + 0];
        const g = buffer[this.canvasCoordToDataIndex(x, y) + 1];
        const b = buffer[this.canvasCoordToDataIndex(x, y) + 2];
        return [r, g, b];
    }

    setRGB(buffer, x, y, r, g, b) {
        buffer[this.canvasCoordToDataIndex(x, y) + 0] = r;
        buffer[this.canvasCoordToDataIndex(x, y) + 1] = g;
        buffer[this.canvasCoordToDataIndex(x, y) + 2] = b;
    }
}

function *range(begin, end) {
    let increment = begin < end ? 1 : -1;
    for (let i = begin; increment > 0 ? i < end : i > end; i += increment) {
        yield i;
    }
}

class RockPaperAutomata {

    static getCssVariableNumber(variableName) {
        return parseInt(window.getComputedStyle(document.body).getPropertyValue(variableName), 10);
    }

    update() {
        window.requestAnimationFrame(this.update.bind(this));

        if (this.isPaused) {
            return;
        }

        const self = this;

        this.timing.measure("do-work", () => {
            this.uiCanvas.doWork(/** @this {Canvas} */ function (originalBuffer, workingBuffer) {
                const algorithm = self.algorithm === "waves" ? self.wavesAlgorithm : self.randomAlgorithm;

                // iterate over all pixels except for the ones in the border, just to simplify neighbor comparisons
                for (const y of range(1, this.height - 1)) {
                    for (const x of range(1, this.width - 1)) {

                        let dx, dy;
                        switch (self.neighborPickingMode) {
                            case RockPaperAutomata.NEIGHBOR_PICKING_MODE_RANDOM:
                                // pick a random neighbor - may pick the pixel itself, no big deal
                                dx = Math.trunc(Math.random() * 3) - 1;
                                dy = Math.trunc(Math.random() * 3) - 1;
                                break;
                            case RockPaperAutomata.NEIGHBOR_PICKING_MODE_FIXED:
                                [dx, dy] = self.fixedNeighborPicks[self.fixedNeighborPicksIndex];
                                self.fixedNeighborPicksIndex =
                                    (self.fixedNeighborPicksIndex + 1) & self.fixedNeighborMask;
                                break;
                            case RockPaperAutomata.NEIGHBOR_PICKING_MODE_PRE_RANDOM:
                                [dx, dy] = self.randomNeighborPicks[self.randomNeighborPicksIndex];
                                self.randomNeighborPicksIndex =
                                    (self.randomNeighborPicksIndex + 1) & self.randomNeighborMask;
                                break;
                            default:
                                throw new Error("Unknown neighbor picking mode!");
                        }

                        algorithm(x, y, x + dx, y + dy, this, originalBuffer, workingBuffer);
                    }
                }
            });
        });
    }

    randomAlgorithm(x, y, nx, ny, canvas, originalBuffer, workingBuffer) {
        const neighborLevel = canvas.getLevelAtCoord(nx, ny);
        if (neighborLevel === 0) {
            return;  // ha, neighbor cannot eat me!
        }

        const [r, g, b] = canvas.getRGB(originalBuffer, x, y);
        const [nr, ng, nb] = canvas.getRGB(originalBuffer, nx, ny);

        // rock-paper-scissors algorithm
        if (r + g + b === 0) {  // blank pixel
            canvas.setRGB(workingBuffer, x, y, nr, ng, nb);
            canvas.setLevelAtCoord(x, y, neighborLevel);
        } else if (r > 0 && ng > 0) {  // green eats red
            canvas.setRGB(workingBuffer, x, y, 0, ng, 0);
            canvas.setLevelAtCoord(nx, ny, neighborLevel + 1);
            canvas.setLevelAtCoord(x, y, this.initialLevel);
        } else if (g > 0 && nb > 0) {  // blue eats green
            canvas.setRGB(workingBuffer, x, y, 0, 0, nb);
            canvas.setLevelAtCoord(nx, ny, neighborLevel + 1);
            canvas.setLevelAtCoord(x, y, this.initialLevel);
        } else if (b > 0 && nr > 0) {  // red eats blue
            canvas.setRGB(workingBuffer, x, y, nr, 0, 0);
            canvas.setLevelAtCoord(nx, ny, neighborLevel + 1);
            canvas.setLevelAtCoord(x, y, this.initialLevel);
        }
    }

    wavesAlgorithm(x, y, nx, ny, canvas, originalBuffer, workingBuffer) {
        const neighborLevel = canvas.getLevelAtCoord(nx, ny);
        if (neighborLevel === 0) {
            return;  // ha, neighbor cannot eat me!
        }

        const myLevel = canvas.getLevelAtCoord(x, y);
        if (myLevel > this.edibleLevel) {
            canvas.setLevelAtCoord(x, y, myLevel - 1);
            return;  // too young to be eaten
        }
        const [r, g, b] = canvas.getRGB(originalBuffer, x, y);
        const [nr, ng, nb] = canvas.getRGB(originalBuffer, nx, ny);

        // rock-paper-scissors algorithm
        if (r + g + b === 0) {  // blank pixel
            canvas.setRGB(workingBuffer, x, y, nr, ng, nb);
            canvas.setLevelAtCoord(x, y, neighborLevel);
        } else if (r > 0 && ng > 0 && (!this.youngBanquetMode || neighborLevel > myLevel)) {  // green eats red
            canvas.setRGB(workingBuffer, x, y, 0, ng, 0);
            canvas.setLevelAtCoord(nx, ny, this.initialLevel);
            canvas.setLevelAtCoord(x, y, this.initialLevel);
        } else if (g > 0 && nb > 0 && (!this.youngBanquetMode || neighborLevel > myLevel)) {  // blue eats green
            canvas.setRGB(workingBuffer, x, y, 0, 0, nb);
            canvas.setLevelAtCoord(nx, ny, this.initialLevel);
            canvas.setLevelAtCoord(x, y, this.initialLevel);
        } else if (b > 0 && nr > 0 && (!this.youngBanquetMode || neighborLevel > myLevel)) {  // red eats blue
            canvas.setRGB(workingBuffer, x, y, nr, 0, 0);
            canvas.setLevelAtCoord(nx, ny, this.initialLevel);
            canvas.setLevelAtCoord(x, y, this.initialLevel);
        } else {
            // aging
            canvas.setLevelAtCoord(x, y, myLevel - 1);
        }
    }

    loadInitialCanvas(setup) {
        this.uiCanvas =
            new Canvas(this, /** @type {HTMLCanvasElement} */ document.getElementById("canvas"), this.canvasWidth,
                this.canvasHeight);
        switch (setup) {
            case "clear":
                this.uiCanvas.reset();
                break;
            case "sectors":
                this.uiCanvas.paintSectors();
                break;
            case "points":
                this.uiCanvas.paintRandomPoints(100);
                break;
        }
    }

    constructor () {
        const self = this;
        const width = RockPaperAutomata.getCssVariableNumber("--canvas-width");
        const height = RockPaperAutomata.getCssVariableNumber("--canvas-height");
        this.canvasWidth = width;
        this.canvasHeight = height;

        // metrics
        this.automataCountElement = document.getElementById("automata-count");
        this.automataCountElement.innerText = (width * height).toString();
        const updateDurationElement = document.getElementById("update-duration");
        this.timing = new Timing();
        this.timing.on("do-work", (value) => updateDurationElement.innerText = value.toFixed(0));

        // algorithm selection
        this.algorithm = "waves";
        document.getElementById("algorithm-random").addEventListener("click", () => this.algorithm = "random");
        document.getElementById("algorithm-waves").addEventListener("click", () => this.algorithm = "waves");

        // levels
        this.initialLevel = RockPaperAutomata.INITIAL_LEVEL;
        this.edibleLevel = RockPaperAutomata.EDIBLE_LEVEL;
        document.getElementById("initial-level").addEventListener("change", function () {
            self.initialLevel = parseInt(this.value, 10);
        });
        document.getElementById("edible-level").addEventListener("change", function () {
            self.edibleLevel = parseInt(this.value, 10);
        });

        // neighbor picking mode selection
        this.neighborPickingMode = RockPaperAutomata.NEIGHBOR_PICKING_MODE_RANDOM;
        document.querySelectorAll('[name="neighbor-selection"]')
            .forEach(elem => elem.addEventListener("change", function () {
                switch (this.value) {
                    case "random": return self.neighborPickingMode = RockPaperAutomata.NEIGHBOR_PICKING_MODE_RANDOM;
                    case "fixed": return self.neighborPickingMode = RockPaperAutomata.NEIGHBOR_PICKING_MODE_FIXED;
                    case "pre-random": return self.neighborPickingMode = RockPaperAutomata.NEIGHBOR_PICKING_MODE_PRE_RANDOM;
                }
            }));
        // fixed neighbors
        this.fixedNeighborPicks = [[1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]];
        this.fixedNeighborMask = this.fixedNeighborPicks.length - 1;
        this.fixedNeighborPicksIndex = 0;
        // pre-selected random values
        const randomPicksLength = 128;  // must be power of two!
        this.randomNeighborPicks = Array.from(Array(randomPicksLength), () => [
            Math.trunc(Math.random() * 3) - 1, Math.trunc(Math.random() * 3) - 1]);
        this.randomNeighborMask = this.randomNeighborPicks.length - 1;
        this.randomNeighborPicksIndex = 0;

        /** If true, a cell must be younger than its prey to be able to eat it */
        this.youngBanquetMode = true;

        this.uiCanvas = null;
        document.getElementById("initial-state-clear")
            .addEventListener("click", () => this.loadInitialCanvas("clear"));
        document.getElementById("initial-state-sectors")
            .addEventListener("click", () => this.loadInitialCanvas("sectors"));
        document.getElementById("initial-state-points")
            .addEventListener("click", () => this.loadInitialCanvas("points"));
        this.loadInitialCanvas("sectors");

        function colorButtonClick() {
            const color = this.dataset.color;
            if (this.classList.contains("pressed")) {
                this.classList.remove("pressed");
                self.uiCanvas.setPaintColor("black");
            } else {
                redButton.classList.remove("pressed");
                greenButton.classList.remove("pressed");
                blueButton.classList.remove("pressed");
                this.classList.add("pressed");
                self.uiCanvas.setPaintColor(color);
            }
        }
        const redButton = document.getElementById("button-red");
        redButton.addEventListener("click", colorButtonClick);
        const greenButton = document.getElementById("button-green");
        greenButton.addEventListener("click", colorButtonClick);
        const blueButton = document.getElementById("button-blue");
        blueButton.addEventListener("click", colorButtonClick);

        this.isPaused = false;
        document.getElementById("playback").addEventListener("click", function () {
            self.isPaused = !self.isPaused;
            this.value = self.isPaused ? "Play" : "Pause";
        });

        window.requestAnimationFrame(this.update.bind(this));
    }

    static get INITIAL_LEVEL() { return 30; }
    static get EDIBLE_LEVEL() { return 1; }
    static get NEIGHBOR_PICKING_MODE_RANDOM() { return 0; }
    static get NEIGHBOR_PICKING_MODE_FIXED() { return 1; }
    static get NEIGHBOR_PICKING_MODE_PRE_RANDOM() { return 2; }
}

window.addEventListener("load", () => new RockPaperAutomata());
