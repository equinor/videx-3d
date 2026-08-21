import { useEffect, useRef } from 'react';
import { Material, Mesh, Object3D, ShaderMaterial, Side } from 'three';
import {
  attachOitVariants,
  isOitCapable,
  makeOitCompatible,
} from './oit-material';

/**
 * Props for {@link OitMaterial}.
 * @expand
 */
export type OitMaterialProps = {
  /**
   * Force a specific `side` on the OIT variants (e.g. `DoubleSide`). Defaults to
   * the material's own side.
   */
  side?: Side;
  /**
   * Names of custom uniform-container properties on the material to share by
   * reference with the per-pass variants. Only needed for non-`ShaderMaterial`
   * materials that read a custom uniforms object in `onBeforeCompile`.
   */
  shareUniforms?: string[];
  /**
   * Names of value properties (e.g. `color`, `metalness`) to keep live on the
   * per-pass variants of a cloned built-in material. See
   * {@link OitMaterialOptions.syncProperties}. Ignored for `ShaderMaterial`s
   * (already live via shared uniforms).
   */
  syncProperties?: string[];
  /**
   * - `inject` (default): patch the material's shaders at compile time (stock or
   *   inline materials whose shader does not already include `oit.glsl`).
   * - `attach`: the material's shader already `#include`s `oit.glsl` and calls
   *   `oitProcess` (library materials); only wire up the variant machinery.
   */
  mode?: 'inject' | 'attach';
};

/**
 * A declarative helper that makes the material of its parent `mesh` participate in
 * the {@link OITRenderPass} pipeline, so transparent inline materials are resolved
 * order-independently instead of being treated as opaque occluders.
 *
 * Drop it in as a sibling of the material, inside the `mesh`:
 *
 * ```tsx
 * <mesh geometry={geometry}>
 *   <shaderMaterial
 *     uniforms={uniforms}
 *     vertexShader={vertexShader}
 *     fragmentShader={fragmentShader}
 *     transparent
 *   />
 *   <OitMaterial side={DoubleSide} />
 * </mesh>
 * ```
 *
 * It renders an invisible, empty `object3D` purely to locate the parent mesh; the
 * wiring is idempotent and a no-op outside the OIT pipeline.
 *
 * @group Rendering
 * @see {@link makeOitCompatible}
 * @see {@link attachOitVariants}
 */
export function OitMaterial({
  side,
  shareUniforms,
  syncProperties,
  mode = 'inject',
}: OitMaterialProps) {
  const ref = useRef<Object3D>(null!);

  // No dependency array: re-check after every commit so a recreated material gets
  // wired. The isOitCapable guard makes repeat runs cheap.
  useEffect(() => {
    const mesh = ref.current?.parent as Mesh | null;
    const material = mesh?.material as Material | Material[] | undefined;
    if (!material) return;

    const list = Array.isArray(material) ? material : [material];
    for (const m of list) {
      if (!m || isOitCapable(m)) continue;
      if (mode === 'attach') {
        attachOitVariants(m as ShaderMaterial, {
          side,
          shareUniforms,
          syncProperties,
        });
      } else {
        makeOitCompatible(m, { side, shareUniforms, syncProperties });
      }
    }
  });

  return <object3D ref={ref} visible={false} />;
}
