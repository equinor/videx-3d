import {
  Camera,
  DataTexture,
  FloatType,
  HalfFloatType,
  type IUniform,
  LinearFilter,
  LinearMipmapLinearFilter,
  type Material,
  Matrix3,
  Mesh,
  NearestFilter,
  NoBlending,
  RedFormat,
  RGBAFormat,
  RGFormat,
  Scene,
  ShaderMaterial,
  type Texture,
  Uniform,
  Vector2,
  Vector3,
  Vector4,
  WebGLCubeRenderTarget,
  type WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { GroundMap } from '../../sdk/materials/ground-map';
import {
  geoReliefTileGrid,
  type GeoReliefGrid,
  type ReliefTile,
} from '../../sdk/geometries/relief-tiles';
import {
  conformalOffset,
  geodeticLatitude,
  type ConformalOrigin,
} from '../../sdk/projection/conformal-sphere';
import type { Globe } from '../../sdk/projection/globe';
import { tileKey } from '../../sdk/tiles/tile-keys';
import type { ReliefTileLoader } from '../Layers/relief-tile-loader';
import type { CloudMapTerrain } from './scenery-cloud-map';
import { createSceneryGeometry } from './scenery-material';
import fragmentShader from './shaders/ground-terrain.glsl';

// The Earth's heights: the geographic quadtree's 8 tiles of 90° (depth 1), 512 cells each, so
// some 20 km apart; drawn into a cube map of as many texels a face's side.
const EARTH_DEPTH = 1;
const EARTH_CELLS = 512;
const EARTH_FACE = 512;
// Conformal latitudes the geodetic ones are tabled at (ground-terrain.glsl): the table's
// interpolation is good to some 25 m.
const LATITUDES = 128;
const DEG = Math.PI / 180;

/**
 * A map of the ground about the camera: tiles of the quadtree's `depth` with `cells` along a
 * side, drawn into a square of `size` texels a side reaching `reach` (world units) from its
 * middle to its sides. Made again once the camera's foot is `move` of its reach from its
 * middle, below `highest` (from higher up, the coarser maps do); of at most `mostTiles`
 * tiles (toward a pole their longitudes narrow).
 */
type GroundLevelSpec = {
  depth: number;
  cells: number;
  size: number;
  reach: number;
  move: number;
  highest: number;
  mostTiles: number;
};

// About the camera, for the clouds and the sea far off: tiles of 1.4° (depth 7), 256 cells
// each (some 600 m), some 400 m a texel.
const NEAR: GroundLevelSpec = {
  depth: 7,
  cells: 256,
  size: 512,
  reach: 100000,
  move: 0.3,
  highest: 300000,
  mostTiles: 48,
};
// Close to it, for the sea's shallows: tiles of 0.18° (depth 10), 256 cells each (some 75 m),
// some 60 m a texel.
const FINE: GroundLevelSpec = {
  depth: 10,
  cells: 256,
  size: 512,
  reach: 15000,
  move: 0.3,
  highest: 30000,
  mostTiles: 48,
};

const vertexShader = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/** A map's place: its middle (unit, fixed on the Earth), east and north there. */
export type GroundLevelFrame = {
  centre: Vector3;
  east: Vector3;
  north: Vector3;
};

// A map about the camera as it is drawn and asked for.
class GroundLevel {
  readonly targets: [WebGLRenderTarget, WebGLRenderTarget];
  index = 0;
  // Its grid, where it lies (degrees), and what it was drawn for.
  grid: {
    grid: GeoReliefGrid;
    latitude: number;
    longitude: number;
  } | null = null;
  origin: ConformalOrigin | null = null;
  frame: GroundLevelFrame | null = null;
  drawn = false;
  loading = false;

  constructor(readonly spec: GroundLevelSpec) {
    const target = () =>
      new WebGLRenderTarget(spec.size, spec.size, {
        format: RGFormat,
        type: HalfFloatType,
        depthBuffer: false,
        generateMipmaps: false,
        minFilter: LinearFilter,
        magFilter: LinearFilter,
      });
    this.targets = [target(), target()];
  }

  get texture(): Texture {
    return this.targets[this.index].texture;
  }

  reset() {
    this.grid = null;
    this.frame = null;
    this.drawn = false;
    this.loading = false;
  }

  dispose() {
    for (const target of this.targets) target.dispose();
  }
}

/**
 * What the 3D clouds read of the ground, in the frame fixed on the Earth (cloud-march.glsl):
 * the Earth's map, and the one about the camera with its place.
 */
export type GroundCloudView = {
  earth: Texture | null;
  near: Texture | null;
  centre: Vector3;
  east: Vector3;
  north: Vector3;
  /** how far the map about the camera reaches from its middle to its sides, as a tangent */
  reach: number;
  /** the highest ground in, metres */
  highest: number;
};

/**
 * The ground under a `Scenery`, from a relief's tiles (its `World`'s relief loader), in the
 * frame fixed on the Earth: over the whole Earth, a cube map of its height (a), and of its
 * height and its slope east and north (r, g, b) never under the sea's level, which the 3D
 * clouds rise over, some 20 km to a texel; about the camera a finer map, some 400 m to a texel,
 * and close to it a finer one still, some 60 m, their height in g (r never under the sea's
 * level). Drawn on the GPU from grids of longitude and latitude, through the globe's conformal
 * sphere (ground-terrain.glsl). Shared as the scene's {@link GroundMap} ({@link map}): what
 * reads how deep the sea is (its surface), and the clouds ({@link cloudView}).
 */
export class SceneryGround {
  /** the maps, where they lie in the world: what the sea and what lies in it read */
  readonly map: GroundMap;
  /** draws the maps: compile it before they are drawn */
  readonly generator: Mesh;
  /** counts the Earth's heights drawn: what was made of the last (the cloud map) is stale */
  version = 0;
  private readonly material: ShaderMaterial;
  private readonly earth: WebGLCubeRenderTarget;
  private readonly near = new GroundLevel(NEAR);
  private readonly fine = new GroundLevel(FINE);
  private source: ReliefTileLoader | null = null;
  // Bumped with each new source: what loads for an old one is let go.
  private generation = 0;
  private earthGrid: GeoReliefGrid | null = null;
  private earthOrigin: ConformalOrigin | null = null;
  private earthDrawn = false;
  // The world's directions into the frame fixed on the Earth.
  private readonly toEarth = new Matrix3();
  private readonly toWorld = new Matrix3();
  private readonly scene = new Scene();
  private readonly camera = new Camera();
  private readonly cloud: GroundCloudView = {
    earth: null,
    near: null,
    centre: new Vector3(0, 0, 1),
    east: new Vector3(1, 0, 0),
    north: new Vector3(0, 1, 0),
    reach: 1,
    highest: 0,
  };

  /** @param map where to draw the maps (default one of its own): a sky's (`SceneryMaterial.groundMap`) */
  constructor(map = new GroundMap()) {
    this.map = map;
    this.material = new ShaderMaterial({
      name: 'scenery-ground',
      vertexShader,
      fragmentShader,
      defines: { TERRAIN_LATITUDES: LATITUDES },
      uniforms: {
        uMapFace: new Uniform(0),
        uMapSize: new Uniform(EARTH_FACE),
        uMapSeed: new Uniform(0),
        uTerrainGrid: new Uniform<Texture | null>(null),
        uTerrainGridSize: new Uniform(new Vector2(1, 1)),
        uTerrainGridPlace: new Uniform(new Vector3(0, 0, 1)),
        uTerrainLatitudes: new Uniform(
          new Array<number>(LATITUDES + 1).fill(0),
        ),
        uTerrainLongitude: new Uniform(new Vector2()),
        uTerrainMode: new Uniform(0),
        uTerrainNearCentre: new Uniform(new Vector3(0, 0, 1)),
        uTerrainNearEast: new Uniform(new Vector3(1, 0, 0)),
        uTerrainNearNorth: new Uniform(new Vector3(0, 1, 0)),
        uTerrainNearReach: new Uniform(1),
        uTerrainRadius: new Uniform(6371000),
      },
      depthTest: false,
      depthWrite: false,
      blending: NoBlending,
    });
    this.generator = new Mesh(createSceneryGeometry(), this.material);
    this.generator.frustumCulled = false;
    this.earth = new WebGLCubeRenderTarget(EARTH_FACE, {
      format: RGBAFormat,
      type: HalfFloatType,
      depthBuffer: false,
      generateMipmaps: true,
      minFilter: LinearMipmapLinearFilter,
      magFilter: LinearFilter,
    });
  }

  /** Whether what rises over it should wait for it: with a source, until the Earth's heights are drawn. */
  get waiting(): boolean {
    return this.source !== null && !this.earthDrawn;
  }

  /** What the cloud map is drawn over: the Earth's map, once drawn; null without one. */
  get mapTerrain(): CloudMapTerrain | null {
    return this.source && this.earthDrawn
      ? { texture: this.earth.texture, version: this.version }
      : null;
  }

  /** What the 3D clouds read of it, as drawn so far (see {@link GroundCloudView}). */
  get cloudView(): GroundCloudView {
    const view = this.cloud;
    view.earth = this.source && this.earthDrawn ? this.earth.texture : null;
    const near = this.near;
    view.near = this.source && near.drawn ? near.texture : null;
    if (near.frame) {
      view.centre.copy(near.frame.centre);
      view.east.copy(near.frame.east);
      view.north.copy(near.frame.north);
    }
    view.highest = Math.max(
      this.earthGrid?.max ?? 0,
      near.drawn ? (near.grid?.grid.max ?? 0) : 0,
      0,
    );
    return view;
  }

  /** The relief to take the ground from; null for none (the sea's level everywhere). */
  setSource(source: ReliefTileLoader | null) {
    if (source?.key === this.source?.key) {
      this.source = source;
      return;
    }
    this.source = source;
    const generation = ++this.generation;
    this.earthGrid = null;
    this.earthDrawn = false;
    this.near.reset();
    this.fine.reset();
    this.map.uniforms.uGround.value.set(0, 0, 0, 0);
    this.version++;
    if (!source) return;
    const columns = 2 ** (EARTH_DEPTH + 1);
    const rows = 2 ** EARTH_DEPTH;
    const keys: number[] = [];
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < columns; i++) keys.push(tileKey(EARTH_DEPTH, i, j));
    loadTiles(source, keys, EARTH_CELLS).then(tiles => {
      if (generation !== this.generation) return;
      this.earthGrid = geoReliefTileGrid(
        key => tiles.get(key),
        EARTH_DEPTH,
        0,
        columns,
        0,
        rows,
        EARTH_CELLS,
      );
    });
  }

  /**
   * Draw what has come in, for `globe` as it lies now, and ask for the ground about the
   * camera at `position` (world) as it moves; where the maps lie in the world. In the frame
   * loop.
   */
  update(renderer: WebGLRenderer, globe: Globe, position: Vector3) {
    const origin = globe.conformalOrigin;
    const on = this.map.uniforms.uGround.value;
    if (!origin || !this.source) {
      on.set(0, 0, 0, 0);
      return;
    }
    if (this.earthGrid && (!this.earthDrawn || this.earthOrigin !== origin)) {
      this.draw(renderer, this.earthGrid, origin, null);
      this.earthOrigin = origin;
      this.earthDrawn = true;
      this.version++;
    }
    const low = globe.altitude(position);
    const at = low < NEAR.highest ? globe.geographic(position) : null;
    for (const level of [this.near, this.fine]) {
      // Asked for once the camera's foot has moved far enough from the last one's middle;
      // drawn once in, and again for another frame.
      const { spec } = level;
      if (at && low < spec.highest && !level.loading) {
        const last = level.grid;
        if (
          !last ||
          greatCircle(
            at.latitude,
            at.longitude,
            last.latitude,
            last.longitude,
          ) *
            globe.radius >
            spec.move * spec.reach
        )
          this.loadLevel(level, at.latitude, at.longitude, globe.radius);
      }
      if (level.grid && (!level.drawn || level.origin !== origin)) {
        const { grid, latitude, longitude } = level.grid;
        const frame = groundLevelFrame(origin, latitude, longitude);
        level.index = 1 - level.index;
        this.draw(renderer, grid, origin, level, frame, globe.radius);
        level.origin = origin;
        level.frame = frame;
        level.drawn = true;
      }
    }
    this.cloud.reach = NEAR.reach / globe.radius;
    this.place(globe);
  }

  // Where the maps lie in the world (GroundMap): the Earth's centre, the world's directions
  // into the frame fixed on the Earth, and into each map's square.
  private place(globe: Globe) {
    const u = this.map.uniforms;
    earthFrame(globe, this.toEarth);
    this.toWorld.copy(this.toEarth).transpose();
    const up = globe.up;
    u.uGroundUp.value.copy(up);
    const c = globe.discCentre;
    // Off, the flat disc is taken as the plane touching a sphere of the Earth's radius.
    u.uGroundCentre.value.set(
      c.x,
      c.y,
      c.z,
      globe.enabled ? globe.centreDepth : globe.radius,
    );
    u.uGroundEarth.value = this.earthDrawn ? this.earth.texture : null;
    u.uGroundEarthFromWorld.value.copy(this.toEarth);
    const levels: [GroundLevel, IUniform<Texture | null>, IUniform<Matrix3>][] =
      [
        [this.near, u.uGroundNear, u.uGroundNearFromWorld],
        [this.fine, u.uGroundFine, u.uGroundFineFromWorld],
      ];
    for (const [level, texture, fromWorld] of levels) {
      texture.value = level.drawn ? level.texture : null;
      if (level.frame)
        groundLevelFromWorld(
          level.frame,
          level.spec.reach / globe.radius,
          this.toWorld,
          fromWorld.value,
        );
    }
    u.uGround.value.set(
      this.earthDrawn ? 1 : 0,
      this.near.drawn ? 1 : 0,
      this.fine.drawn ? 1 : 0,
      0,
    );
  }

  // The tiles about `latitude`, `longitude` (degrees) that `level`'s square takes in.
  private loadLevel(
    level: GroundLevel,
    latitude: number,
    longitude: number,
    radius: number,
  ) {
    const source = this.source;
    if (!source) return;
    const { depth, cells, reach: levelReach, mostTiles } = level.spec;
    const generation = this.generation;
    const span = 180 / 2 ** depth;
    // The square's corners lie √2 its reach off: some margin over that.
    const reach = (1.5 * levelReach) / radius / DEG;
    const south = Math.max(latitude - reach, -90);
    const north = Math.min(latitude + reach, 90);
    const widest = Math.min(Math.max(Math.abs(south), Math.abs(north)), 85);
    const across = reach / Math.cos(widest * DEG);
    const rows = 2 ** depth;
    const firstRow = Math.min(Math.floor((90 - north) / span), rows - 1);
    const lastRow = Math.min(Math.floor((90 - south) / span), rows - 1);
    const firstColumn = Math.floor((longitude - across + 180) / span);
    let lastColumn = Math.floor((longitude + across + 180) / span);
    const tileRows = lastRow - firstRow + 1;
    lastColumn = Math.min(
      lastColumn,
      firstColumn + Math.floor(mostTiles / tileRows) - 1,
    );
    const tileColumns = lastColumn - firstColumn + 1;
    const around = 2 ** (depth + 1);
    const keys: number[] = [];
    for (let r = 0; r < tileRows; r++)
      for (let c = 0; c < tileColumns; c++)
        keys.push(
          tileKey(
            depth,
            (((firstColumn + c) % around) + around) % around,
            firstRow + r,
          ),
        );
    level.loading = true;
    loadTiles(source, keys, cells).then(tiles => {
      if (generation !== this.generation) return;
      level.loading = false;
      level.grid = {
        grid: geoReliefTileGrid(
          key => tiles.get(key),
          depth,
          firstColumn,
          tileColumns,
          firstRow,
          tileRows,
          cells,
        ),
        latitude,
        longitude,
      };
      level.drawn = false;
    });
  }

  // Draw `grid` for `origin`: into the Earth's cube map (`level` null), or into `level`'s next
  // target with its frame. Leaves `renderer`'s target and settings as they were.
  private draw(
    renderer: WebGLRenderer,
    grid: GeoReliefGrid,
    origin: ConformalOrigin,
    level: GroundLevel | null,
    frame?: GroundLevelFrame,
    radius = origin.sphere.radius,
  ) {
    const texture = new DataTexture(
      grid.heights,
      grid.columns,
      grid.rows,
      RedFormat,
      FloatType,
    );
    texture.minFilter = texture.magFilter = NearestFilter;
    texture.generateMipmaps = false;
    texture.unpackAlignment = 1;
    texture.needsUpdate = true;

    const u = this.material.uniforms;
    u.uTerrainGrid.value = texture;
    (u.uTerrainGridSize.value as Vector2).set(grid.columns, grid.rows);
    (u.uTerrainGridPlace.value as Vector3).set(
      grid.west,
      grid.north,
      grid.step,
    );
    const latitudes = u.uTerrainLatitudes.value as number[];
    for (let i = 0; i <= LATITUDES; i++)
      latitudes[i] = geodeticLatitude(
        origin.sphere,
        -Math.PI / 2 + (Math.PI * i) / LATITUDES,
      );
    (u.uTerrainLongitude.value as Vector2).set(
      origin.longitude0,
      origin.sphere.n - 1,
    );
    u.uTerrainRadius.value = radius;

    const outer = renderer.getRenderTarget();
    const cubeFace = renderer.getActiveCubeFace();
    const mipLevel = renderer.getActiveMipmapLevel();
    const autoClear = renderer.autoClear;
    const autoReset = renderer.info.autoReset;
    const shadows = renderer.shadowMap.autoUpdate;
    renderer.autoClear = false;
    renderer.info.autoReset = false;
    renderer.shadowMap.autoUpdate = false;
    this.scene.add(this.generator);
    if (!level) {
      u.uTerrainMode.value = 0;
      u.uMapSize.value = EARTH_FACE;
      for (let face = 0; face < 6; face++) {
        u.uMapFace.value = face;
        // Its mipmaps once, after the last face.
        this.earth.texture.generateMipmaps = face === 5;
        renderer.setRenderTarget(this.earth, face);
        renderer.render(this.scene, this.camera);
      }
      this.earth.texture.generateMipmaps = false;
    } else if (frame) {
      u.uTerrainMode.value = 1;
      u.uMapSize.value = level.spec.size;
      u.uTerrainNearReach.value = level.spec.reach / radius;
      (u.uTerrainNearCentre.value as Vector3).copy(frame.centre);
      (u.uTerrainNearEast.value as Vector3).copy(frame.east);
      (u.uTerrainNearNorth.value as Vector3).copy(frame.north);
      renderer.setRenderTarget(level.targets[level.index]);
      renderer.render(this.scene, this.camera);
    }
    this.scene.remove(this.generator);
    renderer.setRenderTarget(outer, cubeFace, mipLevel);
    renderer.autoClear = autoClear;
    renderer.info.autoReset = autoReset;
    renderer.shadowMap.autoUpdate = shadows;
    u.uTerrainGrid.value = null;
    texture.dispose();
  }

  /** Dispose of what it holds; its material through `release` (default `dispose`). */
  dispose(release: (material: Material) => void = m => m.dispose()) {
    this.generation++;
    this.earth.dispose();
    this.near.dispose();
    this.fine.dispose();
    this.generator.geometry.dispose();
    release(this.material);
  }
}

