// Helpers the Storybook benches share (cloud-bench.ts, sea-bench.ts).

export type Stat = { median: number; p90: number; max: number; mean: number };

export const median = (values: number[]) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
};

export const round2 = (x: number) => Math.round(x * 100) / 100;

export function stat(values: number[]): Stat {
  if (values.length === 0) return { median: 0, p90: 0, max: 0, mean: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return {
    median: round2(at(0.5)),
    p90: round2(at(0.9)),
    max: round2(sorted[sorted.length - 1]),
    mean: round2(values.reduce((a, b) => a + b, 0) / values.length),
  };
}

export const nextFrame = () =>
  new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
export const sleep = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));

// The methods a debugging hook was seen wrapping (a getError per draw: two synchronous round
// trips to the GPU process each, 88 % of the main thread, 2026-11-10).
const WATCHED = [
  'drawArrays',
  'drawElements',
  'drawArraysInstanced',
  'drawElementsInstanced',
  'useProgram',
  'getError',
  'readPixels',
  'texImage2D',
  'texSubImage2D',
  'texSubImage3D',
  'bufferData',
  'bufferSubData',
];

/** The WebGL methods something has wrapped: CPU timings are off while any is. */
export function hookedWebGL(): string[] {
  const proto = WebGL2RenderingContext.prototype as unknown as Record<
    string,
    unknown
  >;
  return WATCHED.filter(name => {
    const method = proto[name];
    return (
      typeof method === 'function' &&
      !/\[native code\]/.test(Function.prototype.toString.call(method))
    );
  });
}

/** A fixed dot in the page's top left while a measurement runs (red: hands off), green after. */
export function indicate(busy: boolean) {
  let dot = document.getElementById('bench-dot');
  if (!dot) {
    dot = document.createElement('div');
    dot.id = 'bench-dot';
    Object.assign(dot.style, {
      position: 'fixed',
      left: '6px',
      top: '6px',
      width: '16px',
      height: '16px',
      borderRadius: '50%',
      zIndex: '100000',
      pointerEvents: 'none',
    });
    document.body.appendChild(dot);
  }
  dot.style.background = busy ? 'red' : 'limegreen';
}

/** The GPU WebGL reports it draws with, when it says. */
export function gpuName(gl: WebGL2RenderingContext): string {
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  return info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
}
