/** Sample a damped spring once; the browser compositor performs the animation. */
export function springProgress(steps = 32): number[] {
  const count = Number.isFinite(steps) ? Math.max(2, Math.min(120, Math.floor(steps))) : 32;
  return Array.from({ length: count + 1 }, (_, index) => {
    if (index === 0) return 0;
    if (index === count) return 1;
    const t = index / count;
    const damping = 8.8, frequency = 10.6;
    return 1 - Math.exp(-damping * t) * (Math.cos(frequency * t) + damping / frequency * Math.sin(frequency * t));
  });
}

export type SurfaceBox = { x: number; y: number; width: number; height: number };
export function surfaceFrames(from: SurfaceBox, to: SurfaceBox, closing = false, interrupted?: SurfaceBox) {
  const start = closing ? interrupted ?? to : from, end = closing ? from : to;
  if (![start.x, start.y, start.width, start.height, end.x, end.y, end.width, end.height, to.x, to.y, to.width, to.height].every(Number.isFinite) || to.width <= 0 || to.height <= 0 || start.width <= 0 || start.height <= 0 || end.width <= 0 || end.height <= 0) return [];
  return springProgress().map((value, index, all) => {
    // Closing uses a monotone curve to avoid bouncing beyond the originating card.
    const p = closing ? 1 - (1 - index / (all.length - 1)) ** 3 : value;
    const x = start.x + (end.x-start.x)*p, y = start.y + (end.y-start.y)*p;
    const width = start.width + (end.width-start.width)*p, height = start.height + (end.height-start.height)*p;
    return { offset: index / (all.length - 1), transform: `translate(${x-to.x}px, ${y-to.y}px) scale(${width/to.width}, ${height/to.height})` };
  });
}