/**
 * The 3D clouds' view of a {@link SceneryGround}: what their march reads of the ground
 * (cloud-march.glsl), in the frame fixed on the Earth, while they rise over it; none while
 * not. Its {@link version} changes with what they read.
 */
export class CloudGround {
  /** what the march reads (cloud-march.glsl) */
  readonly uniforms = {
    uCloudTerrainMap: new Uniform<Texture | null>(null),
    uCloudTerrainNear: new Uniform<Texture | null>(null),
    uCloudTerrainNearCentre: new Uniform(new Vector3(0, 0, 1)),
    uCloudTerrainNearEast: new Uniform(new Vector3(1, 0, 0)),
    uCloudTerrainNearNorth: new Uniform(new Vector3(0, 1, 0)),
    uCloudTerrainNearReach: new Uniform(1),
    // x: 1 with the Earth's heights, y: the highest ground (metres), z: 1 with the near map
    uCloudTerrain: new Uniform(new Vector4()),
  };
  private ground: SceneryGround | null = null;
  private on = false;
  // Bumped as the ground or its use changes.
  private serial = 0;

  /** The ground to rise over (`on`), or none. */
  set(ground: SceneryGround | null, on: boolean) {
    if (ground === this.ground && on === this.on) return;
    this.ground = ground;
    this.on = on;
    this.serial++;
    if (!this.shown) this.clear();
  }

