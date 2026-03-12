import { useEffect, useMemo, useState } from 'react';
import { BufferGeometry, DataTexture, DoubleSide, FloatType, LinearFilter, RedFormat, Texture, Uniform } from 'three';
import { colorRampTexture, createLayers, LAYERS, useGenerator, useWellboreContext } from '../../../main';
import {
  unpackBufferGeometry
} from '../../../sdk';
import fragmentShader from './shaders/frag.glsl';
import vertexShader from './shaders/vert.glsl';
import { wellboreSeismicSection, WellboreSeismicSectionGeneratorResponse } from './wellbore-seismic-section-defs';


export type WellboreSeismicSectionProps = {
  opacity?: number;
  stepSize?: number;
  minSize?: number;
  extension?: number;
  rangeOffset?: number;
  colorRampIndex?: number;
  defaultExtensionAngle?: number;
  priority?: number;
};


const uniforms = {
  opacity: new Uniform<number>(1),
  data: new Uniform<Texture | null>(null),
  colorRampTexture: new Uniform<Texture>(colorRampTexture),
  colorRamps: new Uniform<number>(colorRampTexture.height),
  colorRampMin: new Uniform<number>(-1),
  colorRampMax: new Uniform<number>(1),
  colorRampIndex: new Uniform<number>(6),
}

export const WellboreSeismicSection = ({
  opacity = 1,
  stepSize = 3,
  extension = 0,
  minSize = 0,
  rangeOffset = 0,
  colorRampIndex = 6,
  defaultExtensionAngle = 0,
  priority = 0,
}: WellboreSeismicSectionProps) => {
  const { id } = useWellboreContext();
  const [geometry, setGeometry] = useState<BufferGeometry | null>(null);
  const [dataTexture, setDataTexture] = useState<DataTexture | null>(null);
  const [minMax, setMinMax] = useState([-1, 1]);

  const generator = useGenerator<WellboreSeismicSectionGeneratorResponse>(wellboreSeismicSection, priority);

  useEffect(() => {
    generator(id, stepSize, minSize, extension, defaultExtensionAngle).then(response => {
      if (response) {
        const bufferGeometry = unpackBufferGeometry(response.geometry);
        setGeometry(prev => {
          if (prev) {
            prev.dispose();
          }
          return bufferGeometry
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
            prev.dispose()
          }
          return dataTexture;
        })
      }
    })
  }, [generator, id, stepSize, minSize, extension, defaultExtensionAngle]);


  const layers = useMemo(() => createLayers(LAYERS.NOT_EMITTER), [])

  useEffect(() => {
    uniforms.data.value = dataTexture;
    uniforms.opacity.value = opacity;
  }, [opacity, dataTexture])

  useEffect(() => {
    const range = Math.max(Math.abs(minMax[0]), Math.abs(minMax[1])) + rangeOffset;
    uniforms.colorRampMin.value = -range;
    uniforms.colorRampMax.value = range;
    uniforms.colorRampIndex.value = colorRampIndex;
  }, [minMax, rangeOffset, colorRampIndex])

  return (
    <>
      {geometry && (
        <mesh geometry={geometry} layers={layers}>
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
    </>
  );
};
