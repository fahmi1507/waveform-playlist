import {
  FADEIN,
  FADEOUT,
  SCURVE,
  LINEAR,
  EXPONENTIAL,
  LOGARITHMIC,
} from "fade-maker";
import { sCurve, logarithmic, linear, exponential } from "fade-curves";

/*
 * virtual-dom hook for drawing the fade curve to the canvas element.
 */
class FadeCanvasHook {
  constructor(type, shape, duration, samplesPerPixel, drawStart = 0, drawEnd = 1) {
    this.type = type;
    this.shape = shape;
    this.duration = duration;
    this.samplesPerPixel = samplesPerPixel;
    this.drawStart = drawStart; // Start percentage (0 = bottom, 1 = top)
    this.drawEnd = drawEnd; // End percentage
  }

  static createCurve(shape, type, width) {
    let reflection;
    let curve;

    switch (type) {
      case FADEIN: {
        reflection = 1;
        break;
      }
      case FADEOUT: {
        reflection = -1;
        break;
      }
      default: {
        throw new Error("Unsupported fade type.");
      }
    }

    switch (shape) {
      case SCURVE: {
        curve = sCurve(width, reflection);
        break;
      }
      case LINEAR: {
        curve = linear(width, 1);
        break;
      }
      case EXPONENTIAL: {
        curve = exponential(width, reflection);
        break;
      }
      case LOGARITHMIC: {
        curve = logarithmic(width, 10, reflection);
        break;
      }
      default: {
        throw new Error("Unsupported fade shape");
      }
    }

    return curve;
  }

  hook(canvas, prop, prev) {
    // Prevent unnecessary redraws if properties haven't changed
    if (
      prev !== undefined &&
      prev.shape === this.shape &&
      prev.type === this.type &&
      prev.duration === this.duration &&
      prev.samplesPerPixel === this.samplesPerPixel &&
      prev.drawStart === this.drawStart &&
      prev.drawEnd === this.drawEnd
    ) {
      return;
    }

    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    const curve = FadeCanvasHook.createCurve(this.shape, this.type, width);
    const len = curve.length;

    // Adjust fade start and end positions
    const yStart = height - (height * this.drawStart); // Start position
    const yEnd = height - (height * this.drawEnd); // End position

    // Clear the canvas before drawing
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();

    // Set line style
    ctx.strokeStyle = "black";
    ctx.lineWidth = 2;

    // Start drawing the fade-in curve
    ctx.beginPath();
    ctx.moveTo(0, yStart);

    for (let i = 1; i < len; i += 1) {
      const progress = i / len; // Normalize progress (0 to 1)
      const y = yStart + (yEnd - yStart) * curve[i]; // Interpolate position
      ctx.lineTo(i, y);
    }

    // Apply the final stroke to draw the curve
    ctx.stroke();
    ctx.restore();
  }


}

export default FadeCanvasHook;