  private get shown(): SceneryGround | null {
    return this.on ? this.ground : null;
  }

  /** counts what was drawn of it: what was made of the last (the cloud map, the light) is stale */
  get version(): number {
    return this.serial + (this.shown?.version ?? 0);
  }

  /** Whether the clouds should wait for it: until the Earth's heights are drawn. */
  get waiting(): boolean {
    return this.shown?.waiting ?? false;
  }

  /** What the cloud map is drawn over (see `SceneryGround.mapTerrain`). */
  get mapTerrain(): CloudMapTerrain | null {
    return this.shown?.mapTerrain ?? null;
  }

  /** Take what has been drawn of the ground. In the frame loop. */
  update() {
    const ground = this.shown;
    if (!ground) return;
    const view = ground.cloudView;
    const u = this.uniforms;
    u.uCloudTerrainMap.value = view.earth;
    if (view.near) {
      u.uCloudTerrainNear.value = view.near;
      u.uCloudTerrainNearCentre.value.copy(view.centre);
      u.uCloudTerrainNearEast.value.copy(view.east);
      u.uCloudTerrainNearNorth.value.copy(view.north);
      u.uCloudTerrainNearReach.value = view.reach;
    }
    u.uCloudTerrain.value.set(
      view.earth ? 1 : 0,
      view.highest,
      view.near ? 1 : 0,
      0,
    );
  }

