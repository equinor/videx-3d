import { addAfterEffect, addEffect, useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { GpuTimer } from '../../../rendering';

/**
 * RenderStats props
 * @expand
 */
export type RenderStatsProps = {
  /**
   * DOM element the overlay is appended to. Defaults to the renderer canvas'
   * parent element (falling back to `document.body`).
   */
  parent?: HTMLElement | null;
  /** Corner the overlay is anchored to. */
  origin?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /** Pixel offset `[x, y]` from the anchored corner. */
  offset?: [number, number];
  /** UI refresh interval in milliseconds (the metrics themselves sample every frame). */
  interval?: number;
  /**
   * Measure real GPU time via `EXT_disjoint_timer_query_webgl2`. When the extension
   * is unavailable (e.g. some browsers, or the WebGPU renderer) the GPU row shows
   * `n/a`. Default `true`.
   */
  gpu?: boolean;
  /** Optional class name applied to the overlay container (for custom styling). */
  className?: string;
};

const ORIGIN_STYLES: Record<
  NonNullable<RenderStatsProps['origin']>,
  (x: number, y: number) => Partial<CSSStyleDeclaration>
> = {
  'top-left': (x, y) => ({ left: `${x}px`, top: `${y}px` }),
  'top-right': (x, y) => ({ right: `${x}px`, top: `${y}px` }),
  'bottom-left': (x, y) => ({ left: `${x}px`, bottom: `${y}px` }),
  'bottom-right': (x, y) => ({ right: `${x}px`, bottom: `${y}px` }),
};

/**
 * A lightweight render-statistics overlay for R3F. It reports metrics that the
 * usual FPS/frame-time counters miss and that matter most when profiling large
 * scenes:
 *
 * - **GPU** — actual GPU time per frame (via `EXT_disjoint_timer_query_webgl2`),
 *   which — unlike frame time — is not hidden by the vsync cap, so you can compare
 *   GPU cost even at a locked 60 fps.
 * - **Frame / FPS** — wall-clock frame time and rate.
 * - **Draw calls** and **Triangles** — accumulated across every render pass in the
 *   frame (it sets `renderer.info.autoReset = false` while mounted and resets once
 *   per frame), so multi-pass pipelines report a true per-frame total.
 * - **Geometries / Textures / Programs** — resident GPU resource counts.
 *
 * Measurement is non-invasive: it brackets the whole frame with global R3F
 * before/after callbacks rather than taking over the render loop, so it works with
 * the default loop, custom pipelines and effect composers alike.
 *
 * Place it inside a `<Canvas>` (it needs the renderer). It renders no 3D content —
 * only a DOM overlay appended to {@link RenderStatsProps.parent}.
 *
 * @remarks Debug/profiling tool. The GPU timer uses a `TIME_ELAPSED` query, and only
 * one such query can be active per WebGL context — do not enable `gpu` at the same
 * time as another consumer of the timer (e.g. `OITRenderPass.profile`).
 *
 * @group Components
 */
export const RenderStats = ({
  parent,
  origin = 'top-right',
  offset = [10, 10],
  interval = 200,
  gpu = true,
  className,
}: RenderStatsProps) => {
  const gl = useThree(state => state.gl);
  const [offsetX, offsetY] = offset;

  useEffect(() => {
    const host = parent ?? gl.domElement.parentElement ?? document.body;

    const container = document.createElement('div');
    if (className) container.className = className;
    Object.assign(container.style, {
      position: 'absolute',
      zIndex: '100',
      pointerEvents: 'none',
      padding: '6px 8px',
      borderRadius: '4px',
      background: 'rgba(0, 0, 0, 0.7)',
      color: '#fff',
      font: '11px/1.4 monospace',
      whiteSpace: 'pre',
      ...ORIGIN_STYLES[origin](offsetX, offsetY),
    } as Partial<CSSStyleDeclaration>);

    // label -> value cell
    const rows: Record<string, HTMLSpanElement> = {};
    const grid = document.createElement('div');
    Object.assign(grid.style, {
      display: 'grid',
      gridTemplateColumns: 'auto auto',
      columnGap: '10px',
    } as Partial<CSSStyleDeclaration>);

    const addRow = (label: string) => {
      const l = document.createElement('span');
      l.textContent = label;
      l.style.color = '#9cc';
      const v = document.createElement('span');
      v.style.textAlign = 'right';
      v.textContent = '—';
      grid.appendChild(l);
      grid.appendChild(v);
      rows[label] = v;
    };

    addRow('GPU');
    addRow('Frame');
    addRow('FPS');
    addRow('Calls');
    addRow('Tris');
    addRow('Geom');
    addRow('Tex');
    addRow('Prog');

    container.appendChild(grid);
    host.appendChild(container);

    const timer = gpu ? new GpuTimer(gl) : null;
    const gpuSupported = timer?.supported ?? false;

    const prevAutoReset = gl.info.autoReset;
    gl.info.autoReset = false;

    let emaFrameMs = -1;
    let lastTs: number | null = null;
    let lastReport = 0;

    const beforeUnsub = addEffect(() => {
      gl.info.reset();
      timer?.poll();
      timer?.begin('frame');
    });

    const afterUnsub = addAfterEffect((ts: number) => {
      timer?.end();

      if (lastTs !== null) {
        const dt = ts - lastTs;
        emaFrameMs = emaFrameMs < 0 ? dt : emaFrameMs * 0.9 + dt * 0.1;
      }
      lastTs = ts;

      if (ts - lastReport < interval) return;
      lastReport = ts;

      const gpuMs = timer?.get('frame') ?? -1;
      rows['GPU'].textContent = !gpuSupported
        ? 'n/a'
        : gpuMs < 0
          ? '…'
          : `${gpuMs.toFixed(2)} ms`;
      rows['Frame'].textContent =
        emaFrameMs < 0 ? '…' : `${emaFrameMs.toFixed(2)} ms`;
      rows['FPS'].textContent =
        emaFrameMs > 0 ? `${(1000 / emaFrameMs).toFixed(0)}` : '…';
      rows['Calls'].textContent = gl.info.render.calls.toLocaleString();
      rows['Tris'].textContent = gl.info.render.triangles.toLocaleString();
      rows['Geom'].textContent = gl.info.memory.geometries.toLocaleString();
      rows['Tex'].textContent = gl.info.memory.textures.toLocaleString();
      rows['Prog'].textContent = (
        gl.info.programs?.length ?? 0
      ).toLocaleString();
    });

    return () => {
      beforeUnsub();
      afterUnsub();
      timer?.dispose();
      gl.info.autoReset = prevAutoReset;
      host.removeChild(container);
    };
  }, [gl, parent, origin, offsetX, offsetY, interval, gpu, className]);

  return null;
};
