import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';
import {
  BufferGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Layers,
  Material,
} from 'three';
import { CommonComponentProps } from '../../common/types';
import { PointerEvents } from '../../events/interaction-events';
import { SymbolsType } from '../../sdk/data/types/Symbol';
import {
  EventEmitterCallback,
  useEventEmitter,
} from '../EventEmitter/EventEmitterContext';

/**
 * Symbol props
 * @expand
 */
export type SymbolProps = {
  geometry: BufferGeometry;
  material: Material | Material[];
  data: SymbolsType;
  customDepthMaterial?: Material;
  customDistanceMaterial?: Material;
} & PointerEvents &
  CommonComponentProps;

/**
 * Many copies of one mesh, drawn as a single instanced mesh: `Symbols` instances a `geometry`
 * and `material`, each copy placed by a matrix of its own and, optionally, coloured by its own
 * colour (`data`, a `SymbolsType`). Use it for a large number of meshes that share a shape and a
 * look but are moved or coloured one by one, such as markers along a wellbore: the `Shoes` and
 * `FormationMarkers` components use it.
 *
 * @remarks
 * Data, including colors, transformations and user defined data, must be mapped to the `SymbolsType` type.
 *
 * @example
 *  <Symbols
 *    position={position}
 *    data={data}
 *    geometry={geometry}
 *    material={material}
 *    layers={layers}
 *  />
 *
 * @see {@link SymbolsType}
 * @see [InstancedMesh](https://threejs.org/docs/#api/en/objects/InstancedMesh)
 *
 * @group Components
 */
export const Symbols = forwardRef<Group, SymbolProps>(
  (
    {
      name,
      position,
      userData,
      castShadow,
      receiveShadow,
      renderOrder,
      visible,
      data,
      geometry,
      material,
      layers,
      onPointerClick,
      onPointerEnter,
      onPointerLeave,
      onPointerMove,
    },
    ref,
  ) => {
    const eventHandler = useEventEmitter();

    const groupRef = useRef<Group>(null);

    const object = useMemo(() => {
      const count = data.transformations.length / 16;
      if (count === 0) return null;
      const mesh = new InstancedMesh(geometry, material, count);

      mesh.instanceMatrix.set(data.transformations);
      mesh.instanceMatrix.needsUpdate = true;
      if (data.colors) {
        mesh.instanceColor = new InstancedBufferAttribute(data.colors, 3);
        mesh.instanceColor.needsUpdate = true;
      }

      if (layers) {
        const mask =
          layers instanceof Layers ? layers.mask : (layers as number);
        mesh.layers.mask = mask;
      }

      mesh.castShadow = !!castShadow;
      mesh.receiveShadow = !!receiveShadow;

      return mesh;
    }, [geometry, material, data, layers, castShadow, receiveShadow]);

    useImperativeHandle(ref, () => groupRef.current!);

    // register event handlers
    useEffect(() => {
      let unregister: (() => void) | null = null;
      if (eventHandler && groupRef.current) {
        const handlers: Record<string, EventEmitterCallback> = {};

        if (onPointerClick) handlers.click = onPointerClick;
        if (onPointerEnter) handlers.enter = onPointerEnter;
        if (onPointerLeave) handlers.leave = onPointerLeave;
        if (onPointerMove) handlers.move = onPointerMove;

        if (Object.keys(handlers).length) {
          unregister = eventHandler.register({
            object: groupRef.current,
            handlers,
          });
        }
      }

      return () => {
        if (unregister) unregister();
      };
    }, [
      eventHandler,
      object,
      onPointerClick,
      onPointerEnter,
      onPointerLeave,
      onPointerMove,
    ]);

    useEffect(() => {}, []);

    return (
      <group
        ref={groupRef}
        name={name}
        userData={userData}
        renderOrder={renderOrder}
        position={position}
        visible={visible}
      >
        {object && <primitive object={object} />}
      </group>
    );
  },
);
