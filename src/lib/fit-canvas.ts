/** Scale a native-resolution canvas with CSS transform so emscripten
 *  does not resize the drawing buffer to the bezel. */
export function fitNativeCanvas(
  canvas: HTMLCanvasElement,
  box: HTMLElement,
  native: { width: number; height: number },
) {
  const r = box.getBoundingClientRect();
  const pad = 8;
  const availW = Math.max(native.width, r.width - pad);
  const availH = Math.max(native.height, r.height - pad);
  const scale = Math.min(availW / native.width, availH / native.height);
  canvas.style.position = "absolute";
  canvas.style.left = "50%";
  canvas.style.top = "50%";
  canvas.style.width = `${native.width}px`;
  canvas.style.height = `${native.height}px`;
  canvas.style.transform = `translate(-50%, -50%) scale(${scale})`;
  canvas.style.transformOrigin = "center center";
  canvas.style.imageRendering = "pixelated";
  canvas.style.display = "block";
}
