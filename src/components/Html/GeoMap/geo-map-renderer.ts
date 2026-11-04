import {
  BufferAttribute,
  BufferGeometry,
  Color,
  type ColorRepresentation,
  CustomBlending,
  Mesh,
  OneFactor,
  OrthographicCamera,
  Scene,
  ShaderMaterial,
  type Texture,
  Uniform,
  Vector4,
  WebGLRenderer,
} from 'three';
import { colorRampTexture } from '../../../common/color-ramps';
import type { HeightFieldTile } from '../../../sdk/geometries/height-field-clip';
import {
  RELIEF_TILE_CELLS,
  type ReliefTile,
} from '../../../sdk/geometries/relief-tiles';
import { mapProjectionScale } from '../../../sdk/projection/map-projections';
import {
  mapViewGrid,
  mapViewPlaneAt,
  type MapView,
} from '../../../sdk/projection/map-view';
import {
  geoTileRegion,
  geoTileSquareFrom,
} from '../../../sdk/tiles/geo-tile-keys';
import {
  geoTileCountOver,
  geoTileDepthFor,
  selectGeoMapTiles,
} from '../../../sdk/tiles/geo-tile-select';
import { TileStreamer } from '../../../sdk/tiles/tile-streamer';
import type { Vec2 } from '../../../sdk/types/common';
import { SceneryReliefAtlas } from '../../Scenery/scenery-relief-atlas';
import { SceneryReliefTileTextures } from '../../Scenery/scenery-relief-tiles';
import fragmentShader from './shaders/geo-map-fragment.glsl';
import vertexShader from './shaders/geo-map-vertex.glsl';

/** Cells along each side of a map's grid in the scene's map: the longitude and latitude are exact at its corners and interpolated between. */
export const GEO_MAP_GRID = 8;
// The same in a projection, whose longitudes and latitudes bend across a whole hemisphere,
// and in the scene's map past SCENE_WIDE_FROM, where it bends too and may stop holding.
const PROJECTED_GRID = 32;
// Metres across past which the scene's map is drawn on the finer grid.
const SCENE_WIDE_FROM = 500000;
// How far a grid point may come back from its longitude and latitude through the scene's
// map, as a share of a grid cell, before the map is taken not to hold there.
const ROUND_TRIP = 0.05;
// The most a grid cell's corners may lie apart on the Earth, degrees: past it the scene's
// map tears there, and the cell is left out. Across a pole or the antimeridian it does not:
// the wide grid carries directions, not longitudes and latitudes.
const TEAR = 60;
const TEAR_DOT = Math.cos((TEAR * Math.PI) / 180);

// The fewest tiles a map holds: a small map's full view at the default detail draws about a
// hundred, with the ancestors that stand in while they load.
const MIN_SLOTS = 512;
// The most, whatever the GPU allows: about 22 MB of tiles.
const MAX_SLOTS = 2048;
// What a tile holds on the GPU, in bytes: heights, normals and layers per node.
const TILE_BYTES = (RELIEF_TILE_CELLS + 3) ** 2 * (4 + 4 + 1);
// The deepest tile, as the stage's.
const MAX_DEPTH = 19;
// Loads at a time: the stage's tiles come from the same generators, and come first.
const CONCURRENCY = 2;
// Device-pixel metres past which a projected view works out each pixel's longitude and
// latitude from the plane (see geo-map-fragment.glsl `uGeoMapExact`).
const EXACT_FROM = 100;
// What geo-map-fragment.glsl's uGeoMapProjection numbers each projection.
const PROJECTION_CODE = {
  scene: 0,
  'web-mercator': 1,
  'equal-earth': 2,
  'lambert-conformal-conic': 3,
};

/**
 * How many tiles a map of `width` x `height` CSS pixels at `pixelRatio` holds, at `cellPixels`
 * device pixels a cell: about two and a half times the tiles a view across it shows at the
 * detail asked (the rest stand in while finer ones load, and come in with a move), from 512,
 * to no more than the GPU's texture arrays allow (`maxLayers`), and 2048 at most.
 *
 * @group Components
 */
