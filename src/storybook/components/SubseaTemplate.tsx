import { useEffect, useMemo } from 'react';
import { MeshStandardMaterial } from 'three';

/**
 * A made-up subsea production template — the yellow structure in every field
 * layout drawing: a frame on legs, a manifold along it, and a row of wellhead
 * trees. Storybook only, and deliberately crude: it exists to be PUT somewhere,
 * which is the thing being tested.
 *
 * Its origin is the bottom of its legs, so it can be dropped straight onto a
 * levelled base or onto the sea bed itself.
 */
export type SubseaTemplateProps = {
  /** along the structure's own +X, in metres */
  length?: number;
  width?: number;
  height?: number;
  /** wellhead trees along the length */
  slots?: number;
  color?: string;
  trimColor?: string;
};

export const SubseaTemplate = ({
  length = 44,
  width = 26,
  height = 9,
  slots = 4,
  color = '#f2c531',
  trimColor = '#2f3336',
}: SubseaTemplateProps) => {
  const materials = useMemo(
    () => ({
      frame: new MeshStandardMaterial({
        color,
        roughness: 0.65,
        metalness: 0.15,
      }),
      trim: new MeshStandardMaterial({
        color: trimColor,
        roughness: 0.8,
        metalness: 0.2,
      }),
    }),
    [color, trimColor],
  );

  useEffect(() => {
    return () => {
      materials.frame.dispose();
      materials.trim.dispose();
    };
  }, [materials]);

  const beam = Math.max(Math.min(length, width) * 0.06, 0.8);
  const halfL = length / 2;
  const halfW = width / 2;
  const legs: [number, number][] = [
    [halfL - beam, halfW - beam],
    [halfL - beam, -halfW + beam],
    [-halfL + beam, halfW - beam],
    [-halfL + beam, -halfW + beam],
  ];
  const trees = Array.from({ length: slots }, (_, i) => {
    const t = slots === 1 ? 0.5 : i / (slots - 1);
    return -halfL * 0.6 + t * halfL * 1.2;
  });

  return (
    <group>
      {/* mudmat: the wide plate that keeps it from sinking into soft ground */}
      <mesh position={[0, beam / 2, 0]} material={materials.trim}>
        <boxGeometry args={[length, beam, width]} />
      </mesh>

      {legs.map(([x, z]) => (
        <mesh
          key={`${x}:${z}`}
          position={[x, height / 2, z]}
          material={materials.frame}
        >
          <boxGeometry args={[beam, height, beam]} />
        </mesh>
      ))}

      {/* top frame */}
      {[halfW - beam, -halfW + beam].map(z => (
        <mesh key={z} position={[0, height, z]} material={materials.frame}>
          <boxGeometry args={[length, beam, beam]} />
        </mesh>
      ))}
      {[halfL - beam, -halfL + beam].map(x => (
        <mesh key={x} position={[x, height, 0]} material={materials.frame}>
          <boxGeometry args={[beam, beam, width]} />
        </mesh>
      ))}

      {/* manifold header running the length of the structure */}
      <mesh
        position={[0, height * 0.45, -halfW * 0.45]}
        rotation={[0, 0, Math.PI / 2]}
        material={materials.trim}
      >
        <cylinderGeometry args={[beam * 0.8, beam * 0.8, length * 0.9, 12]} />
      </mesh>

      {trees.map(x => (
        <group key={x} position={[x, 0, halfW * 0.25]}>
          <mesh position={[0, height * 0.75, 0]} material={materials.trim}>
            <cylinderGeometry
              args={[beam * 0.9, beam * 0.9, height * 1.5, 12]}
            />
          </mesh>
          <mesh position={[0, height * 1.55, 0]} material={materials.frame}>
            <boxGeometry args={[beam * 2.6, beam * 1.6, beam * 2.6]} />
          </mesh>
        </group>
      ))}
    </group>
  );
};