  private clear() {
    this.uniforms.uCloudTerrain.value.set(0, 0, 0, 0);
  }
}

const scratchE = new Vector3();
const scratchN = new Vector3();
const scratchM = new Vector3();

/**
 * Into `target`: a point from the Earth's centre (world) into the square of a map about
 * `frame` reaching `reach` (as a tangent) from its middle to its sides: x and y across it as
 * shares of its reach, times z (ground-map.glsl's `groundMapAbout` divides). `toWorld` takes
 * the frame fixed on the Earth into the world ({@link earthFrame}'s transpose).
 */
export function groundLevelFromWorld(
  frame: GroundLevelFrame,
  reach: number,
  toWorld: Matrix3,
  target: Matrix3,
): Matrix3 {
  const e = scratchE.copy(frame.east).applyMatrix3(toWorld);
  const n = scratchN.copy(frame.north).applyMatrix3(toWorld);
  const m = scratchM.copy(frame.centre).applyMatrix3(toWorld);
  const scale = 1 / reach;
  return target.set(
    e.x * scale,
    e.y * scale,
    e.z * scale,
    n.x * scale,
    n.y * scale,
    n.z * scale,
    m.x,
    m.y,
    m.z,
  );
}

const east = new Vector3();

/**
 * The world's directions into the frame fixed on the Earth (z toward the conformal sphere's
 * north pole, x toward its longitude 0), from `globe`'s up, true north and place on the Earth;
 * without one, the Earth's frame about the scene's own. Into `target`.
 */