export function geoMapTileSlots(
  width: number,
  height: number,
  pixelRatio: number,
  cellPixels: number,
  maxLayers = MAX_SLOTS,
): number {
  const tile = RELIEF_TILE_CELLS * Math.max(cellPixels, 0.25);
  const across =
    (Math.ceil((width * pixelRatio) / tile) + 1) *
    (Math.ceil((height * pixelRatio) / tile) + 1);
  return Math.min(
    Math.max(Math.ceil(across * 2.5), MIN_SLOTS),
    MAX_SLOTS,
    maxLayers,
  );
}

/** How a map draws the relief: see `GeoMapProps.mode`. */
export type GeoMapMode = 'shaded' | 'outline';

/** What a map's relief looks like beyond its colours (`SceneryReliefLooks`). */
export type GeoMapAppearance = {
  mode: GeoMapMode;
  /** the slope's vertical exaggeration in the shading */
  exaggeration: number;
  /** how strongly the slope shades, 0 to 1 */
  strength: number;
  /** the sea's colour where the look's seabed takes it */
  seaColor: ColorRepresentation;
  /** outline mode: the coast's and the contours' colour */
  outlineColor: ColorRepresentation;
  /** outline mode: the land's fill */
  outlineFill: ColorRepresentation;
  outlineFillOpacity: number;
};

/**
 * Where a map's relief tiles come from: the relief's layers merged onto geographic tiles
 * (`buildGeoReliefTile`, through the `sceneryReliefTile` generator), as the stage's are.
 */
export type GeoMapTileSource = {
  /** the tile, or null where there is none */
  load: (key: number) => Promise<ReliefTile | null>;
  /** the height where no layer has data, metres over the sea (the tiles' base) */
  base: number;
};

/** A view to draw, and how much of it: two cross-fade while a projection gives way to another. */
export type GeoMapDrawnView = {
  view: MapView;
  /** 0 to 1 */
  opacity: number;
};

// A texture of this renderer's own over `shared`'s image: three ties a texture to every
// renderer that uploads it with a listener on its `dispose`, which a renderer's own disposal
// leaves behind, so a texture shared with the scene's renderer would keep every disposed
// map renderer alive. The clone shares the data; `syncShared` follows its changes.
function ownTexture<T extends Texture>(shared: T): T {
  const own = shared.clone() as T;
  own.version = shared.version;
  return own;
}

// Upload the shared texture's changes to this context: by the texture's own version, not the
// shared source's, which the scene's renderer would then upload again.
function syncShared(own: Texture, shared: Texture) {
  if (own.version !== shared.version) own.version = shared.version;
}

// One view's mesh: a grid over the canvas whose vertices carry their longitude and latitude
// from the middle (`aGeo`); in a projection, their point of its plane (`aPlane`); and in the
// scene's map seen wide, their direction from the Earth's centre (`aDir`).
class GeoMapMesh {
  readonly mesh: Mesh;
  readonly cells: number;
  private readonly geometry = new BufferGeometry();
  // Every cell's two triangles at most: the cells kept are written to the front, and drawn.
  private readonly index: BufferAttribute;
  // Whether every cell is drawn now.
  private full = false;
  readonly geo: BufferAttribute;
  readonly plane: BufferAttribute;
  readonly dir: BufferAttribute;
  readonly material: ShaderMaterial;

