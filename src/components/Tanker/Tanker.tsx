import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Group } from 'three';
import { useOceanContact } from '../Ocean/ocean-contact';
import { OceanContact } from '../Ocean/ocean-material';
import { BuoyancyPoint, useBuoyancy } from '../Ocean/ocean-sampler';
import { createTankerHull } from './tanker-geometry-builder';
import {
  TankerSuperstructure,
  type TankerDetails,
} from './TankerSuperstructure';

// Reference displacement (tonnes) of a "typical" tanker. The vessel's relative
// mass for the buoyancy response is weight / this, so the default weight gives a
// neutral response and heavier/lighter vessels react more/less sluggishly.
const REFERENCE_DISPLACEMENT = 120000;

export type TankerProps = {
  length?: number; // meters
  width?: number; // meters (beam)
  height?: number; // meters (draft + freeboard)
  waterline?: number; // meters below keel
  wireframe?: boolean; // default: false
  lengthSegments?: number; // 6 = very low poly, 12 = medium poly, 24 = high poly
  profileSegments?: number; // 4 = very low poly, 8 = medium poly, 16 = high poly
  bowLength?: number; // fraction of ship length occupied by the bow (0.1-0.4)
  bowRoundness?: number; // 0 = sharp stem, 1 = full/rounded bow at deck level
  details?: TankerDetails; // superstructure detail level, default 'medium'
  lowerHullColor?: string; // below the waterline (anti-foul)
  upperHullColor?: string; // above the boot-top stripe
  deckColor?: string; // top deck
  stripeColor?: string; // boot-top stripe at the waterline
  superstructureColor?: string; // accommodation block / bridge
  /**
   * Float on the waves when rendered inside an `<Ocean>` (heave/pitch/roll
   * driven by the live wave field). No effect outside an `<Ocean>`. Default
   * `true`.
   */
  buoyancy?: boolean;
  /**
   * Displacement in tonnes. Heavier vessels follow the waves more sluggishly
   * (more inertia); lighter ones bob more readily. Default `120000` (Aframax).
   */
  weight?: number;
  /**
   * Spread foam where the hull meets the water when rendered inside an
   * `<Ocean>`. No effect outside an `<Ocean>`. Default `true`.
   */
  contactFoam?: boolean;
  /**
   * Overall scale of the contact foam (0 = none, 1 = full). The actual amount
   * also rises with how much the hull is moving (heave/pitch/roll), so it is
   * stronger in rougher seas and subtle when the vessel sits still. Default `1`.
   */
  contactFoamIntensity?: number;
  /**
   * How much the contact foam is reduced toward the bow and stern, 0..1. 0 = an
   * even collar all around the hull; 1 = foam only along the sides. Default
   * `0.6` (a tanker pushes most water along its long flat sides).
   */
  contactFoamEndFalloff?: number;
};

