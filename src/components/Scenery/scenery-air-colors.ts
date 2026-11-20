import {
  BufferGeometry,
  Camera,
  ClampToEdgeWrapping,
  HalfFloatType,
  IUniform,
  LinearFilter,
  Mesh,
  NoBlending,
  RepeatWrapping,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Texture,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { renderAside } from '../../sdk/utils/render-aside';
import fragmentShader from './shaders/sky-air-colors-fragment.glsl';

/** Bearings round the camera the air's colours are drawn for: 0.7° apart. */
export const SKY_AIR_BEARINGS = 512;
// Its rows: the horizon's colour, the sky some 25° up, the sky overhead.
const ROWS = 3;

const vertexShader = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const at = new Vector3();

/**
 * The colours the air fades what it hazes into, as a camera sees them
 * (`sky-air-colors.glsl`): along each bearing about its look, the horizon's colour and the sky
 * some 25° up, and the sky overhead. Drawn by a small pass of its own for each place a camera
 * draws from, at most once per render, so the relief's, the sea's and the clouds' haze read
 * them from a lookup rather than each holding the sky's surface three times over (its compile
 * time, and its work at every pixel). Shares the sky's uniform objects; the sky owns it.
 */
export class SkyAirColors {
  readonly target: WebGLRenderTarget;
  readonly scene = new Scene();
  readonly mesh: Mesh<BufferGeometry, ShaderMaterial>;
  /**
   * Whether its program has compiled (`precompile`), set by its owner: until then it is not
   * drawn, as drawing a program still compiling stalls the browser's GPU process.
   */
  ready = false;
  private readonly uniforms: Record<string, IUniform>;
  private readonly drawnAt = new Vector3(NaN, NaN, NaN);
  private drawnFrame = -1;

  /**
   * @param uniforms the sky's, which it reads and whose `uSkyAirEast` / `uSkyAirNorth` it sets
   * @param geometry a triangle covering clip space (`createSceneryGeometry`), its own from now
   */
  constructor(uniforms: Record<string, IUniform>, geometry: BufferGeometry) {
    this.uniforms = uniforms;
    this.target = new WebGLRenderTarget(SKY_AIR_BEARINGS, ROWS, {
      type: HalfFloatType,
      format: RGBAFormat,
      depthBuffer: false,
      generateMipmaps: false,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      wrapS: RepeatWrapping,
      wrapT: ClampToEdgeWrapping,
    });
    this.target.texture.name = 'scenery-air-colors';
    this.mesh = new Mesh(
      geometry,
      new ShaderMaterial({
        name: 'scenery-air-colors',
        vertexShader,
        fragmentShader,
        uniforms,
        defines: { SKY_AIR_PASS: '', SKY_AIR_BEARINGS },
        depthTest: false,
        depthWrite: false,
        blending: NoBlending,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.layers.enableAll();
    this.scene.add(this.mesh);
  }

  get texture(): Texture {
    return this.target.texture;
  }

  /**
   * Draw the colours as `camera` sees them, unless they are drawn for its place already in
   * this render. Call it after the sky's camera uniforms are set for `camera`
   * (`SceneryMaterial.syncCamera`), before what reads them draws: it may be called while
   * `renderer` draws a scene, whose target and settings it leaves as they were. Drawn with
   * `camera` itself, as what reads them sees the sky by its `cameraPosition`.
   */
  update(renderer: WebGLRenderer, camera: Camera) {
    if (!this.ready) return;
    at.setFromMatrixPosition(camera.matrixWorld);
    if (
      renderer.info.render.frame === this.drawnFrame &&
      at.equals(this.drawnAt)
    )
      return;
    this.drawnAt.copy(at);
    this.setFrame();
    renderAside(renderer, () => {
      renderer.setRenderTarget(this.target);
      renderer.render(this.scene, camera);
    });
    // Its own render counted: what draws after it in the same render finds it drawn.
    this.drawnFrame = renderer.info.render.frame;
  }

  // The bearings' frame, level about the look the camera sees the sky by (globeCameraLook):
  // east as the sky's, or its north where the look lies near east.
  private setFrame() {
    const u = this.uniforms;
    skyAirFrame(
      u.uGlobeCameraLook.value as Vector3,
      u.uSkyEast.value as Vector3,
      u.uSkyNorth.value as Vector3,
      u.uSkyAirEast.value as Vector3,
      u.uSkyAirNorth.value as Vector3,
    );
  }

  dispose() {
    this.target.dispose();
    this.mesh.material.dispose();
    this.mesh.geometry.dispose();
  }
}

/**
 * The air's lookup's bearings' frame (`uSkyAirEast`, `uSkyAirNorth`), level about `look` (unit),
 * the up the camera sees the sky by: `skyEast` made level there, or `skyNorth` where `look`
 * lies near `skyEast`, and north a quarter turn on. Writes `east` and `north`, unit and at right
 * angles to `look` and to each other.
 */
export function skyAirFrame(
  look: Vector3,
  skyEast: Vector3,
  skyNorth: Vector3,
  east: Vector3,
  north: Vector3,
) {
  const reference = Math.abs(look.dot(skyEast)) < 0.9 ? skyEast : skyNorth;
  east.copy(reference).addScaledVector(look, -reference.dot(look)).normalize();
  north.crossVectors(look, east);
}