export function earthFrame(globe: Globe, target: Matrix3): Matrix3 {
  const up = globe.up;
  const north = globe.north;
  east.crossVectors(north, up).normalize();
  const sphere = globe.uniforms.uGlobeSphere.value;
  const located = sphere.w > 0.5;
  const sinChi = located ? sphere.x : 0;
  const cosChi = located ? sphere.y : 1;
  const lambda = located ? globe.uniforms.uGlobeLocation.value.x : 0;
  const sinL = Math.sin(lambda);
  const cosL = Math.cos(lambda);
  // The Earth's directions of the local east, north and up there.
  const e = [-sinL, cosL, 0];
  const n = [-sinChi * cosL, -sinChi * sinL, cosChi];
  const u = [cosChi * cosL, cosChi * sinL, sinChi];
  const m = target.elements;
  // Column-major: m[col * 3 + row] = e[row] east[col] + n[row] north[col] + u[row] up[col].
  for (let col = 0; col < 3; col++)
    for (let row = 0; row < 3; row++)
      m[col * 3 + row] =
        e[row] * east.getComponent(col) +
        n[row] * north.getComponent(col) +
        u[row] * up.getComponent(col);
  return target;
}

// Each of `keys` with `cells` along its side, its heights alone; a failed one left out.
async function loadTiles(
  source: ReliefTileLoader,
  keys: number[],
  cells: number,
): Promise<Map<number, ReliefTile>> {
  const tiles = await Promise.all(
    keys.map(key => source.load(key, cells, true).catch(() => null)),
  );
  const loaded = new Map<number, ReliefTile>();
  tiles.forEach((tile, i) => {
    if (tile) loaded.set(keys[i], tile);
  });
  return loaded;
}

