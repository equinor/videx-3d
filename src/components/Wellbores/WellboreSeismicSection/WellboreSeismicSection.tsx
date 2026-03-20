import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BufferGeometry,
  DataTexture,
  DoubleSide,
  FloatType,
  Group,
  LinearFilter,
  RedFormat,
  Texture,
  Uniform,
} from 'three';
import {
  colorRampTexture,
  CommonComponentProps,
  createLayers,
  EventEmitterCallback,
  LAYERS,
  PointerEvents,
  useEventEmitter,
  useGenerator
} from '../../../main';
import { unpackBufferGeometry } from '../../../sdk';
import fragmentShader from './shaders/frag.glsl';
import vertexShader from './shaders/vert.glsl';
import {
  wellboreSeismicSection,
  WellboreSeismicSectionGeneratorResponse,
} from './wellbore-seismic-section-defs';

/**
 * WellboreSeismicSection props
 * @expand
 */
export type WellboreSeismicSectionProps = CommonComponentProps &
  PointerEvents & {
    id: string;
    opacity?: number;
    stepSize?: number;
    minSize?: number;
    extension?: number;
    rangeOffset?: number;
    colorRampIndex?: number;
    defaultExtensionAngle?: number;
    priority?: number;
  };

/**
 * Renders a seismic fence along the trajectory of a wellbore.
 *
 * @example
 * <WellboreSeismicSection
 *   id={wellbore.id}
 *   stepSize={3}
 *   extension={1000}
 *   minSize={1000}
 *   opacity={0.9}
 * />
 *
 * @see [Storybook](/videx-3d/?path=/docs/components-wellbores-seismicsection--docs)
 * @see {@link Wellbore}
 *
 * @group Components
 */
export const WellboreSeismicSection = ({
  id,
  opacity = 1,
  stepSize = 3,
  extension = 0,
  minSize = 0,
  rangeOffset = 0,
  colorRampIndex = 6,
  defaultExtensionAngle = 0,
  priority = 0,
  name,
  userData,
  receiveShadow,
  castShadow,
  layers,
  position,
  renderOrder,
  visible = true,
  onPointerClick,
  onPointerEnter,
  onPointerLeave,
  onPointerMove,
}: WellboreSeismicSectionProps) => {
  const ref = useRef<Group>(null);

  const [geometry, setGeometry] = useState<BufferGeometry | null>(null);
  const [dataTexture, setDataTexture] = useState<DataTexture | null>(null);
  const [minMax, setMinMax] = useState([-1, 1]);

  const generator = useGenerator<WellboreSeismicSectionGeneratorResponse>(
    wellboreSeismicSection,
    priority,
  );

  const uniforms = useMemo(() => ({
    opacity: new Uniform<number>(1),
    data: new Uniform<Texture | null>(null),
    colorRampTexture: new Uniform<Texture>(colorRampTexture),
    colorRamps: new Uniform<number>(colorRampTexture.height),
    colorRampMin: new Uniform<number>(-1),
    colorRampMax: new Uniform<number>(1),
    colorRampIndex: new Uniform<number>(6),
  }), []);

  useEffect(() => {
    generator(id, stepSize, minSize, extension, defaultExtensionAngle).then(
      response => {
        if (response) {
          const bufferGeometry = unpackBufferGeometry(response.geometry);
          setGeometry(prev => {
            if (prev) {
              prev.dispose();
            }
            return bufferGeometry;
          });

          const dataTexture = new DataTexture(
            response.data.array,
            response.data.width,
            response.data.height,
            RedFormat,
            FloatType,
          );

          dataTexture.anisotropy = 4;
          dataTexture.magFilter = LinearFilter;
          dataTexture.minFilter = LinearFilter;
          dataTexture.flipY = true;
          dataTexture.needsUpdate = true;

          setMinMax([response.data.min, response.data.max]);

          setDataTexture(prev => {
            if (prev) {
              prev.dispose();
            }
            return dataTexture;
          });
        }
      },
    );
  }, [generator, id, stepSize, minSize, extension, defaultExtensionAngle]);

  const notEmitterLayers = useMemo(() => createLayers(LAYERS.NOT_EMITTER), []);

  useEffect(() => {
    uniforms.data.value = dataTexture;
    uniforms.opacity.value = opacity;
  }, [uniforms, opacity, dataTexture]);

  useEffect(() => {
    const range =
      Math.max(Math.abs(minMax[0]), Math.abs(minMax[1])) + rangeOffset;
    uniforms.colorRampMin.value = -range;
    uniforms.colorRampMax.value = range;
    uniforms.colorRampIndex.value = colorRampIndex;
  }, [uniforms, minMax, rangeOffset, colorRampIndex]);

  const eventHandler = useEventEmitter();
  // register event handlers
  useEffect(() => {
    let unregister: (() => void) | null = null;
    if (eventHandler && ref.current) {
      const handlers: Record<string, EventEmitterCallback> = {};

      if (onPointerClick) handlers.click = onPointerClick;
      if (onPointerEnter) handlers.enter = onPointerEnter;
      if (onPointerLeave) handlers.leave = onPointerLeave;
      if (onPointerMove) handlers.move = onPointerMove;

      if (Object.keys(handlers).length) {
        unregister = eventHandler.register({
          object: ref.current,
          handlers,
          ref: id,
        });
      }
    }

    return () => {
      if (unregister) unregister();
    };
  }, [
    eventHandler,
    onPointerClick,
    onPointerEnter,
    onPointerLeave,
    onPointerMove,
    id,
  ]);
  return (
    <group
      ref={ref}
      name={name}
      visible={visible}
      renderOrder={renderOrder}
      position={position}
      userData={userData}
    >
      {geometry && (
        <mesh
          castShadow={castShadow}
          receiveShadow={receiveShadow}
          geometry={geometry}
          layers={layers || notEmitterLayers}
        >
          <shaderMaterial
            vertexShader={vertexShader}
            fragmentShader={fragmentShader}
            uniforms={uniforms}
            side={DoubleSide}
            transparent={opacity < 1}
            opacity={opacity}
          />
        </mesh>
      )}
    </group>
  );
};
