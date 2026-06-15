/**
 * Water wave physics mathematics and grid operations
 */

export function initGrid(size: number): number[][] {
  const grid: number[][] = [];
  for (let i = 0; i < size; i++) {
    grid[i] = new Array(size).fill(0);
  }
  return grid;
}

/**
 * Propagate the 2D finite difference wave equation.
 * current[x][y] = (previous[x-1][y] + previous[x+1][y] + previous[x][y-1] + previous[x][y+1]) / 2 - current[x][y]
 */
export function propagateWaves(
  current: number[][],
  previous: number[][],
  size: number,
  damping: number,
  waveSpeed: number = 1 // Controls updating interpolation
): { current: number[][]; previous: number[][] } {
  // We perform the propagation step
  // To avoid performance copy bottlenecks, we mutate current based on previous and then return them
  for (let x = 1; x < size - 1; x++) {
    for (let y = 1; y < size - 1; y++) {
      let waveValue = (
        previous[x - 1][y] +
        previous[x + 1][y] +
        previous[x][y - 1] +
        previous[x][y + 1]
      ) * 0.5 - current[x][y];

      // Damping represents viscosity (energy loss)
      waveValue *= damping;
      
      current[x][y] = waveValue;
    }
  }

  // Swap buffers
  return { current: previous, previous: current };
}

/**
 * Disturb the wave grid at a specific center coordinate with circular cosine falloff
 */
export function addDisturbance(
  grid: number[][],
  cx: number,
  cy: number,
  radius: number,
  force: number,
  size: number
) {
  // Safety bounds
  const intCx = Math.floor(cx);
  const intCy = Math.floor(cy);
  const intRadius = Math.ceil(radius);

  for (let x = -intRadius; x <= intRadius; x++) {
    for (let y = -intRadius; y <= intRadius; y++) {
      const gx = intCx + x;
      const gy = intCy + y;

      if (gx > 0 && gx < size - 1 && gy > 0 && gy < size - 1) {
        const dist = Math.sqrt(x * x + y * y);
        if (dist <= radius) {
          // Cosine dome falloff for organic ripple wave creation
          const factor = Math.cos((dist / radius) * (Math.PI / 2));
          grid[gx][gy] += force * factor;
        }
      }
    }
  }
}

/**
 * Normalizes a grid value or clamps it
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Converts a hex color string to RGB object
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  // Expand shorthand form (e.g. "03F") to full form (e.g. "0033FF")
  const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
  const fullHex = hex.replace(shorthandRegex, (_, r, g, b) => r + r + g + g + b + b);

  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(fullHex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : { r: 10, g: 80, b: 100 }; // default marine color fallback
}
