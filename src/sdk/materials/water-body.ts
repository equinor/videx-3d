import {
  Color,
  type IUniform,
  type Material,
  Matrix3,
  type Texture,
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
    uWaterBodyExtent: IUniform<Vector4>;
    uWaterBodyBed: IUniform<Texture | null>;
    uWaterBodyBedToUv: IUniform<Matrix3>;
    uWaterBodyBedInfo: IUniform<Vector4>;
  } = {
    uWaterBody: new Uniform(new Vector4(0, 1, 0, 0)),
    uWaterBodyFloor: new Uniform(new Vector2(1e30, 1)),
    uWaterBodyExtinction: new Uniform(new Vector3()),
    uWaterBodyColor: new Uniform(new Color()),
    uWaterBodyExtent: new Uniform(new Vector4(-1e30, -1e30, 1e30, 1e30)),
    uWaterBodyBed: new Uniform<Texture | null>(null),
    uWaterBodyBedToUv: new Uniform(new Matrix3()),
    uWaterBodyBedInfo: new Uniform(new Vector4()),
  };

  /** what last wrote this body ({@link copyFrom}), so it alone lets go of it */
  owner: unknown = null;

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

  /**
   * Where the water lies, world X and Z (`[minX, minZ, maxX, maxZ]`): what lies beside it
   * is seen through air. `null`, everywhere. Default everywhere
   */
  set extent(value: readonly [number, number, number, number] | null) {
    const v = this.uniforms.uWaterBodyExtent.value;
    if (value) v.set(value[0], value[1], value[2], value[3]);
    else v.set(-1e30, -1e30, 1e30, 1e30);
  }

  /**
   * The seabed's heights (`buildSurfaceDepthMap`'s packing: R the height, G the validity):
   * `toUv` takes world X/Z to its uv, and a height `h` is `yScale·h + yOffset` in the world.
   * Where it covers, the water ends at it; elsewhere at {@link depth}. `null`, none.
   */
  setBed(
    bed: {
      texture: Texture;
      toUv: Matrix3;
      yScale?: number;
      yOffset?: number;
    } | null,
  ): void {
    const info = this.uniforms.uWaterBodyBedInfo.value;
    if (!bed) {
      this.uniforms.uWaterBodyBed.value = null;
      info.set(0, 0, 1, 0);
      return;
    }
    const image = bed.texture.image as { width: number; height: number };
    this.uniforms.uWaterBodyBed.value = bed.texture;
    this.uniforms.uWaterBodyBedToUv.value.copy(bed.toUv);
    info.set(image.width, image.height, bed.yScale ?? 1, bed.yOffset ?? 0);
  }

  /** Take `from`'s water, every value, as `owner`'s. */
  copyFrom(from: WaterBody, owner: unknown = from): void {
    const a = this.uniforms;
    const b = from.uniforms;
    a.uWaterBody.value.copy(b.uWaterBody.value);
    a.uWaterBodyFloor.value.copy(b.uWaterBodyFloor.value);
    a.uWaterBodyExtinction.value.copy(b.uWaterBodyExtinction.value);
    a.uWaterBodyColor.value.copy(b.uWaterBodyColor.value);
    a.uWaterBodyExtent.value.copy(b.uWaterBodyExtent.value);
    a.uWaterBodyBed.value = b.uWaterBodyBed.value;
    a.uWaterBodyBedToUv.value.copy(b.uWaterBodyBedToUv.value);
    a.uWaterBodyBedInfo.value.copy(b.uWaterBodyBedInfo.value);
    this.owner = owner;
  }

  /** Let go of the water, if `owner` holds it: nothing fades by it any more. */
  release(owner: unknown): void {
    if (this.owner !== owner) return;
    this.owner = null;
    this.optics = null;
    this.setBed(null);
  }
}

const SCENE_WATER = new WeakMap<object, WaterBody>();

/**
 * The water of a scene (one per scene): what the sea drawn in it writes (an `Ocean`'s or a
 * `ChunkStack`'s surface as it renders, a `Scenery`'s sea each frame), and what the library's
 * materials there read, wherever they lie in the tree. No water until a sea writes it.
 *
 * @group Materials
 */
export function sceneWaterBody(scene: object): WaterBody {
  let water = SCENE_WATER.get(scene);
  if (!water) {
    water = new WaterBody();
    SCENE_WATER.set(scene, water);
  }
  return water;
}

// The point drawn, in the world: from three's own view position, so whatever moved the vertex
// (instancing, batching, a globe) is in it.
const WORLD_VERTEX = /* glsl */ `#include <project_vertex>
vWaterBodyWorld = cameraPosition + transpose(mat3(viewMatrix)) * mvPosition.xyz;`;

const PATCHED = new WeakSet<Material>();

/**
 * Fade what `material` draws by `body`'s water, as the library's own materials fade
 * (`water-body.glsl`): what lies in the water column fades by its path through it, as under
 * any sea. For a stock material, or a `ShaderMaterial` built the same way: it needs
 * `#include <common>` in both shaders, and `#include <fog_fragment>` (else
 * `#include <opaque_fragment>`) in its fragment `main`; the point is taken from
 * `#include <project_vertex>`, else from the `vViewPosition` varying the OIT chunk reads.
 * Patches its `onBeforeCompile`, after whatever it held, and binds the body's uniforms by
 * reference; a material is patched once. Before `makeOitCompatible`/`attachOitVariants`
 * build their variants (on the first render): they take the patch along. Returns the material.
 *
 * @group Materials
 */
export function applyWaterFog<T extends Material>(
  material: T,
  body: WaterBody,
): T {
  if (PATCHED.has(material)) return material;
  PATCHED.add(material);
  const before = material.onBeforeCompile;
  const key = material.customProgramCacheKey();
  material.onBeforeCompile = function (shader, renderer) {
    before.call(this, shader, renderer);
    Object.assign(shader.uniforms, body.uniforms);
    const varying = shader.vertexShader.includes('#include <project_vertex>');
    if (varying)
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying vec3 vWaterBodyWorld;',
        )
        .replace('#include <project_vertex>', WORLD_VERTEX);
    const world = varying
      ? 'vWaterBodyWorld'
      : 'waterBodyWorldOf(vViewPosition)';
    const anchor = shader.fragmentShader.includes('#include <fog_fragment>')
      ? '#include <fog_fragment>'
      : '#include <opaque_fragment>';
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\n${varying ? 'varying vec3 vWaterBodyWorld;\n' : ''}${waterBodyShader}`,
      )
      .replace(
        anchor,
        `${anchor}\ngl_FragColor.rgb = waterBodyFog(gl_FragColor.rgb, ${world});`,
      );
  };
  material.customProgramCacheKey = () => `${key}|water`;
  material.needsUpdate = true;
  return material;
}
