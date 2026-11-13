import {
  Color,
  type IUniform,
  type Material,
  Uniform,
  Vector2,
  Vector3,
  Vector4,
} from 'three';
import type { Vec3 } from '../types/common';
import {
  type WaterOptics,
  waterColorOf,
  waterExtinctionOf,
} from '../weather/water-optics';
import waterBodyShader from './shaderLib/water-body.glsl';

/**
 * A body of water, as what lies in it reads it: its surface's height along up, how far down
 * its seabed lies, its look ({@link WaterOptics}) and the daylight. The sea that draws it (an
 * `Ocean`, a `Scenery`'s sea, a `ChunkStack`'s water) keeps it in step; what lies in the water
 * fades by it (`water-body.glsl`'s `waterBodyFog`, or {@link applyWaterFog} for a stock
 * material), so data under the sea fades as the sea's own seabed does. Its uniforms are bound
 * by reference: one change reaches every material reading it.
 *
 * @group Materials
 */
export class WaterBody {
  readonly uniforms: {
    uWaterBody: IUniform<Vector4>;
    uWaterBodyFloor: IUniform<Vector2>;
    uWaterBodyExtinction: IUniform<Vector3>;
    uWaterBodyColor: IUniform<Color>;
  } = {
    uWaterBody: new Uniform(new Vector4(0, 1, 0, 0)),
    uWaterBodyFloor: new Uniform(new Vector2(1e30, 1)),
    uWaterBodyExtinction: new Uniform(new Vector3()),
    uWaterBodyColor: new Uniform(new Color()),
  };

  /** the surface's height along {@link up}, world units. Default 0 */
  get level(): number {
    return this.uniforms.uWaterBody.value.w;
  }
  set level(value: number) {
    this.uniforms.uWaterBody.value.w = value;
  }

  /** the world's up (unit). Default +Y */
  get up(): Vec3 {
    const { x, y, z } = this.uniforms.uWaterBody.value;
    return [x, y, z];
  }
  set up([x, y, z]: Vec3) {
    const length = Math.hypot(x, y, z) || 1;
    const v = this.uniforms.uWaterBody.value;
    v.set(x / length, y / length, z / length, v.w);
  }

  /** how far down the seabed lies under the surface: below it is ground, not water. Default none */
  get depth(): number {
    return this.uniforms.uWaterBodyFloor.value.x;
  }
  set depth(value: number) {
    this.uniforms.uWaterBodyFloor.value.x =
      Number.isFinite(value) && value >= 0 ? value : 1e30;
  }

  /** the daylight, 0 (night) to 1 (day): night keeps a little in the water. Default 1 */
  get daylight(): number {
    return this.uniforms.uWaterBodyFloor.value.y;
  }
  set daylight(value: number) {
    this.uniforms.uWaterBodyFloor.value.y = Math.min(Math.max(value, 0), 1);
  }

  /** the water's look (`waterOpticsOf`); `null`, no water: nothing fades */
  set optics(value: Required<WaterOptics> | null) {
    const extinction = this.uniforms.uWaterBodyExtinction.value;
    if (!value) {
      extinction.set(0, 0, 0);
      return;
    }
    extinction.fromArray(waterExtinctionOf(value));
    this.uniforms.uWaterBodyColor.value.fromArray(waterColorOf(value));
  }

  /** Bind these uniforms, by reference, into a material's `uniforms`. */
  bind(uniforms: Record<string, IUniform>): void {
    Object.assign(uniforms, this.uniforms);
  }
}

// The point drawn, in the world: from three's own view position, so whatever moved the vertex
// (instancing, batching, a globe) is in it.
const WORLD_VERTEX = /* glsl */ `#include <project_vertex>
vWaterBodyWorld = cameraPosition + transpose(mat3(viewMatrix)) * mvPosition.xyz;`;

/**
 * Fade what `material` draws by `body`'s water, as the library's own materials fade
 * (`water-body.glsl`): for a stock material (any three builds with `#include <project_vertex>`
 * and `#include <opaque_fragment>`). Patches its `onBeforeCompile`, after whatever it held, and
 * binds the body's uniforms by reference. Before or after `makeOitCompatible`: the fade comes
 * before the transparency's output either way. Returns the material.
 *
 * @group Materials
 */
export function applyWaterFog<T extends Material>(
  material: T,
  body: WaterBody,
): T {
  const before = material.onBeforeCompile;
  const key = material.customProgramCacheKey();
  material.onBeforeCompile = function (shader, renderer) {
    before.call(this, shader, renderer);
    Object.assign(shader.uniforms, body.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vWaterBodyWorld;',
      )
      .replace('#include <project_vertex>', WORLD_VERTEX);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nvarying vec3 vWaterBodyWorld;\n${waterBodyShader}`,
      )
      .replace(
        '#include <opaque_fragment>',
        '#include <opaque_fragment>\ngl_FragColor.rgb = waterBodyFog(gl_FragColor.rgb, vWaterBodyWorld);',
      );
  };
  material.customProgramCacheKey = () => `${key}|water`;
  material.needsUpdate = true;
  return material;
}