  constructor(cells: number, uniforms: Record<string, Uniform>) {
    this.cells = cells;
    const count = (cells + 1) ** 2;
    const position = new Float32Array(count * 3);
    for (let j = 0; j <= cells; j++) {
      for (let i = 0; i <= cells; i++) {
        const at = (j * (cells + 1) + i) * 3;
        position[at] = (i / cells) * 2 - 1;
        position[at + 1] = 1 - (j / cells) * 2;
      }
    }
    this.index = new BufferAttribute(new Uint16Array(cells * cells * 6), 1);
    this.geo = new BufferAttribute(new Float32Array(count * 2), 2);
    this.plane = new BufferAttribute(new Float32Array(count * 2), 2);
    this.dir = new BufferAttribute(new Float32Array(count * 3), 3);
    this.geometry.setAttribute('position', new BufferAttribute(position, 3));
    this.geometry.setAttribute('aGeo', this.geo);
    this.geometry.setAttribute('aPlane', this.plane);
    this.geometry.setAttribute('aDir', this.dir);
    this.geometry.setIndex(this.index);
    this.keepCells();
    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        ...uniforms,
        uGeoMapOpacity: new Uniform(1),
        uGeoMapProjection: new Uniform(0),
        uGeoMapCone: new Uniform(new Vector4()),
        uGeoMapExact: new Uniform(0),
        uGeoMapSphere: new Uniform(0),
      },
      depthTest: false,
      depthWrite: false,
      transparent: true,
      // Premultiplied, added: two views cross-fading sum to one.
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneFactor,
      blendSrcAlpha: OneFactor,
      blendDstAlpha: OneFactor,
    });
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }

  /** Draw only the cells `keep` keeps (column, row from the top left); all of them without one. */
  keepCells(keep?: (i: number, j: number) => boolean) {
    // All of them already: nothing to write.
    if (!keep && this.full) return;
    this.full = !keep;
    const cells = this.cells;
    const index = this.index.array as Uint16Array;
    let n = 0;
    for (let j = 0; j < cells; j++) {
      for (let i = 0; i < cells; i++) {
        if (keep && !keep(i, j)) continue;
        const a = j * (cells + 1) + i;
        const b = a + 1;
        const c = a + cells + 1;
        index[n++] = a;
        index[n++] = c;
        index[n++] = b;
        index[n++] = b;
        index[n++] = c;
        index[n++] = c + 1;
      }
    }
    this.geometry.setDrawRange(0, n);
    this.index.clearUpdateRanges();
    if (n > 0) this.index.addUpdateRange(0, n);
    this.index.needsUpdate = true;
  }
}

/**
 * Draws a relief top-down on a canvas of its own, from the relief's tiles — the stage's,
 * geographic, its layers merged over its base — loaded for what the view shows, at the
 * detail it shows them at: a grid whose vertices carry their longitude and latitude, and a
 * fragment shader that reads the ground per pixel through an index of the tiles drawn
 * (`relief-atlas.glsl`). In the scene's own map, or in a projection's plane (`MapView`'s
 * `projected`): two views cross-fade while one gives way to the other. A context of its
 * own, so it holds its tiles on the GPU itself, but no frame of the host's is spent: it
 * renders only when asked. However many layers, and however large, only the tiles in view
 * are ever read.
 */
export class GeoMapRenderer {
  readonly canvas: HTMLCanvasElement;
  /** a tile came in or went: the map should be drawn again (see {@link setView}) */
  onTiles: () => void = () => {};
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera();
  private readonly uniforms: Record<string, Uniform>;
  private readonly meshes: Record<
    'scene' | 'sceneWide' | 'projected',
    GeoMapMesh[]
  >;
  private textures: SceneryReliefTileTextures;
  private readonly atlas: SceneryReliefAtlas;
  // The most array layers this context's textures may have.
  private readonly maxLayers: number;
  // The looks and the colour ramps, shared with the scene, and this context's own of each.
  private readonly shared: [Texture, Texture][];
  private readonly base: Uniform<number>;
  private readonly latitude = new Uniform(0);
  private readonly look = new Vector4(0, 2, 0.8, 1);
  private readonly seaColor = new Color();
  private readonly outlineColor = new Color();
  private readonly outlineFill = new Vector4();
  private pixelRatio = 1;
  private cellPixels = 2;
  private streamer: TileStreamer<ReliefTile> | null = null;
  private readonly slotOf = new Map<number, number>();
  // The size, in CSS pixels, the slots were last sized for.
  private size: Vec2 = [1, 1];

