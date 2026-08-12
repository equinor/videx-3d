import {
  AdditiveBlending,
  Color,
  DoubleSide,
  ShaderMaterial,
  Uniform,
  Vector2,
} from 'three';

// Reuses the trajectory vertex shader so the ghost reconstructs the exact same tube +
// caps (radius uniform + screen-space minPixelRadius floor) as the visible material.
import fragmentShader from './shaders/highlight-frag.glsl';
import vertexShader from './shaders/vertex.glsl';

/**
 * Additive "ghost" material for highlighting the unified {@link Trajectory}. It is
 * attached to the trajectory meshes via `userData.highlightMaterial`, which the
 * {@link Highlighter} prefers over its default `MeshBasicMaterial` — so the highlight
 * silhouette matches the displaced instanced-tube geometry (which a stock material
 * cannot reconstruct).
 *
 * Keep `radius`, `minPixelRadius` and `sizeMultiplier` in sync with the visible
 * material, and set `resolution` from the render-target size (as the visible material
 * does) so the screen-space floor matches.
 */
export class TrajectoryHighlightMaterial extends ShaderMaterial {
  isTrajectoryHighlightMaterial = true;

  constructor() {
    // Only the uniforms the ghost actually needs are provided. The reused trajectory
    // vertex shader also references `wellLength`, `measuredTop` and `uvWorld` (for the
    // map UVs / axial depth), but the highlight fragment ignores `vAxial` and the map,
    // so those are intentionally omitted here and default to 0 — harmless for the ghost.
    super({
      vertexShader,
      fragmentShader,
      uniforms: {
        diffuse: new Uniform(new Color(0xffffff)),
        opacity: new Uniform(1),
        sizeMultiplier: new Uniform(1),
        radius: new Uniform(0.5),
        minPixelRadius: new Uniform(1),
        resolution: new Uniform(new Vector2(1, 1)),
      },
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      clipping: true,
    });
  }

  get color(): Color {
    return this.uniforms.diffuse.value;
  }

  set color(color: Color) {
    this.uniforms.diffuse.value.set(color);
  }

  get radius(): number {
    return this.uniforms.radius.value;
  }

  set radius(v: number) {
    this.uniforms.radius.value = v;
  }

  get sizeMultiplier(): number {
    return this.uniforms.sizeMultiplier.value;
  }

  set sizeMultiplier(v: number) {
    this.uniforms.sizeMultiplier.value = v;
  }

  get minPixelRadius(): number {
    return this.uniforms.minPixelRadius.value;
  }

  set minPixelRadius(v: number) {
    this.uniforms.minPixelRadius.value = v;
  }

  setResolution(width: number, height: number) {
    this.uniforms.resolution.value.set(width, height);
  }
}
