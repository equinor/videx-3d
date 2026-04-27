import type { Meta, StoryObj } from '@storybook/react-vite';
import { useCallback, useEffect, useRef } from 'react';
import { Color, Mesh, MeshStandardMaterial } from 'three';
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator';
import { EventEmitterDecorator } from '../../storybook/decorators/event-emitter-decorator';
import { EventEmitter } from './EventEmitter';
import { useEventEmitter } from './EventEmitterContext';

const meta = {
  title: 'Components/misc/EventEmitter',
  decorators: [EventEmitterDecorator, Canvas3dDecorator],
  component: EventEmitter,
} satisfies Meta<typeof EventEmitter>;

export default meta;
type Story = StoryObj<typeof meta>;

const COLOR_DEFAULT = new Color('#3a7bd5');
const COLOR_HOVER = new Color('#f0c040');
const COLOR_SELECTED = new Color('#44dd88');
const COLOR_TRIGGER_DEFAULT = new Color('#884488');
const COLOR_TRIGGER_HOVER = new Color('#cc66cc');

type TargetBoxProps = {
  position: [number, number, number];
  meshRef: (el: Mesh | null) => void;
  interactionReady: React.RefObject<boolean>;
};

function TargetBox({
  position,
  meshRef: setMeshRef,
  interactionReady,
}: TargetBoxProps) {
  const internalRef = useRef<Mesh>(null);
  const eventHandler = useEventEmitter();
  const isSelected = useRef(false);
  const isHovered = useRef(false);

  const setColor = useCallback((color: Color) => {
    if (internalRef.current) {
      (internalRef.current.material as MeshStandardMaterial).color.set(color);
    }
  }, []);

  useEffect(() => {
    setMeshRef(internalRef.current);
    return () => setMeshRef(null);
  }, [setMeshRef]);

  useEffect(() => {
    if (!eventHandler || !internalRef.current) return;

    return eventHandler.register({
      object: internalRef.current,
      handlers: {
        enter: () => {
          if (!interactionReady.current) return;
          isHovered.current = true;
          setColor(COLOR_HOVER);
        },
        leave: () => {
          isHovered.current = false;
          setColor(isSelected.current ? COLOR_SELECTED : COLOR_DEFAULT);
        },
        click: () => {
          isSelected.current = !isSelected.current;
          if (!isHovered.current) {
            setColor(isSelected.current ? COLOR_SELECTED : COLOR_DEFAULT);
          }
        },
      },
    });
  }, [eventHandler, setColor, interactionReady]);

  return (
    <mesh ref={internalRef} position={position}>
      <boxGeometry args={[1.2, 1.2, 1.2]} />
      <meshStandardMaterial color={COLOR_DEFAULT} />
    </mesh>
  );
}

type TriggerBoxProps = {
  position: [number, number, number];
  onTrigger: () => void;
};

function TriggerBox({ position, onTrigger }: TriggerBoxProps) {
  const meshRef = useRef<Mesh>(null);
  const eventHandler = useEventEmitter();

  const setColor = useCallback((color: Color) => {
    if (meshRef.current) {
      (meshRef.current.material as MeshStandardMaterial).color.set(color);
    }
  }, []);

  useEffect(() => {
    if (!eventHandler || !meshRef.current) return;

    return eventHandler.register({
      object: meshRef.current,
      handlers: {
        enter: () => setColor(COLOR_TRIGGER_HOVER),
        leave: () => setColor(COLOR_TRIGGER_DEFAULT),
        click: () => {
          onTrigger();
          setColor(COLOR_TRIGGER_HOVER);
        },
      },
    });
  }, [eventHandler, setColor, onTrigger]);

  return (
    <mesh ref={meshRef} position={position}>
      <boxGeometry args={[1.5, 1.5, 1.5]} />
      <meshStandardMaterial color={COLOR_TRIGGER_DEFAULT} />
    </mesh>
  );
}

function Scene() {
  const targetMeshes = useRef<(Mesh | null)[]>([null, null, null]);
  const interactionReady = useRef(false);
  const isLarge = useRef(false);

  useEffect(() => {
    const onPointerMove = () => {
      interactionReady.current = true;
      removeEventListener('pointermove', onPointerMove);
    };

    addEventListener('pointermove', onPointerMove, { passive: true });

    return () => {
      removeEventListener('pointermove', onPointerMove);
    };
  }, []);

  const toggleTargetsSize = useCallback(() => {
    isLarge.current = !isLarge.current;
    const scale = isLarge.current ? 1.7 : 1;

    targetMeshes.current.forEach(mesh => {
      if (!mesh) return;
      mesh.scale.setScalar(scale);
    });
  }, []);

  const positions: [number, number, number][] = [
    [-2.5, 0, 0],
    [0, 0, 0],
    [2.5, 0, 0],
  ];

  return (
    <>
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.6, 0]}>
        <planeGeometry args={[50, 50]} />
        <meshBasicMaterial color="#050533" />
      </mesh>
      <TriggerBox position={[0, 3, 0]} onTrigger={toggleTargetsSize} />
      {positions.map((pos, i) => (
        <TargetBox
          key={i}
          position={pos}
          interactionReady={interactionReady}
          meshRef={el => {
            targetMeshes.current[i] = el;
          }}
        />
      ))}
    </>
  );
}

export const Default: Story = {
  render: () => <Scene />,
  parameters: {
    autoClear: true,
    scale: 10,
    cameraPosition: [0, 6, 12],
  },
};
