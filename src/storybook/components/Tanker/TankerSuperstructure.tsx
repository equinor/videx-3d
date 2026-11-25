import { useMemo } from 'react';

export type TankerDetails = 'low' | 'medium' | 'high';

export type TankerSuperstructureProps = {
  length: number; // meters
  width: number; // meters (beam)
  height: number; // meters (keel-to-deck depth)
  waterline: number; // meters below keel
  details?: TankerDetails; // level of detail, default 'medium'
  color?: string; // superstructure (block/bridge) color
  wireframe?: boolean;
};

// Internal palette for deck fittings (kept separate from the hull colors).
const FITTING_COLOR = '#9aa3a8'; // light metal grey (masts, railings, antennas)
const FUNNEL_COLOR = '#2b2f33'; // dark funnel body
const FUNNEL_BAND_COLOR = '#8a1f1f'; // company band on the funnel
const HELIDECK_COLOR = '#3f6f4a'; // green helideck
const HELI_MARK_COLOR = '#eef1f3'; // white landing markings (circle + H)
const PIPE_COLOR = '#7c7f83'; // cargo pipe rack
const LIFEBOAT_COLOR = '#e0792a'; // orange enclosed lifeboat
const DARK_METAL_COLOR = '#54595e'; // rudder / hull metal
const PROP_COLOR = '#9a7b4f'; // bronze propeller

// A small amount each stacked part is sunk into its support so no two faces are
// ever exactly coplanar (avoids z-fighting).
const EMBED = 0.2;

// The helideck is sized for a real helicopter, so it is a FIXED real-world size
// (meters) regardless of the hull's dimensions - it never scales with the ship.
const HELIDECK_RADIUS = 13;
const HELIDECK_THICKNESS = 0.4;

// A helideck only makes sense on a sufficiently large vessel: the deck must have
// enough footprint (length * width, m²) AND enough beam to actually fit the
// fixed-size landing disc. Smaller ships carry no helideck at all.
const MIN_HELIDECK_AREA = 6000;
const MIN_HELIDECK_BEAM = HELIDECK_RADIUS * 2.3;

/**
 * Deck superstructure for the {@link Tanker}: an aft accommodation block with a
 * bridge and a funnel/chimney (always present), plus extra fittings that scale
 * in with the `details` level (railings, helideck, masts, antennas, pipe rack).
 *
 * All dimensions are derived from the ship's dimensions so the structure scales
 * with the hull. Parts are built from Three.js primitives and overlap their
 * supports slightly to stay free of z-fighting.
 *
 * Coordinate frame matches the hull: origin at the waterline midship, bow +X,
 * up +Y, starboard +Z; the top deck sits at y = height - waterline.
 */
