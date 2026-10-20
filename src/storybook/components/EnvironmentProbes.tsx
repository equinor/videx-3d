/**
 * Three spheres for judging an environment and a light probe: polished metal, rough
 * metal and matte white, `size` in radius, side by side along X at `elevation`.
 */
export const EnvironmentProbes = ({
  size,
  elevation,
}: {
  size: number;
  elevation: number;
}) => (
  <group position={[0, elevation, 0]}>
    <mesh position={[-size * 2.5, 0, 0]} scale={size}>
      <sphereGeometry args={[1, 64, 32]} />
      <meshStandardMaterial color="#ffffff" metalness={1} roughness={0.05} />
    </mesh>
    <mesh scale={size}>
      <sphereGeometry args={[1, 64, 32]} />
      <meshStandardMaterial color="#c8c8c8" metalness={1} roughness={0.35} />
    </mesh>
    <mesh position={[size * 2.5, 0, 0]} scale={size}>
      <sphereGeometry args={[1, 64, 32]} />
      <meshStandardMaterial color="#ffffff" metalness={0} roughness={0.9} />
    </mesh>
  </group>
);