export const Tanker = ({
  length = 253,
  width = 44.2,
  height = 20,
  waterline = 13,
  lengthSegments = 128,
  profileSegments = 16,
  bowLength = 0.2,
  bowRoundness = 0.6,
  wireframe = false,
  details = 'medium',
  lowerHullColor = '#7a2b1c',
  upperHullColor = '#23303a',
  deckColor = '#3a7a40',
  stripeColor = '#0d1b2a',
  superstructureColor = '#d8d8d8',
  buoyancy = true,
  weight = REFERENCE_DISPLACEMENT,
  contactFoam = true,
  contactFoamIntensity = 1,
  contactFoamEndFalloff = 0.6,
}: TankerProps) => {
  const hullGeometry = useMemo(
    () =>
      createTankerHull({
        length,
        width,
        height,
        waterline,
        lengthSegments,
        profileSegments,
        bowLength,
        bowRoundness,
      }),
    [
      length,
      width,
      height,
      waterline,
      lengthSegments,
      profileSegments,
      bowLength,
      bowRoundness,
    ],
  );

  // R3F does not dispose geometry passed via `geometry={...}`, so free the GPU
  // buffers when the geometry is replaced (deps change) or the component unmounts.
  useEffect(() => () => hullGeometry.dispose(), [hullGeometry]);

  const groupRef = useRef<Group>(null);

  // Buoyancy sample points at the hull extents (bow / stern / port /
  // starboard), kept slightly inboard. Their span encodes the ship's length and
  // width, so the vessel ignores chop shorter than itself but rides long swells.
  const buoyancyPoints = useMemo<BuoyancyPoint[]>(() => {
    const halfL = length * 0.45;
    const halfW = width * 0.45;
    return [
      [halfL, 0], // bow
      [-halfL, 0], // stern
      [0, halfW], // starboard
      [0, -halfW], // port
    ];
  }, [length, width]);

  useBuoyancy(groupRef, {
    points: buoyancyPoints,
    enabled: buoyancy,
    mass: weight / REFERENCE_DISPLACEMENT,
  });

  // Tracks the hull's recent motion (heave/pitch/roll speed) to drive how much
  // contact foam it kicks up: a vessel bobbing in big waves foams more than one
  // sitting still. Kept in refs so it survives re-renders without re-registering.
  const motionRef = useRef(0);
  const prevPose = useRef({ y: 0, rx: 0, rz: 0, t: 0 });

  // Contact-foam footprint: the hull waterline as an oriented ellipse following
  // the group's live position/heading. The foam band is scaled to the beam, and
  // its intensity follows how fast the hull is heaving/pitching/rolling.
  useOceanContact(
    useCallback((): OceanContact | null => {
      const g = groupRef.current;
      if (!g) return null;

      // Estimate vertical + angular speed since the previous frame and smooth it
      // into a 0..1 motion factor (the response saturates so a lively sea still
      // maps to full foam). Span scales the angular terms to a comparable speed.
      const now = performance.now() / 1000;
      const prev = prevPose.current;
      const dt = Math.max(now - prev.t, 1e-3);
      const span = (length + width) * 0.25;
      const speed =
        (Math.abs(g.position.y - prev.y) +
          (Math.abs(g.rotation.x - prev.rx) +
            Math.abs(g.rotation.z - prev.rz)) *
          span) /
        dt;
      prev.y = g.position.y;
      prev.rx = g.rotation.x;
      prev.rz = g.rotation.z;
      prev.t = now;
      // Smooth (cheap low-pass) and map to 0..1 (saturating around ~1.5 m/s).
      motionRef.current += (speed - motionRef.current) * Math.min(dt * 4, 1);
      const motion = 1 - Math.exp(-motionRef.current / 1.5);

      return {
        x: g.position.x,
        z: g.position.z,
        heading: g.rotation.y,
        halfLength: length * 0.5,
        halfWidth: width * 0.5,
        foamWidth: Math.max(2, width * 0.3),
        // Keep a small idle floor so the collar never fully disappears, then
        // ramp up with motion.
        intensity: contactFoamIntensity * (0.2 + 0.8 * motion),
        endFalloff: contactFoamEndFalloff,
      };
    }, [length, width, contactFoamIntensity, contactFoamEndFalloff]),
    contactFoam,
  );

  return (
    <group ref={groupRef}>
      {/* Hull: one mesh, four material groups (lower / stripe / upper / deck). */}
      <mesh geometry={hullGeometry}>
        <meshStandardMaterial
          attach="material-0"
          color={lowerHullColor}
          wireframe={wireframe}
        />
        <meshStandardMaterial
          attach="material-1"
          color={stripeColor}
          wireframe={wireframe}
        />
        <meshStandardMaterial
          attach="material-2"
          color={upperHullColor}
          wireframe={wireframe}
        />
        <meshStandardMaterial
          attach="material-3"
          color={deckColor}
          wireframe={wireframe}
        />
      </mesh>

      <TankerSuperstructure
        length={length}
        width={width}
        height={height}
        waterline={waterline}
        details={details}
        color={superstructureColor}
        wireframe={wireframe}
      />
    </group>
  );
};