export const TankerSuperstructure = ({
  length,
  width,
  height,
  waterline,
  details = 'medium',
  color = '#d8d8d8',
  wireframe = false,
}: TankerSuperstructureProps) => {
  const showMedium = details === 'medium' || details === 'high';
  const showHigh = details === 'high';

  // No helipads for small ships: require both a large enough deck footprint and
  // enough beam to fit the fixed-size landing disc within the hull.
  const showHelideck =
    showMedium &&
    length * width >= MIN_HELIDECK_AREA &&
    width >= MIN_HELIDECK_BEAM;

  const d = useMemo(() => {
    // The hull deck is recessed below the top edge by a bulwark lip (see
    // tanker-geometry-builder). Seat everything on that recessed surface so
    // nothing floats over the lip.
    const bulwarkHeight = Math.min(1.2, (height - waterline) * 0.12);
    const deckTopY = height - waterline - bulwarkHeight;
    const halfBeam = width / 2;

    // Local deck height including the hull's sheer (the deck rises toward the
    // ends). Mirrors the geometry builder: sheer = deckTopY * 0.18, with
    // sheerFrac = (|t - 0.5| * 2)^2 where t is the longitudinal fraction. Used
    // to seat raised parts (helideck, forecastle) above the rising deck.
    const deckAt = (x: number) => {
      const t = (x + length / 2) / length;
      const sheerFrac = Math.pow(Math.abs(t - 0.5) * 2, 2);
      return deckTopY + sheerFrac * (deckTopY * 0.18);
    };

    // Accommodation block (aft). Width spans the beam; height follows the hull's
    // vertical scale so widening the hull makes the block wider but NOT taller.
    const blockLen = length * 0.09;
    const blockWid = width * 0.78;
    const blockHgt = height * 0.93;
    const blockX = -length * 0.34;
    const blockTopY = deckTopY + blockHgt;
    const blockCenterY = deckTopY + blockHgt / 2 - EMBED;

    // Bridge sitting on top of the block, set toward its forward face.
    const bridgeHgt = blockHgt * 0.16;
    const bridgeLen = blockLen * 0.7;
    const bridgeWid = blockWid * 1.04; // slight overhang (bridge-wing base)
    const bridgeX = blockX + blockLen * 0.1;
    const bridgeCenterY = blockTopY + bridgeHgt / 2 - EMBED;
    const bridgeTopY = blockTopY + bridgeHgt;

    // Bridge wings (medium+): thin platforms reaching out to the ship sides.
    const wingWid = halfBeam * 0.96; // half-length of each wing (along z)
    const wingThk = bridgeHgt * 0.5;
    const wingLen = bridgeLen * 0.5;
    const wingY = blockTopY + wingThk / 2;

    // Funnel/chimney, aft on the block roof. Radius tracks the hull's vertical
    // scale (not the beam) so a wider hull does not fatten the funnel.
    const funnelR = height * 0.155;
    const funnelHgt = blockHgt * 0.55;
    const funnelX = blockX - blockLen * 0.28;
    const funnelCenterY = blockTopY + funnelHgt / 2 - EMBED;
    const bandHgt = funnelHgt * 0.22;
    const bandY = blockTopY + funnelHgt * 0.6;

    // Main mast on the bridge roof (medium+). Pole radius tracks the vertical
    // scale (not the beam).
    const mastR = height * 0.0265;
    const mastHgt = blockHgt * 0.7;
    const mastX = bridgeX;
    const mastCenterY = bridgeTopY + mastHgt / 2 - EMBED;
    const mastTopY = bridgeTopY + mastHgt;

    // Foremast on the cargo deck, aft of the helideck (high).
    const foreMastHgt = blockHgt * 0.85;
    const foreMastX = length * 0.14;
    const foreMastCenterY = deckTopY + foreMastHgt / 2 - EMBED;
    const foreMastTopY = deckTopY + foreMastHgt;

    // Helideck: a marked landing disc raised on a support platform well forward
    // on the deck, clear of the cargo-deck fittings (pipe rack / foremast) so it
    // stays a safe landing zone (medium+). It is lifted above the local deck
    // sheer at its forward edge so the rising deck never pokes through it. The
    // disc is a FIXED real-world size (helicopter-sized) - it never scales with
    // the hull; only its position along the deck moves.
    const heliR = HELIDECK_RADIUS;
    const heliThk = HELIDECK_THICKNESS;
    const heliX = length * 0.28;
    // Clear the highest deck under the disc footprint (its forward edge) plus a
    // platform standoff.
    const heliPlatformH = Math.max(1.2, height * 0.12);
    const heliDeckClear = deckAt(heliX + heliR);
    const heliY = heliDeckClear + heliPlatformH + heliThk / 2;
    // Support platform: a short box pedestal under the disc.
    const heliSupR = heliR * 0.5;
    const heliSupTopY = heliY - heliThk / 2;
    const heliSupCenterY = (deckTopY + heliSupTopY) / 2 - EMBED;
    const heliSupHgt = heliSupTopY - deckTopY + EMBED;
    // Deck markings sit just above the disc face.
    const heliMarkThk = Math.max(0.2, heliThk * 0.6);
    const heliMarkY = heliY + heliThk / 2 + heliMarkThk / 2 + 0.05;
    const heliCircleR = heliR * 0.62;
    const heliCircleTube = Math.max(0.15, heliR * 0.045);
    const heliHHalf = heliR * 0.4; // half-height of the 'H' uprights (along x)
    const heliHGap = heliR * 0.22; // half-spacing of the uprights (along z)
    const heliHBar = Math.max(0.3, heliR * 0.09); // marking stroke width

    // Deck-edge railings run along the cargo deck (parallel midbody).
    const railZ = halfBeam * 0.97;
    const railH = Math.max(1.0, height * 0.08);
    const railThk = Math.max(0.1, height * 0.009);
    const railFromX = blockX + blockLen * 0.6; // just forward of the block
    const railToX = length * 0.3; // end before the bow taper / helideck
    const railTopY = deckTopY + railH;

    // Pipe rack: a raised pipe running along the cargo deck centerline, ending
    // aft of the helideck (medium+). Pipe radius tracks the vertical scale.
    const pipeR = height * 0.11;
    const pipeFromX = railFromX;
    const pipeToX = length * 0.2;
    const pipeY = deckTopY + pipeR + 0.4;

    // --- High-detail extras --------------------------------------------------
    const keelY = -waterline; // hull bottom in this component's frame

    // Stern propeller + rudder, below the waterline at the very stern (high).
    const sternX = -length / 2;
    const propR = width * 0.11;
    const propHubR = propR * 0.18;
    const propHubLen = propR * 0.5;
    const propX = sternX + length * 0.012;
    const propY = keelY * 0.5; // about half-draft below the waterline
    const rudderX = sternX - length * 0.008;
    const rudderLen = length * 0.025;
    const rudderHgt = waterline * 0.72;
    const rudderThk = Math.max(0.3, width * 0.02);
    const rudderY = keelY * 0.42;

    // Enclosed lifeboat on a davit at each side of the accommodation block
    // (high).
    const lifeboatLen = blockLen * 0.18;
    const lifeboatR = blockHgt * 0.08;
    const lifeboatX = blockX - blockLen * 0.1;
    const lifeboatY = deckTopY + blockHgt * 0.5;
    const lifeboatZ = blockWid / 2 + lifeboatR * 1.2;

    // Midship deck crane / manifold kingpost with a jib (high). Post radius
    // tracks the vertical scale; the jib reaches out athwartships (beam).
    const cranePostR = height * 0.04;
    const cranePostHgt = blockHgt * 0.55;
    const craneX = length * 0.04;
    const cranePostCenterY = deckTopY + cranePostHgt / 2 - EMBED;
    const cranePostTopY = deckTopY + cranePostHgt;
    const craneJibLen = width * 0.3;
    const craneJibR = cranePostR * 0.6;

    // Raised forecastle at the bow: a short raised deck (with bulwark) over the
    // forepeak, common on tankers for anchor handling and freeboard. Sits on the
    // rising deck near the stem. Present from low LOD as a hull-defining element.
    const fcLen = length * 0.07;
    const fcX = length * 0.42;
    const fcWidScale = 0.62; // beam fraction at the forecastle (deck has tapered)
    const fcWid = width * fcWidScale;
    const fcHgt = Math.max(1.6, height * 0.16);
    const fcDeckY = deckAt(fcX);
    const fcCenterY = fcDeckY + fcHgt / 2 - EMBED;
    const fcTopY = fcDeckY + fcHgt;

    // Cargo manifold amidships: athwartships pipe with riser valves (high).
    const manifoldX = length * 0.04;
    const manifoldWid = width * 0.62;
    const manifoldR = height * 0.04;
    const manifoldY = deckTopY + manifoldR + 0.4;
    const valveR = manifoldR * 1.6;
    const valveHgt = blockHgt * 0.16;

    // Tank domes / hatches along the cargo deck centerline (high). Radius tracks
    // the vertical scale so a wider hull does not enlarge the domes.
    const domeR = height * 0.11;
    const domeHgt = domeR * 0.7;
    const domeCount = 5;
    const domeFromX = -length * 0.12;
    const domeToX = length * 0.16;

    // Mooring winches fore and aft (high). Drum radius tracks the vertical
    // scale; the drum length spans athwartships (beam).
    const winchR = height * 0.066;
    const winchLen = width * 0.16;
    const aftWinchX = blockX + blockLen * 0.55;
    const aftWinchY = deckTopY + winchR;
    const foreWinchX = fcX;
    const foreWinchY = fcTopY + winchR - EMBED;

    return {
      deckTopY,
      deckAt,
      blockLen,
      blockWid,
      blockHgt,
      blockX,
      blockCenterY,
      bridgeHgt,
      bridgeLen,
      bridgeWid,
      bridgeX,
      bridgeCenterY,
      wingWid,
      wingThk,
      wingLen,
      wingY,
      funnelR,
      funnelHgt,
      funnelX,
      funnelCenterY,
      bandHgt,
      bandY,
      mastR,
      mastHgt,
      mastX,
      mastCenterY,
      mastTopY,
      foreMastHgt,
      foreMastX,
      foreMastCenterY,
      foreMastTopY,
      heliR,
      heliThk,
      heliX,
      heliY,
      heliSupR,
      heliSupCenterY,
      heliSupHgt,
      heliMarkThk,
      heliMarkY,
      heliCircleR,
      heliCircleTube,
      heliHHalf,
      heliHGap,
      heliHBar,
      railZ,
      railH,
      railThk,
      railFromX,
      railToX,
      railTopY,
      pipeR,
      pipeFromX,
      pipeToX,
      pipeY,
      propR,
      propHubR,
      propHubLen,
      propX,
      propY,
      rudderX,
      rudderLen,
      rudderHgt,
      rudderThk,
      rudderY,
      lifeboatLen,
      lifeboatR,
      lifeboatX,
      lifeboatY,
      lifeboatZ,
      cranePostR,
      cranePostCenterY,
      cranePostTopY,
      craneX,
      craneJibLen,
      craneJibR,
      fcLen,
      fcX,
      fcWid,
      fcHgt,
      fcCenterY,
      fcTopY,
      manifoldX,
      manifoldWid,
      manifoldR,
      manifoldY,
      valveR,
      valveHgt,
      domeR,
      domeHgt,
      domeCount,
      domeFromX,
      domeToX,
      winchR,
      winchLen,
      aftWinchX,
      aftWinchY,
      foreWinchX,
      foreWinchY,
    };
  }, [length, width, height, waterline]);

  // Build deck-edge railing meshes (a top rail per side + periodic stanchions).
  const railings = useMemo(() => {
    if (!showHigh) return null;
    const span = d.railToX - d.railFromX;
    const spacing = length * 0.025;
    const count = Math.max(2, Math.round(span / spacing));
    const meshes: React.ReactElement[] = [];
    for (const side of [1, -1] as const) {
      const z = side * d.railZ;
      // Top rail.
      meshes.push(
        <mesh
          key={`rail-${side}`}
          position={[(d.railFromX + d.railToX) / 2, d.railTopY, z]}
        >
          <boxGeometry args={[span, d.railThk, d.railThk]} />
          <meshStandardMaterial color={FITTING_COLOR} wireframe={wireframe} />
        </mesh>,
      );
      // Stanchions.
      for (let i = 0; i <= count; i++) {
        const x = d.railFromX + (span * i) / count;
        meshes.push(
          <mesh
            key={`stanchion-${side}-${i}`}
            position={[x, d.deckTopY + d.railH / 2, z]}
          >
            <boxGeometry args={[d.railThk, d.railH, d.railThk]} />
            <meshStandardMaterial color={FITTING_COLOR} wireframe={wireframe} />
          </mesh>,
        );
      }
    }
    return meshes;
  }, [showHigh, length, d, wireframe]);

  return (
    <group>
      {/* Accommodation block (always present). */}
      <mesh position={[d.blockX, d.blockCenterY, 0]}>
        <boxGeometry args={[d.blockLen, d.blockHgt, d.blockWid]} />
        <meshStandardMaterial color={color} wireframe={wireframe} />
      </mesh>

      {/* Bridge on top of the block (always present). */}
      <mesh position={[d.bridgeX, d.bridgeCenterY, 0]}>
        <boxGeometry args={[d.bridgeLen, d.bridgeHgt, d.bridgeWid]} />
        <meshStandardMaterial color={color} wireframe={wireframe} />
      </mesh>

      {/* Funnel / chimney (always present). */}
      <mesh position={[d.funnelX, d.funnelCenterY, 0]}>
        <cylinderGeometry
          args={[d.funnelR * 0.85, d.funnelR, d.funnelHgt, 16]}
        />
        <meshStandardMaterial color={FUNNEL_COLOR} wireframe={wireframe} />
      </mesh>
      <mesh position={[d.funnelX, d.bandY, 0]}>
        <cylinderGeometry
          args={[d.funnelR * 0.92, d.funnelR * 1.02, d.bandHgt, 16]}
        />
        <meshStandardMaterial color={FUNNEL_BAND_COLOR} wireframe={wireframe} />
      </mesh>

      {/* Bridge wings (medium+). */}
      {showMedium && (
        <mesh position={[d.bridgeX, d.wingY, 0]}>
          <boxGeometry args={[d.wingLen, d.wingThk, d.wingWid * 2]} />
          <meshStandardMaterial color={color} wireframe={wireframe} />
        </mesh>
      )}

      {/* Helideck on the foredeck (fixed size; omitted on small ships). */}
      {showHelideck && (
        <group position={[d.heliX, 0, 0]}>
          {/* Central support pedestal rising from the deck to the disc. */}
          <mesh position={[0, d.heliSupCenterY, 0]}>
            <cylinderGeometry
              args={[d.heliSupR, d.heliSupR * 1.15, d.heliSupHgt, 20]}
            />
            <meshStandardMaterial color={color} wireframe={wireframe} />
          </mesh>
          {/* Ring of vertical support legs under the disc rim (high only). */}
          {showHigh &&
            [0, 1, 2, 3, 4, 5].map(k => {
              const ang = (k / 6) * Math.PI * 2;
              const lx = Math.cos(ang) * d.heliR * 0.82;
              const lz = Math.sin(ang) * d.heliR * 0.82;
              return (
                <mesh
                  key={`heli-leg-${k}`}
                  position={[lx, d.heliSupCenterY, lz]}
                >
                  <cylinderGeometry
                    args={[d.heliSupR * 0.1, d.heliSupR * 0.1, d.heliSupHgt, 6]}
                  />
                  <meshStandardMaterial
                    color={FITTING_COLOR}
                    wireframe={wireframe}
                  />
                </mesh>
              );
            })}
          {/* Landing disc. */}
          <mesh position={[0, d.heliY, 0]}>
            <cylinderGeometry args={[d.heliR, d.heliR, d.heliThk, 32]} />
            <meshStandardMaterial
              color={HELIDECK_COLOR}
              wireframe={wireframe}
            />
          </mesh>
          {/* White circle marking. */}
          <mesh position={[0, d.heliMarkY, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[d.heliCircleR, d.heliCircleTube, 8, 48]} />
            <meshStandardMaterial
              color={HELI_MARK_COLOR}
              wireframe={wireframe}
            />
          </mesh>
          {/* 'H' marking: two uprights (along x) joined by a crossbar (along z). */}
          <mesh position={[0, d.heliMarkY, -d.heliHGap]}>
            <boxGeometry args={[d.heliHHalf * 2, d.heliMarkThk, d.heliHBar]} />
            <meshStandardMaterial
              color={HELI_MARK_COLOR}
              wireframe={wireframe}
            />
          </mesh>
          <mesh position={[0, d.heliMarkY, d.heliHGap]}>
            <boxGeometry args={[d.heliHHalf * 2, d.heliMarkThk, d.heliHBar]} />
            <meshStandardMaterial
              color={HELI_MARK_COLOR}
              wireframe={wireframe}
            />
          </mesh>
          <mesh position={[0, d.heliMarkY, 0]}>
            <boxGeometry args={[d.heliHBar, d.heliMarkThk, d.heliHGap * 2]} />
            <meshStandardMaterial
              color={HELI_MARK_COLOR}
              wireframe={wireframe}
            />
          </mesh>
        </group>
      )}

      {/* Main mast on the bridge roof (medium+). */}
      {showMedium && (
        <mesh position={[d.mastX, d.mastCenterY, 0]}>
          <cylinderGeometry args={[d.mastR, d.mastR, d.mastHgt, 8]} />
          <meshStandardMaterial color={FITTING_COLOR} wireframe={wireframe} />
        </mesh>
      )}

      {/* Deck-edge railings (high). */}
      {railings}

      {/* Foremast on the cargo deck (medium+). */}
      {showMedium && (
        <mesh position={[d.foreMastX, d.foreMastCenterY, 0]}>
          <cylinderGeometry args={[d.mastR, d.mastR, d.foreMastHgt, 8]} />
          <meshStandardMaterial color={FITTING_COLOR} wireframe={wireframe} />
        </mesh>
      )}

      {/* Radar / antenna cross-arm and dome on the main mast (medium+). */}
      {showMedium && (
        <>
          <mesh position={[d.mastX, d.mastTopY - d.mastHgt * 0.18, 0]}>
            <boxGeometry
              args={[d.mastR * 1.5, d.mastR * 1.5, d.bridgeWid * 0.5]}
            />
            <meshStandardMaterial color={FITTING_COLOR} wireframe={wireframe} />
          </mesh>
          <mesh position={[d.mastX, d.mastTopY, 0]}>
            <sphereGeometry args={[d.mastR * 2.2, 12, 8]} />
            <meshStandardMaterial color={FITTING_COLOR} wireframe={wireframe} />
          </mesh>
        </>
      )}

      {/* Cargo pipe rack along the deck centerline (medium+). */}
      {showMedium && (
        <mesh
          position={[(d.pipeFromX + d.pipeToX) / 2, d.pipeY, 0]}
          rotation={[0, 0, Math.PI / 2]}
        >
          <cylinderGeometry
            args={[d.pipeR, d.pipeR, d.pipeToX - d.pipeFromX, 12]}
          />
          <meshStandardMaterial color={PIPE_COLOR} wireframe={wireframe} />
        </mesh>
      )}

      {/* Stern propeller + rudder, below the waterline (high). */}
      {showHigh && (
        <>
          {/* Rudder blade behind the propeller. */}
          <mesh position={[d.rudderX, d.rudderY, 0]}>
            <boxGeometry args={[d.rudderLen, d.rudderHgt, d.rudderThk]} />
            <meshStandardMaterial
              color={DARK_METAL_COLOR}
              wireframe={wireframe}
            />
          </mesh>
          {/* Propeller hub. */}
          <mesh position={[d.propX, d.propY, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry
              args={[d.propHubR, d.propHubR * 1.4, d.propHubLen, 12]}
            />
            <meshStandardMaterial color={PROP_COLOR} wireframe={wireframe} />
          </mesh>
          {/* Four propeller blades radiating from the hub. */}
          {[0, 1, 2, 3].map(k => (
            <mesh
              key={`blade-${k}`}
              position={[d.propX, d.propY, 0]}
              rotation={[(k * Math.PI) / 2, 0, 0]}
            >
              <boxGeometry
                args={[d.propHubLen * 0.5, d.propR, d.propR * 0.16]}
              />
              <meshStandardMaterial color={PROP_COLOR} wireframe={wireframe} />
            </mesh>
          ))}
        </>
      )}

      {/* Enclosed lifeboats on davits at each side of the block (high). */}
      {showHigh &&
        ([1, -1] as const).map(side => (
          <mesh
            key={`lifeboat-${side}`}
            position={[d.lifeboatX, d.lifeboatY, side * d.lifeboatZ]}
            scale={[d.lifeboatLen, d.lifeboatR, d.lifeboatR]}
          >
            <sphereGeometry args={[1, 12, 8]} />
            <meshStandardMaterial
              color={LIFEBOAT_COLOR}
              wireframe={wireframe}
            />
          </mesh>
        ))}

      {/* Midship deck crane / manifold kingpost with a jib (high). */}
      {showHigh && (
        <>
          <mesh position={[d.craneX, d.cranePostCenterY, 0]}>
            <cylinderGeometry
              args={[
                d.cranePostR,
                d.cranePostR,
                d.cranePostTopY - d.deckTopY,
                10,
              ]}
            />
            <meshStandardMaterial color={FITTING_COLOR} wireframe={wireframe} />
          </mesh>
          <mesh
            position={[d.craneX, d.cranePostTopY, d.craneJibLen / 2]}
            rotation={[Math.PI / 2, 0, 0]}
          >
            <cylinderGeometry
              args={[d.craneJibR, d.craneJibR, d.craneJibLen, 8]}
            />
            <meshStandardMaterial color={FITTING_COLOR} wireframe={wireframe} />
          </mesh>
        </>
      )}

      {/* Raised forecastle deck at the bow (always present, hull-defining). */}
      <mesh position={[d.fcX, d.fcCenterY, 0]}>
        <boxGeometry args={[d.fcLen, d.fcHgt, d.fcWid]} />
        <meshStandardMaterial color={color} wireframe={wireframe} />
      </mesh>

      {/* Cargo manifold amidships: athwartships pipe + riser valves (high). */}
      {showHigh && (
        <>
          <mesh
            position={[d.manifoldX, d.manifoldY, 0]}
            rotation={[Math.PI / 2, 0, 0]}
          >
            <cylinderGeometry
              args={[d.manifoldR, d.manifoldR, d.manifoldWid, 12]}
            />
            <meshStandardMaterial color={PIPE_COLOR} wireframe={wireframe} />
          </mesh>
          {[-1, 0, 1].map(k => (
            <mesh
              key={`valve-${k}`}
              position={[
                d.manifoldX,
                d.manifoldY + d.valveHgt / 2,
                (k * d.manifoldWid) / 3.2,
              ]}
            >
              <cylinderGeometry args={[d.valveR, d.valveR, d.valveHgt, 8]} />
              <meshStandardMaterial
                color={DARK_METAL_COLOR}
                wireframe={wireframe}
              />
            </mesh>
          ))}
        </>
      )}

      {/* Tank domes / hatches along the cargo deck centerline (high). */}
      {showHigh &&
        Array.from({ length: d.domeCount }, (_, k) => {
          const f = d.domeCount === 1 ? 0.5 : k / (d.domeCount - 1);
          const x = d.domeFromX + (d.domeToX - d.domeFromX) * f;
          return (
            <mesh
              key={`dome-${k}`}
              position={[x, d.deckTopY + d.domeHgt / 2 - EMBED, 0]}
            >
              <cylinderGeometry args={[d.domeR, d.domeR, d.domeHgt, 16]} />
              <meshStandardMaterial
                color={FITTING_COLOR}
                wireframe={wireframe}
              />
            </mesh>
          );
        })}

      {/* Mooring winches fore (on the forecastle) and aft (high). */}
      {showHigh && (
        <>
          <mesh
            position={[d.aftWinchX, d.aftWinchY, 0]}
            rotation={[Math.PI / 2, 0, 0]}
          >
            <cylinderGeometry args={[d.winchR, d.winchR, d.winchLen, 12]} />
            <meshStandardMaterial
              color={DARK_METAL_COLOR}
              wireframe={wireframe}
            />
          </mesh>
          <mesh
            position={[d.foreWinchX, d.foreWinchY, 0]}
            rotation={[Math.PI / 2, 0, 0]}
          >
            <cylinderGeometry args={[d.winchR, d.winchR, d.winchLen, 12]} />
            <meshStandardMaterial
              color={DARK_METAL_COLOR}
              wireframe={wireframe}
            />
          </mesh>
        </>
      )}
    </group>
  );
};