// The angle between two places (degrees in, radians out).
function greatCircle(lat1: number, lon1: number, lat2: number, lon2: number) {
  const s1 = Math.sin(((lat2 - lat1) * DEG) / 2);
  const s2 = Math.sin(((lon2 - lon1) * DEG) / 2);
  const h = s1 * s1 + Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * s2 * s2;
  return 2 * Math.asin(Math.min(Math.sqrt(h), 1));
}

/**
 * Where `latitude`, `longitude` (degrees) lie in the frame fixed on the Earth, and east and
 * north there: on the conformal sphere of `origin`, at its longitude from the disc's centre's.
 */
export function groundLevelFrame(
  origin: ConformalOrigin,
  latitude: number,
  longitude: number,
): GroundLevelFrame {
  const [offset, delta] = conformalOffset(origin, latitude, longitude);
  const chi = origin.sphere.chi0 + offset;
  const lambda = origin.longitude0 + delta;
  const cosChi = Math.cos(chi);
  const sinChi = Math.sin(chi);
  const cosL = Math.cos(lambda);
  const sinL = Math.sin(lambda);
  return {
    centre: new Vector3(cosChi * cosL, cosChi * sinL, sinChi),
    east: new Vector3(-sinL, cosL, 0),
    north: new Vector3(-sinChi * cosL, -sinChi * sinL, cosChi),
  };
}
