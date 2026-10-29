import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  BufferGeometry,
  Color,
  ColorRepresentation,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Material,
  Matrix4,
  Quaternion,
  ShaderMaterial,
  Uniform,
  Vector2,
  Vector3,
  type IUniform,
} from 'three';
import { attachOitVariants } from '../../rendering/oit-material';
import { PlanarPointGeometry } from '../../sdk/geometries/planar-geometry';
import type { SymbolsType } from '../../sdk/data/types/Symbol';
import type {
  GeoFeature,
  GeoJsonFeatureCollection,
} from '../../sdk/layers/geo-features';
import type { LayerVisibility } from '../../sdk/layers/layer-visibility';
import type { GeoFrame } from '../../sdk/projection/geo-frame';
import type { Globe } from '../../sdk/projection/globe';
import type { Vec2 } from '../../sdk/types/common';
import { pixelsPerUnit } from '../../sdk/utils/lod';
import { useSceneryOcean } from '../Scenery/scenery-context';
import type { SceneryMaterial } from '../Scenery/scenery-material';
import { sceneryOceanDefines } from '../Scenery/scenery-stage';
import { Symbols } from '../Symbol/Symbol';
import { layerShownAt, useGeoFeatures, useLayerGlobe } from './layer-globe';
import fragmentShader from './shaders/geo-symbol-fragment.glsl';
import vertexShader from './shaders/geo-symbol-vertex.glsl';

/**
 * How a point is drawn by {@link GeoSymbols}.
 *
 * @group Layers
 */
export type GeoSymbolStyle = {
  /** Default '#ffb000' */
  color?: ColorRepresentation;
  /** across, in metres, as it stands: the geometry is scaled by it (its unit size). Default 50 */
  size?: number;
};

/**
 * GeoSymbols props
 * @expand
 */
export type GeoSymbolsProps<P = Record<string, unknown>> = LayerVisibility & {
  /** the points, in longitude and latitude: GeoJSON, or features read from it (`geoFeaturesFromGeoJson`). Other kinds are left out; each point of a multi-point is one symbol */
  data: GeoJsonFeatureCollection<P> | GeoFeature<P>[] | null;
  /** one style for all, or one per feature. Keep a function stable (`useCallback`) */
  style?: GeoSymbolStyle | ((feature: GeoFeature<P>) => GeoSymbolStyle);
  /** the shape, a unit across, standing on y 0 with +Y up. Default a disc, a unit across and 0.4 high */
  geometry?: BufferGeometry;
  /** Default its own, coloured per symbol, shaded by how each face turns up, and seen through the sea as `water` says. A material of your own is drawn as it is */
  material?: Material;
  /** with its own material inside a `Scenery` with a sea: `'fog'` is seen through the water as the seabed is; `'clear'` as it is. Default 'fog' */
  water?: 'fog' | 'clear';
  /** how many times larger than `size` each is drawn. Default 1 */
  exaggeration?: number;
  /** the least size drawn on screen, in pixels across, however far: it is widened, never raised, so it stays on the ground it stands on. 0 for none: drawn as built, shrinking out of sight with distance as any geometry does. Default 6 */
  minPixels?: number;
  /** inside a `Scenery`, stand on the relief its stage draws; else at `height`. Default true */
  onGround?: boolean;
  /** metres over the sea where there is no ground (no relief, or `onGround` off). Default 0 */
  height?: number;
  /** where the scene lies on the Earth, without a `World` or `Scenery` to say */
  frame?: GeoFrame;
};

const DEFAULT_STYLE: GeoSymbolStyle = {};
const UP = new Vector3(0, 1, 0);
const color = new Color();
const position = new Vector3();
const up = new Vector3();
const scale = new Vector3();
const turn = new Quaternion();
const matrix = new Matrix4();

function createDefaultGeometry() {
  const geometry = new CylinderGeometry(0.5, 0.5, 0.4, 24);
  geometry.translate(0, 0.2, 0);
  return geometry;
}

/**
 * GeoSymbols' own material: each symbol's colour (`instanceColor`), shaded by how much each
 * face turns up, on `globe`; with `sky`, seen through its sea as the seabed is. Opaque, wired
 * for an `OITRenderPass`.
 */
function createGeoSymbolMaterial(
  globe: Globe,
  sky: SceneryMaterial | null,
): ShaderMaterial {
  const defines: Record<string, unknown> = sky ? sceneryOceanDefines(sky) : {};
  if (sky) defines.GEO_SYMBOL_WATER = '';
  const own: Record<string, IUniform> = {
    ...globe.uniforms,
    resolution: new Uniform(new Vector2(1, 1)),
    uSymbolMinPixels: new Uniform(0),
  };
  // The sky's own uniform objects, inherited rather than copied, as its other materials do.
  const uniforms = sky
    ? Object.assign(
        Object.create(sky.uniforms) as Record<string, IUniform>,
        own,
      )
    : own;
  const material = new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    defines,
    lights: !!sky,
  });
  return attachOitVariants(material);
}

/**
 * Points in longitude and latitude — facilities, wells, buoys — as 3D symbols: one instanced
 * mesh (`Symbols`) of any geometry and material, each placed on the globe where it lies,
 * standing upright on the relief a `Scenery`'s stage draws (or at `height`), its size in
 * metres as it stands, exaggerated, and never narrower than `minPixels` across on screen —
 * widened, not raised, so a symbol on the seabed stays under the water — in sight from afar
 * and from any angle. Its own material is seen through the sea as the seabed is (`water`).
 * For their names, a `GeoLabels`.
 *
 * See `documents/layers.md`.
 *
 * @example
 * <GeoSymbols data={facilities} style={f => ({ color: 'yellow', size: 80 })} minPixels={8} />
 *
 * @group Components
 */