  /**
   * @param looks the relief's looks (`SceneryReliefLooks.texture`); not disposed here, and
   *   drawn from a texture of this renderer's own, so changes to it show at the next render
   * @throws if there is no WebGL 2 context to be had
   */
  constructor(looks: Texture) {
    this.renderer = new WebGLRenderer({
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'low-power',
    });
    this.renderer.setClearColor(0x000000, 0);
    this.canvas = this.renderer.domElement;

    const context = this.renderer.getContext() as WebGL2RenderingContext;
    this.maxLayers = context.getParameter(
      context.MAX_ARRAY_TEXTURE_LAYERS,
    ) as number;
    this.textures = new SceneryReliefTileTextures(
      RELIEF_TILE_CELLS,
      Math.min(MIN_SLOTS, this.maxLayers),
    );
    this.atlas = new SceneryReliefAtlas(this.textures);

    const ownLooks = ownTexture(looks);
    const ownRamps = ownTexture(colorRampTexture);
    this.shared = [
      [looks, ownLooks],
      [colorRampTexture, ownRamps],
    ];
    this.base = new Uniform(0);
    this.uniforms = {
      ...this.atlas.uniforms,
      uReliefBase: this.base,
      uGeoMapLatitude: this.latitude,
      uReliefLook: new Uniform(ownLooks),
      uColorRamps: new Uniform(ownRamps),
      uGeoMap: new Uniform(this.look),
      uSeaColor: new Uniform(this.seaColor),
      uOutlineColor: new Uniform(this.outlineColor),
      uOutlineFill: new Uniform(this.outlineFill),
    };
    // Two of each kind: a projection may cross-fade into another.
    this.meshes = { scene: [], sceneWide: [], projected: [] };
    for (let i = 0; i < 2; i++) {
      for (const kind of ['scene', 'sceneWide', 'projected'] as const) {
        const mesh = new GeoMapMesh(
          kind === 'scene' ? GEO_MAP_GRID : PROJECTED_GRID,
          this.uniforms,
        );
        mesh.mesh.visible = false;
        mesh.mesh.renderOrder = i;
        this.meshes[kind].push(mesh);
        this.scene.add(mesh.mesh);
      }
    }
  }

  /**
   * Where the tiles come from: tiles from another source are let go, and the new ones are
   * loaded as the view asks for them (see {@link setView}).
   */
  setSource(source: GeoMapTileSource | null) {
    this.streamer?.dispose();
    this.streamer = null;
    this.atlas.set([], [0, 0, 0, 0]);
    if (!source) return;
    this.base.value = source.base;
    const { slotOf } = this;
    this.streamer = new TileStreamer<ReliefTile>(
      {
        load: source.load,
        bytes: () => TILE_BYTES,
      },
      {
        concurrency: CONCURRENCY,
        budget: this.budget(),
        onLoad: (key, tile) => {
          slotOf.set(key, this.textures.put(tile));
          this.onTiles();
        },
        onEvict: key => {
          this.textures.release(slotOf.get(key) ?? -1);
          slotOf.delete(key);
        },
      },
    );
  }

