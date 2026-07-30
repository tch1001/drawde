import { Image, readCanvas } from 'image-js';

/**
 * Texo/UniMERNet image preprocessing.
 *
 * Ported faithfully from alephpi/Texo-web (app/composables/workers/imageProcessor.ts).
 * The model was trained on exactly this pipeline — greyscale, polarity-normalised,
 * margin-cropped, letterboxed to 384x384, then normalised with UniMERNet's
 * constants. Deviating here degrades accuracy silently rather than erroring, so
 * it is deliberately a straight port rather than a reinterpretation.
 */
const UNIMERNET_MEAN = 0.7931;
const UNIMERNET_STD = 0.1738;
export const TEXO_INPUT_SIZE = 384;

export async function preprocessImg(blob: Blob): Promise<Float32Array> {
  const bmp = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext('2d')!;
  // flatten transparency onto white, or alpha reads as black and inverts polarity
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0);
  bmp.close();

  let image = readCanvas(canvas as unknown as HTMLCanvasElement);
  image = image.grey();
  image = reverseColor(image);
  image = cropMargin(image);
  image = resize(image, TEXO_INPUT_SIZE, TEXO_INPUT_SIZE);
  return normalize(image);
}

/** Model expects dark-on-light; invert if the crop is mostly dark. */
function reverseColor(image: Image): Image {
  const histogram = image.histogram();
  const threshold = 200;
  const black = histogram.slice(0, threshold).reduce((s, v) => s + v, 0);
  const white = histogram.slice(threshold).reduce((s, v) => s + v, 0);
  return black >= white ? image.invert() : image;
}

/** Trim surrounding whitespace so the glyphs fill the frame. */
function cropMargin(image: Image): Image {
  const data = image.getRawImage().data as ArrayLike<number>;
  let max = -Infinity;
  let min = Infinity;
  for (let i = 0; i < data.length; i++) {
    if (data[i] > max) max = data[i];
    if (data[i] < min) min = data[i];
  }
  if (max === min) return image;

  const threshold = 200;
  let minX = image.width;
  let minY = image.height;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const normalized = ((data[y * image.width + x] - min) / (max - min)) * 255;
      if (normalized < threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (minX > maxX || minY > maxY) return image;
  // image-js takes an origin as {row, column}, not {x, y}
  return image.crop({
    origin: { row: minY, column: minX },
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  });
}

/**
 * Letterbox onto a white square, preserving aspect ratio.
 *
 * Scaling is done by the canvas rather than image-js: we already need a canvas
 * for the white padding, and drawImage gives smooth downscaling for free.
 */
function resize(image: Image, w: number, h: number): Image {
  const scale = Math.min(w / image.width, h / image.height);
  const targetW = Math.max(1, Math.round(image.width * scale));
  const targetH = Math.max(1, Math.round(image.height * scale));

  // greyscale -> RGBA so it can go through ImageData
  const grey = image.getRawImage().data as ArrayLike<number>;
  const rgba = new Uint8ClampedArray(image.width * image.height * 4);
  for (let i = 0; i < image.width * image.height; i++) {
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = grey[i];
    rgba[i * 4 + 3] = 255;
  }
  const src = new OffscreenCanvas(image.width, image.height);
  src.getContext('2d')!.putImageData(new ImageData(rgba, image.width, image.height), 0, 0);

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(
    src,
    Math.floor((w - targetW) / 2),
    Math.floor((h - targetH) / 2),
    targetW,
    targetH,
  );
  return readCanvas(canvas as unknown as HTMLCanvasElement).grey();
}

/** (pixel/255 - mean) / std, in the model's expected NCHW order. */
function normalize(image: Image): Float32Array {
  const data = image.getRawImage().data as ArrayLike<number>;
  const out = new Float32Array(TEXO_INPUT_SIZE * TEXO_INPUT_SIZE);
  for (let i = 0; i < out.length; i++) {
    out[i] = (data[i] / 255 - UNIMERNET_MEAN) / UNIMERNET_STD;
  }
  return out;
}
