/**
 * Shared helpers for the retro pixel-art background canvases
 * (dithered night city / grassy meadow, sakura, rain).
 *
 * Each scene renders into a small low-resolution buffer sized to a fixed
 * `pixelSize` factor of the viewport, then CSS stretches it with
 * `image-rendering: pixelated` so every source pixel becomes a crisp
 * square block — the chunky 8-bit look, consistent at any window size.
 */

/** 4×4 ordered Bayer matrix (values 0..15). */
const BAYER_4X4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const;

/** Ordered-dither threshold in [0, 1) for the pixel at (x, y). */
export function bayer(x: number, y: number): number {
  const yy = ((y % 4) + 4) % 4;
  const xx = ((x % 4) + 4) % 4;
  return BAYER_4X4[yy][xx] / 16;
}

/** Linear interpolation between two [r,g,b] colors. */
export function lerpRgb(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number,
): [number, number, number] {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/** True when the user has asked for reduced motion. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Size a canvas' internal buffer to the viewport divided by `pixelSize`.
 * Returns the low-res buffer dimensions to draw into.
 */
export function sizePixelCanvas(
  canvas: HTMLCanvasElement,
  pixelSize: number,
): { w: number; h: number } {
  const w = Math.max(1, Math.ceil(window.innerWidth / pixelSize));
  const h = Math.max(1, Math.ceil(window.innerHeight / pixelSize));
  canvas.width = w;
  canvas.height = h;
  return { w, h };
}
