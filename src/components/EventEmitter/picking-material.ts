import {
  Camera,
  DoubleSide,
  Material,
  NoBlending,
  Object3D,
  Scene,
  ShaderMaterial,
  Uniform,
  UniformsUtils,
  WebGLRenderer,
} from 'three';
import { BufferGeometry } from 'three/webgpu';
import { RenderableObject } from './EventEmitter';
import fragmentShader from './shaders/pick_frag.glsl';
import vertexShader from './shaders/pick_vertex.glsl';

export const pickingMaterialUniforms = {
  emitterId: new Uniform(0),
  side: new Uniform(2),
};

export class PickingMaterial extends ShaderMaterial {
  constructor() {
    super({
      vertexShader,
      fragmentShader,
      uniforms: UniformsUtils.clone(pickingMaterialUniforms),
      toneMapped: false,
      blending: NoBlending,
      side: DoubleSide,
      forceSinglePass: true,
    });
    // Caps carry a shared `xz` + per-layer `y` and no `position`; the absent
    // attribute defaults to 0 so one picking material serves both layouts.
    (
      this as unknown as { defaultAttributeValues: Record<string, number[]> }
    ).defaultAttributeValues = { position: [0, 0, 0], xz: [0, 0], y: [0] };
  }

  dispose(): void {
    super.dispose();
  }

  onBeforeRender(
    _renderer: WebGLRenderer,
    _scene: Scene,
    _camera: Camera,
    _geometry: BufferGeometry,
    object: Object3D,
  ): void {
    const renderableObject = object as RenderableObject;
    const emitterId = object.userData.__emitterID || 0;
    const side = Array.isArray(renderableObject.material)
      ? renderableObject.material[0].side
      : renderableObject.material.side;
    const needsUpdate =
      this.uniforms.emitterId.value !== emitterId ||
      this.uniforms.side.value !== side;

    if (needsUpdate) {
      this.uniforms.emitterId.value = emitterId;
      this.uniforms.side.value = side;
      this.uniformsNeedUpdate = true;
    }
  }
}

export class CustomPickingMaterial extends PickingMaterial {
  constructor(vertexShader?: string, uniforms?: Record<string, Uniform>) {
    super();
    if (vertexShader) this.vertexShader = vertexShader;
    if (uniforms) {
      this.uniforms = UniformsUtils.merge([this.uniforms, uniforms]);
    }
    this.allowOverride = false;
  }
}

// ⚠️ A WeakMap, not `userData`: `Material.copy` JSON-clones `userData`, and materials get
// cloned (the OIT pass variants, for one).
const pickingMaterials = new WeakMap<Material, Material>();

/**
 * Pick every mesh drawn with `material` using `picking` instead of the default pick
 * material — for a material that discards fragments, so what is picked matches what is
 * drawn. A mesh's own `userData.emitterMaterial` still takes precedence. `null` removes it.
 *
 * @group Components
 */
export function setPickingMaterial(
  material: Material,
  picking: Material | null,
): void {
  if (picking) pickingMaterials.set(material, picking);
  else pickingMaterials.delete(material);
}

/** The picking material registered for `material`, if any (see {@link setPickingMaterial}). */
export function getPickingMaterial(material: Material): Material | undefined {
  return pickingMaterials.get(material);
}
