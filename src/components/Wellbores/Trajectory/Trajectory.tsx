import { useFrame, useThree } from '@react-three/fiber';
import {
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AdditiveBlending,
  Blending,
  Color,
  Material,
  Mesh,
  Texture,
} from 'three';
import {
  CommonComponentProps,
  ContourColorMode,
  CustomMaterialProps,
} from '../../../common/types';
import { useGenerator } from '../../../hooks/useGenerator';
import { useWellboreContext } from '../../../hooks/useWellboreContext';
import { DistanceContext } from '../../Distance/DistanceContext';
import {
  trajectory,
  TrajectoryColorInterval,
  TrajectoryGeneratorResponse,
  TrajectorySegmentsType,
} from './trajectory-defs';
import {
  createTrajectoryCapsGeometry,
  createTrajectoryGeometry,
} from './trajectory-geometry';
import { TrajectoryEmitterMaterial } from './TrajectoryEmitterMaterial';
import { TrajectoryHighlightMaterial } from './TrajectoryHighlightMaterial';
import { TrajectoryMaterial } from './TrajectoryMaterial';

/**
 * Trajectory props
 * @expand
 */
export type TrajectoryProps = CommonComponentProps &
  CustomMaterialProps & {
    color?: string;
    /** Real-world tube radius in metres. Applied as a shader uniform (no rebuild). */
    radius?: number;
    /** Screen-space floor so the tube never thins below this many pixels. */
    minPixelRadius?: number;
    /** Highlight (ghost) colour used by the `Highlighter` on hover/selection. */
    highlightColor?: string;
    /**
     * Highlight (ghost) opacity (0..1). Together with `highlightBlending` this tunes how
     * strongly the hover/selection effect reads against a given background. Default 1.
     */
    highlightOpacity?: number;
    /**
     * Blend mode for the highlight ghost. `AdditiveBlending` (the default) glows on dark
     * scenes but washes out on light ones; use `NormalBlending` (with `highlightOpacity`
     * < 1) for a solid overlay that reads on any background.
     */
    highlightBlending?: Blending;
    /** Opacity (1 = opaque, the default). Values < 1 render semi-transparent. */
    opacity?: number;
    /** Colour the silhouette darkens toward (default black = a darker same-hue diffuse). */
    shadingColor?: string;
    /** Silhouette darkening amount (0 = flat, 1 = full). Default 0.6. */
    shadingStrength?: number;
    /**
     * Rim shading exponent. The tube centre is always EXACTLY the diffuse colour; this
     * shapes how the darkening rises toward the silhouette: higher = darkening hugs the
     * edge (broad exact-colour front), lower = spreads inward. Default 2.
     */
    shadingFalloff?: number;
    /**
     * Optional albedo texture applied to the tube (combined with `color`: the tube
     * centre reads as `color` x texel). The trajectory is unlit, so only a colour
     * map is supported.
     */
    map?: Texture;
    /**
     * UV units for `map`: `'normalized'` (azimuth 0..1 around x curve position 0..1
     * along, so the texture fits the whole well) or `'world'` (circumference metres x
     * measured-depth metres, so `map.repeat` sets a world-consistent texel density).
     * Default `'normalized'`.
     */
    mapUvUnits?: 'normalized' | 'world';
    /** Draw depth-marker lines along the tube (measured depth, MSL). */
    depthMarkers?: boolean;
    /** Spacing between depth markers in metres. Default 100. */
    depthInterval?: number;
    /**
     * How depth markers modulate the tube colour (mirrors the Surface contour modes):
     * darken / lighten / mixed. Default `ContourColorMode.darken`.
     */
    depthMarkerColorMode?: ContourColorMode;
    /** Depth-marker modulation strength (0..1). Default 0.5. */
    depthMarkerColorModeFactor?: number;
    /** Depth-marker colour used by the `mixed` colour mode. Default black. */
    depthMarkerColor?: string;
    /** Depth-marker band thickness in metres, centred on each interval. Default 1. */
    depthMarkerWidth?: number;
    /**
     * Metre offset applied to the MSL datum used by the depth markers (e.g. set to the RT
     * elevation or a kickoff depth to align the marker grid to that reference). Default 0.
     */
    depthMarkerOffset?: number;
    /**
     * Data-driven interval colouring: an array of measured-depth (MSL) intervals, each
     * `{ from, to, color }`, that recolour the tube where a point falls inside an
     * interval (outside every interval the base `color` is used). Intended for colouring
     * a trajectory by data instead of a single diffuse colour. Colours are de-duplicated
     * internally, so many intervals may share a colour cheaply. Memoize the array — a new
     * reference rebuilds the interval textures.
     */
    colorIntervals?: TrajectoryColorInterval[];
    /** Radial resolution of the high LOD. */
    radialSegments?: number;
    /** Radial resolution of the low (field-scale) LOD. */
    lowRadialSegments?: number;
    /** Camera distance (from DistanceContext) below which the high LOD is used. */
    lodDistance?: number;
    priority?: number;
  };