  /** Set the canvas's size in CSS pixels, and the device pixels to a CSS pixel. */
  setSize(width: number, height: number, pixelRatio: number) {
    this.pixelRatio = pixelRatio;
    this.size = [width, height];
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height);
    this.fitSlots();
  }

  /** How it looks: the mode, the shading, the colours. */
  setAppearance(a: GeoMapAppearance) {
    this.look.x = a.mode === 'outline' ? 1 : 0;
    this.look.y = a.exaggeration;
    this.look.z = a.strength;
    this.seaColor.set(a.seaColor);
    this.outlineColor.set(a.outlineColor);
    const fill = new Color(a.outlineFill);
    this.outlineFill.set(fill.r, fill.g, fill.b, a.outlineFillOpacity);
  }

  /** How detailed the map is: device pixels a tile's cell spans, at most. */
  setCellPixels(cellPixels: number) {
    this.cellPixels = Math.max(cellPixels, 0.25);
    this.fitSlots();
  }

  // What the tiles in may hold: most of the slots, the rest left for those loading.
  private budget() {
    return Math.floor(this.textures.slots * 0.9) * TILE_BYTES;
  }

  // More slots for a map grown larger or finer than they hold: the textures made again, and
  // the tiles in put back in them. Never fewer while it lives.
  private fitSlots() {
    const wanted = geoMapTileSlots(
      this.size[0],
      this.size[1],
      this.pixelRatio,
      this.cellPixels,
      this.maxLayers,
    );
    if (wanted <= this.textures.slots) return;
    const was = this.textures;
    const textures = new SceneryReliefTileTextures(RELIEF_TILE_CELLS, wanted);
    for (const [key] of this.slotOf) {
      const tile = this.streamer?.get(key);
      this.slotOf.set(key, tile ? textures.put(tile) : -1);
    }
    this.textures = textures;
    const u = this.atlas.uniforms;
    u.uReliefAtlasHeights.value = textures.heights;
    u.uReliefAtlasNormals.value = textures.normals;
    u.uReliefAtlasLayers.value = textures.layers;
    was.dispose();
    this.streamer?.setBudget(this.budget());
    this.onTiles();
  }

  /**
   * Place the views on the Earth — one, or two cross-fading, about the same middle: each
   * grid vertex takes its longitude and latitude relative to the middle's, in 64-bit floats
   * here so the shader keeps its precision in 32; choose the tiles they show, ask for those
   * not in, and index those that are about the middle. Call before {@link render}, and
   * again once {@link onTiles} says more came in.
   *
   * @param views the ground the canvas shows, in the scene's map or a projection's plane
   * @param toLonLat the scene's X/Z to longitude and latitude (`geoFrameLonLat`)
   * @param toXZ the reverse (`geoFrameXZ`): with it, the scene's map is drawn only where it
   *   holds — a grid point must come back where it was, and a cell must not span its seams
   *   — and left out farther off, where a transverse Mercator such as UTM folds and tears
   */
  setView(
    views: GeoMapDrawnView | GeoMapDrawnView[],
    toLonLat: (x: number, z: number) => Vec2,
    toXZ?: (longitude: number, latitude: number) => Vec2,
  ) {
    const list = (Array.isArray(views) ? views : [views]).slice(0, 2);
    if (!list.length) return;
    const first = list[0].view;
    const [centerLon, centerLat] =
      first.lonLat ?? toLonLat(first.center[0], first.center[1]);
    this.latitude.value = centerLat;
    const devicePixel = first.metresPerPixel / this.pixelRatio;
    this.look.w = devicePixel;

    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    // Per projected view: the scale at the middle, for each tile's depth.
    const scales: { view: MapView; scale: number }[] = [];
    const used = { scene: 0, sceneWide: 0, projected: 0 };
    for (const mesh of this.allMeshes()) mesh.mesh.visible = false;
    list.forEach(({ view, opacity }, order) => {
      const projected = view.projected;
      const wide =
        Math.max(view.size[0], view.size[1]) * view.metresPerPixel >
        SCENE_WIDE_FROM;
      const kind = projected ? 'projected' : wide ? 'sceneWide' : 'scene';
      const mesh = this.meshes[kind][used[kind]++];
      const uniforms = mesh.material.uniforms;
      mesh.mesh.visible = opacity > 0;
      mesh.mesh.renderOrder = order;
      uniforms.uGeoMapOpacity.value = opacity;
      uniforms.uGeoMapProjection.value = projected
        ? PROJECTION_CODE[projected.plane.projection.name]
        : 0;
      const cone = projected?.plane.projection.cone;
      if (cone)
        (uniforms.uGeoMapCone.value as Vector4).set(
          cone.n,
          cone.rf,
          cone.rho0,
          cone.rhoEnd,
        );
      // Wide: per pixel from the plane, which 32 bits hold to a metre or two, so no grid
      // cell straddling the map's edge smears it; close: interpolated, more precise.
      uniforms.uGeoMapExact.value =
        projected && view.metresPerPixel / this.pixelRatio > EXACT_FROM ? 1 : 0;
      // The scene's map seen wide: directions, interpolated through a pole or across the
      // antimeridian without a jump, and turned into longitude and latitude per pixel.
      uniforms.uGeoMapSphere.value = kind === 'sceneWide' ? 1 : 0;
      const geo = mesh.geo.array as Float32Array;
      const plane = mesh.plane.array as Float32Array;
      const dir = mesh.dir.array as Float32Array;
      const cells = mesh.cells;
      const row = cells + 1;
      const put = (i: number, lon: number, lat: number) => {
        // Across the antimeridian: the short way round.
        let dLon = lon - centerLon;
        dLon -= 360 * Math.floor((dLon + 180) / 360);
        geo[i * 2] = dLon;
        geo[i * 2 + 1] = lat - centerLat;
        // Its direction, longitude from the middle's: x toward it, z north.
        const l = (dLon * Math.PI) / 180;
        const p = (lat * Math.PI) / 180;
        dir[i * 3] = Math.cos(p) * Math.cos(l);
        dir[i * 3 + 1] = Math.cos(p) * Math.sin(l);
        dir[i * 3 + 2] = Math.sin(p);
      };
      // The tiles are chosen over the points drawn.
      const extend = (i: number) => {
        const dLon = geo[i * 2];
        const dLat = geo[i * 2 + 1];
        if (dLon < minLon) minLon = dLon;
        if (dLon > maxLon) maxLon = dLon;
        if (dLat < minLat) minLat = dLat;
        if (dLat > maxLat) maxLat = dLat;
      };
      if (projected) {
        const { plane: map } = projected;
        for (let j = 0; j <= cells; j++) {
          for (let i = 0; i <= cells; i++) {
            const k = j * row + i;
            const [u, v] = mapViewPlaneAt(
              view,
              (i / cells) * view.size[0],
              (j / cells) * view.size[1],
            );
            plane[k * 2] = u;
            plane[k * 2 + 1] = v;
            const [dLon, lat] = map.lonLatAt(u, v);
            put(k, dLon + map.meridian, lat);
            extend(k);
          }
        }
        scales.push({ view, scale: projected.scale });
      } else {
        // Where the scene's map holds: its point comes back through it.
        const holds = new Uint8Array(row * row);
        const tolerance =
          (ROUND_TRIP *
            Math.max(view.size[0], view.size[1]) *
            view.metresPerPixel) /
          cells;
        mapViewGrid(view, cells).forEach(([x, z], k) => {
          const [lon, lat] = toLonLat(x, z);
          let ok = Number.isFinite(lon) && Number.isFinite(lat);
          if (ok && toXZ) {
            const [bx, bz] = toXZ(lon, lat);
            ok = Math.hypot(bx - x, bz - z) <= tolerance;
          }
          holds[k] = ok ? 1 : 0;
          put(k, ok ? lon : centerLon, ok ? lat : centerLat);
        });
        if (toXZ) {
          // A tear: corners farther apart on the Earth than any cell spans.
          const near = (a: number, b: number) =>
            dir[a * 3] * dir[b * 3] +
              dir[a * 3 + 1] * dir[b * 3 + 1] +
              dir[a * 3 + 2] * dir[b * 3 + 2] >=
            TEAR_DOT;
          const keep = (i: number, j: number) => {
            const a = j * row + i;
            const b = a + 1;
            const c = a + row;
            const d = c + 1;
            return (
              !!holds[a] &&
              !!holds[b] &&
              !!holds[c] &&
              !!holds[d] &&
              near(a, b) &&
              near(a, c) &&
              near(a, d) &&
              near(b, c) &&
              near(b, d) &&
              near(c, d)
            );
          };
          mesh.keepCells(keep);
          for (let j = 0; j < cells; j++)
            for (let i = 0; i < cells; i++)
              if (keep(i, j)) {
                const a = j * row + i;
                extend(a);
                extend(a + 1);
                extend(a + row);
                extend(a + row + 1);
              }
        } else {
          mesh.keepCells();
          for (let k = 0; k < holds.length; k++) extend(k);
        }
      }
      mesh.geo.needsUpdate = true;
      mesh.plane.needsUpdate = true;
      mesh.dir.needsUpdate = true;
    });

    const streamer = this.streamer;
    // Nothing of the scene's map holds in view: nothing to load.
    if (!streamer || !(minLon <= maxLon)) return;
    // A pixel's margin, for the slope's neighbours at the edge.
    const padLon = (maxLon - minLon) / Math.max(first.size[0], 1);
    const padLat = (maxLat - minLat) / Math.max(first.size[1], 1);
    // All the way round in longitude about a pole in view: every longitude, and up to the
    // pole, which lie between the grid's points.
    const round = maxLon - minLon > 270;
    if (round) {
      minLon = -180;
      maxLon = 180;
    }
    const south =
      round && centerLat + minLat < -45
        ? -90
        : Math.max(centerLat + minLat - padLat, -90);
    const north =
      round && centerLat + maxLat > 45
        ? 90
        : Math.min(centerLat + maxLat + padLat, 90);
    const { slotOf } = this;
    const bounds: [number, number, number, number] = [
      centerLon + minLon - padLon,
      south,
      centerLon + maxLon + padLon,
      north,
    ];
    // As fine as asked at the middle, but no more tiles than half the slots hold: the rest
    // are for the ancestors that stand in, and for the tiles a move brings in.
    const asked = geoTileDepthFor(
      this.cellPixels * devicePixel,
      RELIEF_TILE_CELLS,
      MAX_DEPTH,
      centerLat,
    );
    let depth = asked;
    const most = Math.floor(this.textures.slots / 2);
    while (depth > 0 && geoTileCountOver(bounds, depth) > most) depth--;
    // In a projection a pixel spans less ground where it scales the map up (Mercator toward
    // the poles): a tile there is chosen as fine as its own scale asks, less the same cut.
    const depthAt = scales.length
      ? (key: number) => {
          const [west, top, span] = geoTileRegion(key);
          const longitude = west + span / 2;
          const latitude = Math.max(Math.min(top - span / 2, 89), -89);
          let finest = 0;
          for (const { view, scale } of scales) {
            const plane = view.projected!.plane;
            const here = mapProjectionScale(
              plane.projection,
              longitude - plane.meridian,
              latitude,
            );
            const ground =
              ((view.metresPerPixel / this.pixelRatio) * scale) / here;
            finest = Math.max(
              finest,
              geoTileDepthFor(
                this.cellPixels * ground,
                RELIEF_TILE_CELLS,
                MAX_DEPTH,
                latitude,
              ),
            );
          }
          return Math.max(finest - (asked - depth), 0);
        }
      : undefined;
    const selection = selectGeoMapTiles({
      bounds,
      depth,
      depthAt,
      // A leaf's cells may be a third coarser than its data: a level more holds all of it.
      pastLeaf: 1,
      info: key => {
        const tile = streamer.get(key);
        // A tile with no slot (all taken) is passed over: its ancestor stands in.
        if (!tile || (slotOf.get(key) ?? -1) < 0) return undefined;
        return tile;
      },
    });
    streamer.update(selection.used, selection.want);
    const tiles: HeightFieldTile[] = [];
    for (const key of selection.draw) {
      const slot = slotOf.get(key) ?? -1;
      if (slot < 0) continue;
      const [minX, minZ, width] = geoTileSquareFrom(key, centerLon, centerLat);
      tiles.push({ minX, minZ, width, slot });
      // Across the far meridian (behind a pole in view): on its other side too, where the
      // shader takes a longitude past it the short way round.
      if (minX < -180) tiles.push({ minX: minX + 360, minZ, width, slot });
      if (minX + width > 180)
        tiles.push({ minX: minX - 360, minZ, width, slot });
    }
    // In the index's coordinates: degrees east and south of the middle.
    this.atlas.set(tiles, [
      minLon - padLon,
      centerLat - north,
      maxLon + padLon,
      centerLat - south,
    ]);
  }

  private allMeshes() {
    return [
      ...this.meshes.scene,
      ...this.meshes.sceneWide,
      ...this.meshes.projected,
    ];
  }

  render() {
    for (const [shared, own] of this.shared) syncShared(own, shared);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.onTiles = () => {};
    this.streamer?.dispose();
    this.streamer = null;
    this.textures.dispose();
    this.atlas.dispose();
    for (const [, own] of this.shared) own.dispose();
    for (const mesh of this.allMeshes()) mesh.dispose();
    this.renderer.dispose();
    // Browsers allow only so many contexts: give it back now, not when it is collected.
    this.renderer.forceContextLoss();
  }
}
