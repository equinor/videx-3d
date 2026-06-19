import { useEffect, useMemo, useState } from 'react';
import {
  BackSide,
  BufferGeometry,
  FrontSide,
  ShaderLib,
  ShaderMaterial,
  Uniform,
  UniformsUtils,
} from 'three';
import {
  CommonComponentProps,
  createLayers,
  LAYERS,
  useGenerator,
  useWellboreContext,
} from '../../../main';
import { makeOitCompatible } from '../../../rendering/oit-material';
import { unpackBufferGeometry } from '../../../sdk';
import fragmentShader from './shaders/fragment.glsl';
import vertexShader from './shaders/vertex.glsl';
import {
  wellboreFormationColumn,
  WellboreFormationColumnResponse,
} from './wellbore-formation-column-defs';

/**
 * WellboreFormationColumn props
 * @expand
 */
export type WellboreFormationColumnProps = CommonComponentProps & {
  stratColumnId: string;
  units?: string[];
  unitTypes?: string[];
  inverted?: boolean;
  opacity?: number;
  radialSegments?: number;
  startRadius?: number;
  formationWidth?: number;
  priority?: number;
};

/**
 * Renders colored tube geometeries for visualizing formations for a specific strat column.
 *
 * @example
 * <Wellbore id={wellboreId}>
 *  <WellboreFormationColumn stratColumnId="abcde" />
 * </Wellbore>
 *
 * @see [Storybook](/videx-3d/?path=/docs/components-wellbores-wellboreformationcolumn--docs)
 * @see {@link Wellbore}
 *
 * @group Components
 */
export const WellboreFormationColumn = ({
  name,
  userData,
  position,
  opacity = 1,
  castShadow,
  receiveShadow,
  renderOrder,
  layers = createLayers(LAYERS.NOT_EMITTER),
  visible,
  stratColumnId,
  units,
  unitTypes,
  inverted = true,
  radialSegments = 16,
  startRadius = 0.5,
  formationWidth = 1,
  priority = 0,
}: WellboreFormationColumnProps) => {
  const { id, fromMsl, segmentsPerMeter, simplificationThreshold } =
    useWellboreContext();
  const generator = useGenerator<WellboreFormationColumnResponse>(
    wellboreFormationColumn,
    priority,
  );

  const [geometry, setGeometry] = useState<BufferGeometry | null>(null);

  const uniforms = useMemo(
    () =>
      UniformsUtils.merge([
        UniformsUtils.clone(ShaderLib['basic'].uniforms),
        {
          opacity: new Uniform(1),
        },
      ]),
    [],
  );

  // Imperative material so it can be made OIT-capable (the shader has no
  // vViewPosition, so makeOitCompatible auto-injects it). No-op outside an
  // OITRenderPass; under OIT it is resolved as transparent geometry instead of
  // occluding trajectories behind it.
  const side = inverted ? BackSide : FrontSide;
  const material = useMemo(() => {
    const m = new ShaderMaterial({
      vertexColors: true,
      side,
      vertexShader,
      fragmentShader,
      uniforms,
      depthTest: true,
      depthWrite: true,
    });
    return makeOitCompatible(m, { side });
  }, [uniforms, side]);

  useEffect(() => {
    uniforms.opacity.value = opacity;
    material.transparent = opacity === undefined || opacity < 1;
  }, [opacity, uniforms, material]);

  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  useEffect(() => {
    if (generator) {
      generator(
        id,
        stratColumnId,
        segmentsPerMeter,
        fromMsl,
        units,
        unitTypes,
        startRadius,
        formationWidth,
        !inverted,
        radialSegments,
        simplificationThreshold,
      ).then((response: any) => {
        let bufferGeometry: BufferGeometry | null = null;
        if (response) {
          bufferGeometry = unpackBufferGeometry(response);
        }
        setGeometry(prev => {
          if (prev) prev.dispose();
          return bufferGeometry;
        });
      });
    }
  }, [
    generator,
    id,
    stratColumnId,
    fromMsl,
    units,
    unitTypes,
    segmentsPerMeter,
    simplificationThreshold,
    startRadius,
    formationWidth,
    radialSegments,
    inverted,
  ]);

  if (!geometry) return null;

  return (
    <mesh
      name={name}
      position={position}
      userData={userData}
      renderOrder={renderOrder}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
      visible={visible}
      layers={layers}
      geometry={geometry}
      material={material}
    />
  );
};
