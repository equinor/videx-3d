import { useEffect, useMemo, useState } from 'react';
import {
  CircleGeometry,
  Color,
  DoubleSide,
  ShaderMaterial,
  Texture,
  Uniform,
  Vector2,
} from 'three';
import { useGenerator } from '../../../hooks/useGenerator';
import { useWellboreContext } from '../../../hooks/useWellboreContext';
import { createLayers, LAYERS } from '../../../layers/layers';
import { SymbolsType } from '../../../sdk/data/types/Symbol';
import { PI2 } from '../../../sdk/utils/trigonometry';
import fragmentShader from '../../Grids/Grid/shaders/fragment.glsl';
import vertexShader from '../../Grids/Grid/shaders/vertex.glsl';
import { Symbols } from '../../Symbol/Symbol';
import { positionMarkers } from './position-markers-defs';

/**
 * Test
 */

type Props = {
  radius?: number;
  opacity?: number;
  interval?: number;
  priority?: number;
  renderOrder?: number;
};

export const PositionMarkers = ({
  radius = 20,
  opacity = 1.0,
  interval = 100,
  priority = 0,
  renderOrder,
}: Props) => {
  //const positionRef = useRef<Object3D>(null!)
  const { id, fromMsl } = useWellboreContext();
  const generator = useGenerator<SymbolsType>(positionMarkers, priority);

  const [data, setData] = useState<SymbolsType | null>(null);

  const geometry = useMemo(() => {
    //const g = new RingGeometry(1, 0.5, radialSegments, radialSegments)
    const g = new CircleGeometry(1, 128);
    g.rotateX(-PI2);
    return g;
  }, []);

  const material = useMemo(() => {
    const uniforms = {
      uSize: new Uniform(new Vector2(0, 0)),
      uBackground: new Uniform(new Color(0x808080)),
      uBackgroundOpacity: new Uniform(0),
      uOpacity: new Uniform(1.0),
      uCellSize: new Uniform(10),
      uSubDivisions: new Uniform(5),
      uOriginOffset: new Uniform(new Vector2(0, 0)),
      uDistanceFactor: new Uniform(0),
      uGridColorMajor: new Uniform(new Color('#fff')),
      uGridColorMinor: new Uniform(new Color('#ccc')),
      uGridLineWidth: new Uniform(0.001),
      uAxesOffset: new Uniform(new Vector2(0, 0)),
      uAxesColor: new Uniform(new Color('#c77')),
      uAxesLineWidth: new Uniform(1),
      uAxesTickSize: new Uniform(0.1),
      uProjectionTexture: new Uniform<Texture | undefined>(undefined),
    };
    const m = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
      defines: {
        RADIAL: true,
        DYNAMICSEGMENTS: false,
        AXES: false,
        RULERS: false,
      },
      side: DoubleSide,
      depthWrite: true,
      transparent: true,
    });
    //const m = new MeshBasicMaterial({ side: DoubleSide})
    return m;
  }, []);

  const layers = useMemo(() => createLayers(LAYERS.NOT_EMITTER), []);

  useEffect(() => {
    if (generator && id) {
      generator(id, radius, interval, fromMsl).then(response => {
        setData(response);
      });
    }
  }, [generator, id, fromMsl, radius, interval]);

  useEffect(() => {
    material.uniforms.uSize.value.set(radius * 2, radius * 2);
    material.uniforms.uOpacity.value = opacity;
  }, [radius, opacity, material]);

  return (
    <group renderOrder={renderOrder}>
      {data && (
        <Symbols
          data={data}
          geometry={geometry}
          material={material}
          layers={layers}
        />
      )}
    </group>
  );
};
