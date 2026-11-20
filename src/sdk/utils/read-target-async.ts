import { WebGLRenderer, WebGLRenderTarget } from 'three';
import { renderAside } from './render-aside';

/**
 * Read a float or half-float render target back without stalling the page: its pixels as
 * RGBA floats, read on the GPU into a buffer of their own and handed over once a fence says the
 * GPU is done, a few milliseconds later. `faces` are a cube target's faces to read (0–5), one
 * after another in the result; default the one face a 2D target has.
 *
 * ⚠️ three's `readRenderTargetPixelsAsync` asks first whether the target's format and type can be
 * read (`IMPLEMENTATION_COLOR_READ_FORMAT`/`_TYPE`), and that question is a synchronous round
 * trip to the browser's GPU process: it waits for every command queued before it to run. Asked
 * once for each of a light probe's six faces, a frame's work behind it each time, the page stood
 * 59 ms (Iris Xe, 2026-11-10). RGBA/FLOAT needs no asking: a float colour buffer can always be read
 * so (WebGL 2, with `EXT_color_buffer_float`, which three enables).
 *
 * Rejects if the context is lost meanwhile.
 *
 * @group SDK
 */
export function readFloatTargetAsync(
  renderer: WebGLRenderer,
  target: WebGLRenderTarget,
  faces: readonly number[] = [0],
): Promise<Float32Array> {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const { width, height } = target;
  const floats = width * height * 4;
  const buffer = gl.createBuffer();
  if (!buffer) return Promise.reject(new Error('no buffer to read into'));
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
  gl.bufferData(
    gl.PIXEL_PACK_BUFFER,
    floats * 4 * faces.length,
    gl.STREAM_READ,
  );
  renderAside(renderer, () =>
    faces.forEach((face, k) => {
      renderer.setRenderTarget(target, face);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, k * floats * 4);
    }),
  );
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  gl.flush();

  return new Promise((resolve, reject) => {
    const done = (error?: Error) => {
      if (sync && !gl.isContextLost()) gl.deleteSync(sync);
      if (!gl.isContextLost()) gl.deleteBuffer(buffer);
      if (error) reject(error);
    };
    const poll = () => {
      if (gl.isContextLost() || !sync)
        return done(new Error('the context was lost'));
      // Not blocking: the status is the one last seen between tasks.
      if (gl.getSyncParameter(sync, gl.SYNC_STATUS) !== gl.SIGNALED) {
        setTimeout(poll, 4);
        return;
      }
      const pixels = new Float32Array(floats * faces.length);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, pixels);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      done();
      resolve(pixels);
    };
    setTimeout(poll, 4);
  });
}