/**
 * Renders a wellbore trajectory as a single instanced tube. Radius is a shader uniform
 * (so thickness — and a future Y-axis scale — never rebuild geometry), with a
 * screen-space `minPixelRadius` floor so the tube reads as a ~1 px line at field scale
 * and gains thickness continuously as the camera approaches. A coarse radial-segment
 * geometry LOD is swapped based on the `DistanceContext` published by `WellboreBounds`.
 * Must be a child of the `Wellbore` component (wrap it in a `WellboreBounds` for the
 * distance-driven LOD).
 *
 * This supersedes the older `BasicTrajectory` + `TubeTrajectory` composition: one
 * generator, one geometry, GPU picking and `Highlighter` support, OIT-compatible, plus
 * optional depth markers, data-driven interval colouring and an albedo texture map.
 *
 * @example
 * <Wellbore id="abc">
 *  <WellboreBounds id="abc">
 *   <Trajectory color="red" radius={1} />
 *  </WellboreBounds>
 * </Wellbore>
 *
 * @remarks
 * Depends on the {@link trajectory} generator. Picking and highlighting are wired by
 * exposing per-mesh `userData.emitterMaterial` and `userData.highlightMaterial` (which
 * the `PickingHelper` / `Highlighter` prefer over their defaults); register the pointer
 * handlers on the ancestor `Wellbore` (or another listener) as usual — the tube is then
 * picked/highlighted correctly with no dedicated registration of its own.
 *
 * @see [Trajectory guide](/videx-3d/docs/documents/trajectory.html)
 * @see [Migrating from BasicTrajectory / TubeTrajectory](/videx-3d/docs/documents/trajectory-migration.html)
 * @see [Generators](/videx-3d/docs/documents/generators.html)
 *
 * @group Components
 */
