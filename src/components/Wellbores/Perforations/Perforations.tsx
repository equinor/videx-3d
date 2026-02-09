import { useFrame } from '@react-three/fiber';
import {
  ForwardedRef,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AdditiveBlending,
  ConeGeometry,
  Group,
  Material,
  ShaderMaterial,
  Uniform,
} from 'three';
import { useGenerator } from '../../../hooks/useGenerator';
import { useWellboreContext } from '../../../hooks/useWellboreContext';
import { createLayers, LAYERS } from '../../../layers/layers';
import { SymbolsType } from '../../../sdk/data/types/Symbol';
import { CommonComponentProps, CustomMaterialProps } from '../../common';
import { Symbols } from '../../Symbol/Symbol';
import { perforationSymbols } from './perforations-defs';
import fragmentShader from './shaders/fragment.glsl';
import vertexShader from './shaders/vertex.glsl';

/**
 * Perforations props
 * @expand
 */
export type PerforationsProps = CommonComponentProps &
  CustomMaterialProps & {
    radialSegments?: number;
    baseRadius?: number;
    length?: number;
    sizeMultiplier?: number;
    priority?: number;
  };

/**
 * Generic render of perforation intervals based on depths, phase and density. Must be a child of the `Wellbore` component.
 *
 * @example
 * <Wellbore id={wellbore.id}>
 *  <Perforations sizeMultiplier={5} />
 * </Wellbore>
 *
 * @see {@link Wellbore}
 *
 * @group Components
 */
export const Perforations = forwardRef(
  (
    {
      name,
      userData,
      renderOrder,
      layers = createLayers(LAYERS.NOT_EMITTER),
      position,
      visible,
      castShadow,
      receiveShadow,
      customMaterial,
      customDepthMaterial,
      customDistanceMaterial,
      onMaterialPropertiesChange,
      radialSegments = 8,
      baseRadius = 0.1,
      length = 1,
      sizeMultiplier = 1,
      priority = 0,
    }: PerforationsProps,
    fref: ForwardedRef<Group>,
  ) => {
    const ref = useRef<Group>(null);
    const matProps = useRef<Record<string, any>>({
      time: 0,
      baseRadius: 0,
      lenght: 0,
    });
    const { id, fromMsl } = useWellboreContext();
    const generator = useGenerator<SymbolsType>(perforationSymbols, priority);

    const [data, setData] = useState<SymbolsType | null>(null);

    useImperativeHandle(fref, () => ref.current!);

    const geometry = useMemo(() => {
      const g = new ConeGeometry(baseRadius, length, radialSegments);
      g.translate(0, length / 2, 0);

      return g;
    }, [baseRadius, length, radialSegments]);

    const material = useMemo(() => {
      const material =
        customMaterial ||
        new ShaderMaterial({
          uniforms: {
            uTime: new Uniform(0),
            uRadius: new Uniform(0),
            uLength: new Uniform(0),
          },
          vertexShader: vertexShader,
          fragmentShader: fragmentShader,
          depthTest: true,
          depthWrite: false,
          blending: AdditiveBlending,
          transparent: true,
        });

      return material;
    }, [customMaterial]);

    const onPropsChange = useMemo(() => {
      return onMaterialPropertiesChange
        ? onMaterialPropertiesChange
        : (props: Record<string, any>, material: Material | Material[]) => {
            const m = material as ShaderMaterial;
            m.uniforms.uTime.value = props.time;
            m.uniforms.uRadius.value = props.baseRadius;
            m.uniforms.uLength.value = props.length;
          };
    }, [onMaterialPropertiesChange]);

    useEffect(() => {
      matProps.current.baseRadius = baseRadius;
      matProps.current.length = length;
      onPropsChange(matProps.current, material);
    }, [baseRadius, length, material, onPropsChange]);

    useEffect(() => {
      if (generator && id) {
        generator(id, fromMsl, sizeMultiplier).then(response => {
          setData(response);
        });
      }
    }, [generator, id, fromMsl, sizeMultiplier]);

    useFrame(({ clock }) => {
      matProps.current.time = clock.elapsedTime;
      onPropsChange(matProps.current, material);
    });

    return (
      <group ref={ref}>
        {data && (
          <Symbols
            name={name}
            userData={userData}
            renderOrder={renderOrder}
            visible={visible}
            position={position}
            data={data}
            geometry={geometry}
            material={material}
            layers={layers}
            castShadow={castShadow}
            receiveShadow={receiveShadow}
            customDepthMaterial={customDepthMaterial}
            customDistanceMaterial={customDistanceMaterial}
          />
        )}
      </group>
    );
  },
);