export const GeoSymbols = <P,>({
  data,
  style = DEFAULT_STYLE,
  geometry,
  material,
  water = 'fog',
  exaggeration = 1,
  minPixels = 6,
  onGround = true,
  height = 0,
  frame,
  visible = true,
  minHeight,
  maxHeight,
  fade,
}: GeoSymbolsProps<P>) => {
  const placed = useLayerGlobe(frame);
  const globe = placed?.globe ?? null;
  const ocean = useSceneryOcean();
  const hub = onGround && ocean ? ocean.reliefTiles : null;
  const size = useThree(state => state.size);
  const features = useGeoFeatures(data);

  const ownGeometry = useMemo(
    () => (geometry ? null : createDefaultGeometry()),
    [geometry],
  );
  useEffect(() => () => ownGeometry?.dispose(), [ownGeometry]);
  // Its own material, made with the sky's defines (compiled in): new ones need a new one.
  const sky = water === 'fog' && ocean ? ocean.material : null;
  const definesKey = sky ? ocean?.definesKey : '';
  const ownMaterial = useMemo(
    () => (material || !globe ? null : createGeoSymbolMaterial(globe, sky)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [material, globe, sky, definesKey],
  );
  useEffect(() => () => ownMaterial?.dispose(), [ownMaterial]);
  // Its own material widens each symbol on the GPU.
  useEffect(() => {
    if (!ownMaterial) return;
    ownMaterial.uniforms.uSymbolMinPixels.value = minPixels;
    (ownMaterial.uniforms.resolution.value as Vector2).set(
      size.width,
      size.height,
    );
  }, [ownMaterial, minPixels, size]);

  // Each symbol: where it lies, and its size as it stands.
  const styleKey = typeof style === 'function' ? style : JSON.stringify(style);
  const symbols = useMemo(() => {
    const at: Vec2[] = [];
    const sizes: number[] = [];
    const colors: number[] = [];
    for (const feature of features) {
      if (!(feature.geometry instanceof PlanarPointGeometry)) continue;
      const given = typeof style === 'function' ? style(feature) : style;
      color.set(given.color ?? '#ffb000');
      for (const point of feature.geometry.coordinates as Vec2[]) {
        at.push(point);
        sizes.push(given.size ?? 50);
        colors.push(color.r, color.g, color.b);
      }
    }
    const instances: SymbolsType = {
      transformations: new Float32Array(at.length * 16),
      colors: new Float32Array(colors),
    };
    return {
      at,
      sizes,
      data: instances,
      ground: new Float64Array(at.length),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- by the style's content
  }, [features, styleKey]);

  // The ground under each, again when the relief's tiles change, no more than twice a second.
  const state = useRef({
    resident: -2,
    time: 0,
    symbols: null as unknown,
    view: '',
  });
  const group = useRef<Group>(null);
  const visibility = useRef<LayerVisibility>({});
  visibility.current = { visible, minHeight, maxHeight, fade };

  useFrame(({ camera }) => {
    const mesh = group.current?.children[0] as InstancedMesh | undefined;
    if (!group.current || !mesh || !globe || !globe.frame) return;
    const shown = layerShownAt(
      camera.position,
      globe,
      ocean,
      visibility.current,
      hub ? 'ground' : height,
    );
    group.current.visible = shown > 0;
    if (shown <= 0) return;
    // Moved every frame: the bounds three found once no longer hold.
    mesh.frustumCulled = false;
    // Drawn with the sky's shaders: their camera uniforms set for the camera drawing it.
    if (sky && !material) mesh.onBeforeRender = sky.onBeforeDraw;
    const relief = hub?.current ?? null;
    const now = performance.now();
    const resident = relief ? relief.resident : -1;
    const { at, sizes, ground } = symbols;
    let changed = false;
    if (
      state.current.symbols !== symbols ||
      (resident !== state.current.resident && now - state.current.time > 500)
    ) {
      state.current = { ...state.current, resident, time: now, symbols };
      for (let i = 0; i < at.length; i++)
        ground[i] = relief?.heightAt(at[i][0], at[i][1]) ?? height;
      changed = true;
    }
    // Nothing moved and nothing changed: the symbols stand as they are. With its own
    // material, the camera moves nothing: the GPU widens them.
    const widenHere = !!material;
    const seen = widenHere
      ? `${camera.position.x},${camera.position.y},${camera.position.z}|${size.height}|${minPixels}`
      : '';
    const viewKey = `${seen}|${exaggeration}|${globe.discCentre.x},${globe.discCentre.z},${globe.radius},${globe.enabled}`;
    if (!changed && viewKey === state.current.view) return;
    state.current.view = viewKey;
    const perUnit = pixelsPerUnit(camera, size.height);
    for (let i = 0; i < at.length; i++) {
      globe.geodetic(at[i][1], at[i][0], ground[i], position);
      globe.upAt(position, up);
      turn.setFromUnitVectors(UP, up);
      const built = sizes[i] * exaggeration;
      const across = widenHere
        ? Math.max(
            built,
            minPixels / perUnit(position.distanceTo(camera.position)),
          )
        : built;
      matrix.compose(position, turn, scale.set(across, built, across));
      matrix.toArray(mesh.instanceMatrix.array, 16 * i);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  if (symbols.at.length === 0 || !(material ?? ownMaterial)) return null;
  return (
    <Symbols
      ref={group}
      data={symbols.data}
      geometry={geometry ?? ownGeometry!}
      material={material ?? ownMaterial!}
    />
  );
};