export const Trajectory = ({
  name,
  userData,
  position,
  castShadow,
  receiveShadow,
  layers,
  renderOrder,
  visible,
  customDepthMaterial,
  customDistanceMaterial,
  customMaterial,
  onMaterialPropertiesChange,
  color = 'red',
  radius = 0.5,
  minPixelRadius = 1,
  highlightColor = '#ffffff',
  highlightOpacity = 1,
  highlightBlending = AdditiveBlending,
  opacity = 1,
  shadingColor = '#000000',
  shadingStrength = 0.6,
  shadingFalloff = 2,
  map,
  mapUvUnits = 'normalized',
  depthMarkers = false,
  depthInterval = 100,
  depthMarkerColorMode = ContourColorMode.darken,
  depthMarkerColorModeFactor = 0.5,
  depthMarkerColor = '#000000',
  depthMarkerWidth = 1,
  depthMarkerOffset = 0,
  colorIntervals,
  radialSegments = 12,
  lowRadialSegments = 4,
  lodDistance = 2000,
  priority = 0,
}: TrajectoryProps) => {
  const { id, fromMsl, segmentsPerMeter, simplificationThreshold } =
    useWellboreContext();

  const generator = useGenerator<TrajectoryGeneratorResponse>(
    trajectory,
    priority,
  );

  const [section, setSection] = useState<TrajectorySegmentsType | null>(null);

  const tubeMeshRef = useRef<Mesh>(null!);
  const capsMeshRef = useRef<Mesh>(null!);
  const distanceContext = useContext(DistanceContext);

  const size = useThree(state => state.size);
  const dpr = useThree(state => state.viewport.dpr);

  const onPropsChange = useMemo(() => {
    return onMaterialPropertiesChange
      ? onMaterialPropertiesChange
      : (props: Record<string, any>, material: Material | Material[]) => {
          const m = material as TrajectoryMaterial;
          m.color = new Color(props.color);
          m.radius = props.radius;
          m.minPixelRadius = props.minPixelRadius;
          m.shadingColor = new Color(props.shadingColor);
          m.shadingStrength = props.shadingStrength;
          m.shadingFalloff = props.shadingFalloff;
          m.map = props.map ?? null;
          m.mapUvUnits = props.mapUvUnits;
          m.depthMarkers = props.depthMarkers;
          m.depthInterval = props.depthInterval;
          m.depthMarkerColorMode = props.depthMarkerColorMode;
          m.depthMarkerColorModeFactor = props.depthMarkerColorModeFactor;
          m.depthMarkerColor = new Color(props.depthMarkerColor);
          m.depthMarkerWidth = props.depthMarkerWidth;
          m.depthMarkerOffset = props.depthMarkerOffset;
          m.colorIntervals = props.colorIntervals ?? null;
        };
  }, [onMaterialPropertiesChange]);

  // TODO: reconsider supporting an arbitrary `customMaterial` here. Unlike the other
  // wellbore components, the tube shape is reconstructed in the vertex shader (radius
  // uniform + screen-space floor + the instanced positionA/B, tangentA/B, normalA/B and
  // capSign attributes), so a material that does not implement that exact vertex
  // transform renders garbage. Safer options for a follow-up: (a) export a
  // `createTrajectoryMaterial({ fragmentShader, uniforms })` factory that wires the
  // required trajectory vertex shader + uniforms and lets callers customise only the
  // fragment stage; or (b) refactor TrajectoryMaterial into an extensible base that
  // accepts an injected fragment shader / extra uniforms (mirroring how the casing
  // material could be extended). For now `customMaterial` is left as-is (advanced,
  // caller-beware).
  const material = useMemo(() => {
    if (customMaterial) {
      return customMaterial;
    }
    return new TrajectoryMaterial();
  }, [customMaterial]);

  // Ghost material for the Highlighter (reconstructs the same tube). Attached to the
  // meshes via userData.highlightMaterial below; the Highlighter prefers it over its
  // stock MeshBasicMaterial, which cannot render the instanced custom-vertex geometry.
  const highlightMaterial = useMemo(
    () => new TrajectoryHighlightMaterial(),
    [],
  );

  useEffect(() => {
    return () => {
      highlightMaterial.dispose();
    };
  }, [highlightMaterial]);

  // Picking material for the EventEmitter (reconstructs the same tube). Exposed on the
  // meshes via userData.emitterMaterial below; the PickingHelper prefers it over its
  // default material, so the tube is picked correctly under the ancestor Wellbore's
  // pointer handlers — no dedicated registration needed. Created unconditionally
  // (cheap; the program only compiles if the object is actually picked).
  const emitterMaterial = useMemo(() => new TrajectoryEmitterMaterial(), []);

  useEffect(() => {
    return () => {
      emitterMaterial.dispose();
    };
  }, [emitterMaterial]);

  // Keep the picking silhouette in sync with the visible tube (resolution is handled
  // inside the material's onBeforeRender).
  useEffect(() => {
    emitterMaterial.radius = radius;
    emitterMaterial.minPixelRadius = minPixelRadius;
    emitterMaterial.sizeMultiplier = 1;
  }, [emitterMaterial, radius, minPixelRadius]);

  useEffect(() => {
    if (generator && id) {
      generator(id, segmentsPerMeter, simplificationThreshold, fromMsl).then(
        response => {
          setSection(response || null);
        },
      );
    }
  }, [generator, id, fromMsl, segmentsPerMeter, simplificationThreshold]);

  // Sync per-wellbore scalars from the generated section: the full measured length
  // (world-unit map UVs) and the measured depth at the top (depth-marker datum). Without
  // wellLength the world UV V axis would stay at its default 1 (i.e. not in metres).
  useEffect(() => {
    if (!customMaterial && material instanceof TrajectoryMaterial && section) {
      material.wellLength = section.measuredLength;
      material.measuredTop = section.measuredTop;
    }
  }, [material, customMaterial, section]);

  const geometries = useMemo(() => {
    if (!section) return null;
    return {
      low: {
        tube: createTrajectoryGeometry(section, lowRadialSegments),
        caps: createTrajectoryCapsGeometry(section, lowRadialSegments),
      },
      high: {
        tube: createTrajectoryGeometry(section, radialSegments),
        caps: createTrajectoryCapsGeometry(section, radialSegments),
      },
    };
  }, [section, lowRadialSegments, radialSegments]);

  // Dispose the library-created geometries when they are replaced or on unmount.
  useEffect(() => {
    return () => {
      if (geometries) {
        geometries.low.tube.dispose();
        geometries.low.caps.dispose();
        geometries.high.tube.dispose();
        geometries.high.caps.dispose();
      }
    };
  }, [geometries]);

  // Expose the ghost + picking materials to the Highlighter / EventEmitter's
  // PickingHelper (re-runs when the meshes mount). Both are per-mesh overrides the
  // renderers prefer over their defaults, so the displaced tube renders correctly for
  // highlighting and picking under an ancestor listener (e.g. the Wellbore).
  useEffect(() => {
    for (const mesh of [tubeMeshRef.current, capsMeshRef.current]) {
      if (mesh) {
        mesh.userData.highlightMaterial = highlightMaterial;
        mesh.userData.emitterMaterial = emitterMaterial;
      }
    }
  }, [highlightMaterial, emitterMaterial, geometries]);

  // Dispose the library-created material on unmount (skip user-supplied material).
  useEffect(() => {
    return () => {
      if (!customMaterial) {
        const materials = Array.isArray(material) ? material : [material];
        materials.forEach(m => m.dispose());
      }
    };
  }, [material, customMaterial]);

  useEffect(() => {
    onPropsChange(
      {
        color,
        radius,
        minPixelRadius,
        shadingColor,
        shadingStrength,
        shadingFalloff,
        map,
        mapUvUnits,
        depthMarkers,
        depthInterval,
        depthMarkerColorMode,
        depthMarkerColorModeFactor,
        depthMarkerColor,
        depthMarkerWidth,
        depthMarkerOffset,
        colorIntervals,
      },
      material,
    );
  }, [
    color,
    radius,
    minPixelRadius,
    shadingColor,
    shadingStrength,
    shadingFalloff,
    map,
    mapUvUnits,
    depthMarkers,
    depthInterval,
    depthMarkerColorMode,
    depthMarkerColorModeFactor,
    depthMarkerColor,
    depthMarkerWidth,
    depthMarkerOffset,
    colorIntervals,
    material,
    onPropsChange,
  ]);

  // Keep the highlight ghost matching the visible tube's shape.
  useEffect(() => {
    highlightMaterial.color = new Color(highlightColor);
    highlightMaterial.uniforms.opacity.value = highlightOpacity;
    highlightMaterial.blending = highlightBlending;
    highlightMaterial.radius = radius;
    highlightMaterial.minPixelRadius = minPixelRadius;
    highlightMaterial.sizeMultiplier = 1;
  }, [
    highlightMaterial,
    highlightColor,
    highlightOpacity,
    highlightBlending,
    radius,
    minPixelRadius,
  ]);

  // Opacity opt-in: opaque by default, semi-transparent when < 1 (OIT-aware hosts
  // resolve it order-independently via the attached variants).
  useEffect(() => {
    if (!customMaterial && material instanceof TrajectoryMaterial) {
      material.uniforms.opacity.value = opacity;
      const shouldBeTransparent = opacity < 1;
      if (material.transparent !== shouldBeTransparent) {
        material.transparent = shouldBeTransparent;
        material.needsUpdate = true;
      }
    }
  }, [opacity, material, customMaterial]);

  // Baseline sync of the render-target size (device pixels) so the screen-space floor
  // is set before first paint (avoids a one-frame flash from the (1,1) default) and so
  // it reaches the OIT variants, which share this uniform but do not run the base
  // material's onBeforeRender. The visible TrajectoryMaterial additionally refines this
  // to the ACTUAL render-target size in onBeforeRender (covering supersampled custom
  // pipelines); this size*dpr value is the fallback for the default R3F loop.
  useLayoutEffect(() => {
    const width = size.width * dpr;
    const height = size.height * dpr;
    if (!customMaterial && material instanceof TrajectoryMaterial) {
      material.setResolution(width, height);
    }
    highlightMaterial.setResolution(width, height);
  }, [material, customMaterial, size, dpr, highlightMaterial]);

  // Swap the bound geometry between low/high LOD based on camera distance. Comparing
  // against the currently bound geometry keeps this self-correcting when a React
  // re-render reasserts the initial `geometry` prop below.
  useFrame(() => {
    if (!geometries || !tubeMeshRef.current || !capsMeshRef.current) return;
    // No WellboreBounds ancestor => distance stays Infinity (the DistanceContext
    // default); fall back to the high LOD so a stand-alone Trajectory still looks
    // correct up close. With bounds present, swap on the reported camera distance.
    const distance = distanceContext.current;
    const lod =
      !Number.isFinite(distance) || distance < lodDistance ? 'high' : 'low';
    const target = geometries[lod];
    if (tubeMeshRef.current.geometry !== target.tube) {
      tubeMeshRef.current.geometry = target.tube;
    }
    // Drop the caps on the low LOD: far away they are effectively sub-pixel, so this
    // reclaims the extra vertices vs a plain line. NOTE: with a large minPixelRadius
    // the floor keeps the tube several px wide even far out, where an open end could
    // show a small hollow ring — revisit (e.g. keep caps) if that becomes visible.
    const showCaps = lod === 'high';
    capsMeshRef.current.visible = showCaps;
    if (showCaps && capsMeshRef.current.geometry !== target.caps) {
      capsMeshRef.current.geometry = target.caps;
    }
  });

  // The group is always rendered so it can be registered with the EventEmitter on
  // mount; the meshes appear once the async geometry loads and the picking helper
  // (which re-traverses each pick) then picks them up.
  return (
    <group position={position} userData={userData} visible={visible}>
      {geometries && (
        <>
          <mesh
            ref={tubeMeshRef}
            name={name}
            renderOrder={renderOrder}
            layers={layers}
            castShadow={castShadow}
            receiveShadow={receiveShadow}
            geometry={geometries.low.tube}
            material={material}
            customDepthMaterial={customDepthMaterial}
            customDistanceMaterial={customDistanceMaterial}
          />
          <mesh
            ref={capsMeshRef}
            renderOrder={renderOrder}
            layers={layers}
            castShadow={castShadow}
            receiveShadow={receiveShadow}
            geometry={geometries.low.caps}
            material={material}
            customDepthMaterial={customDepthMaterial}
            customDistanceMaterial={customDistanceMaterial}
          />
        </>
      )}
    </group>
  );
};
