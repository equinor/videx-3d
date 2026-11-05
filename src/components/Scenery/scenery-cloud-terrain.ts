import {
  Camera,
  DataTexture,
  FloatType,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  Material,
  Mesh,
  NearestFilter,
  NoBlending,
  RedFormat,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Texture,
  Uniform,
  Vector2,
  Vector3,
  Vector4,
  WebGLCubeRenderTarget,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
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
import fragmentShader from './shaders/cloud-terrain.glsl';

// The Earth's heights: the geographic quadtree's 8 tiles of 90° (depth 1), 512 cells each, so
// some 20 km apart; drawn into a cube map of as many texels a face's side.
const EARTH_DEPTH = 1;
const EARTH_CELLS = 512;
const EARTH_FACE = 512;
// About the camera: tiles of 1.4° (depth 7), 256 cells each (some 600 m), drawn into a square
// of this many texels a side reaching this far (world units) from its middle to its sides:
// some 400 m a texel. Made again once the camera's foot is this share of its reach from its
// middle, below this height (from higher up, the Earth's do).
const NEAR_DEPTH = 7;
const NEAR_CELLS = 256;
const NEAR_SIZE = 512;
const NEAR_REACH = 100000;
const NEAR_MOVE = 0.3;
const NEAR_HIGHEST = 300000;
// The most tiles about the camera: toward a pole their longitudes narrow.
const NEAR_MOST_TILES = 48;
// Conformal latitudes the geodetic ones are tabled at (cloud-terrain.glsl): the table's
// interpolation is good to some 25 m.
const LATITUDES = 128;
const DEG = Math.PI / 180;

const vertexShader = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

// The near map's place: its middle (fixed on the Earth), east and north there.
type NearFrame = { centre: Vector3; east: Vector3; north: Vector3 };

/**
 * The ground under the 3D clouds, from a relief's tiles (a `GeoRelief`'s loader), in the frame
 * fixed on the Earth they are read in: over the whole Earth, a cube map of its height (r) and
 * its slope east and north (g, b), some 20 km to a texel; and about the camera a finer map of
 * its height, some 400 m to a texel. Drawn on the GPU from grids of longitude and latitude,
 * through the globe's conformal sphere (cloud-terrain.glsl). Under the sea, the sea's level.
 * Internal to `SceneryCloudVolume`.
 */
export class CloudTerrain {
  /** what the march reads (cloud-volume-march.glsl) */
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
  /** draws the maps: compile it before they are drawn */
  readonly generator: Mesh;
  /** counts the Earth's heights drawn: what was made of the last (the cloud map) is stale */
  version = 0;
  private readonly material: ShaderMaterial;
  private readonly earth: WebGLCubeRenderTarget;
  private readonly near: [WebGLRenderTarget, WebGLRenderTarget];
  private nearIndex = 0;
  private source: ReliefTileLoader | null = null;
  // Bumped with each new source: what loads for an old one is let go.
  private generation = 0;
  private earthGrid: GeoReliefGrid | null = null;
  private earthOrigin: ConformalOrigin | null = null;
  private earthDrawn = false;
  // The near map's grid, where it lies (degrees), and what it was drawn for.
  private nearGrid: { grid: GeoReliefGrid; latitude: number; longitude: number } | null =
    null;
  private nearOrigin: ConformalOrigin | null = null;
  private nearDrawn = false;
  private nearLoading = false;
  private readonly scene = new Scene();
  private readonly camera = new Camera();

  constructor() {
    this.material = new ShaderMaterial({
      name: 'scenery-cloud-terrain',
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
        uTerrainLatitudes: new Uniform(new Array<number>(LATITUDES + 1).fill(0)),
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
    const nearTarget = () =>
      new WebGLRenderTarget(NEAR_SIZE, NEAR_SIZE, {
        format: RedFormat,
        type: HalfFloatType,
        depthBuffer: false,
        generateMipmaps: false,
        minFilter: LinearFilter,
        magFilter: LinearFilter,
      });
    this.near = [nearTarget(), nearTarget()];
  }

  /**
   * Whether the clouds should wait for it: with a source, until the Earth's heights are
   * drawn.
   */
  get waiting(): boolean {
    return this.source !== null && !this.earthDrawn;
  }

  /** What the cloud map is drawn over: the Earth's map, once drawn; null without one. */
  get mapTerrain(): CloudMapTerrain | null {
    return this.source && this.earthDrawn
      ? { texture: this.earth.texture, version: this.version }
      : null;
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
    this.nearGrid = null;
    this.nearDrawn = false;
    this.nearLoading = false;
    this.uniforms.uCloudTerrain.value.set(0, 0, 0, 0);
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
   * camera at `position` (world) as it moves. In the frame loop.
   */
  update(renderer: WebGLRenderer, globe: Globe, position: Vector3) {
    const origin = globe.conformalOrigin;
    const info = this.uniforms.uCloudTerrain.value;
    if (!origin || !this.source) {
      info.set(0, 0, 0, 0);
      return;
    }
    if (this.earthGrid && (!this.earthDrawn || this.earthOrigin !== origin)) {
      this.draw(renderer, this.earthGrid, origin, -1);
      this.earthOrigin = origin;
      this.earthDrawn = true;
      this.version++;
      this.uniforms.uCloudTerrainMap.value = this.earth.texture;
    }

    // About the camera: asked for once its foot has moved far enough from the last one's
    // middle; drawn once in, and again for another frame.
    if (globe.altitude(position) < NEAR_HIGHEST && !this.nearLoading) {
      const at = globe.geographic(position);
      const last = this.nearGrid;
      if (
        !last ||
        greatCircle(at.latitude, at.longitude, last.latitude, last.longitude) *
          globe.radius >
          NEAR_MOVE * NEAR_REACH
      )
        this.loadNear(at.latitude, at.longitude, globe.radius);
    }
    if (this.nearGrid && (!this.nearDrawn || this.nearOrigin !== origin)) {
      const { grid, latitude, longitude } = this.nearGrid;
      const frame = nearFrame(origin, latitude, longitude);
      this.nearIndex = 1 - this.nearIndex;
      this.draw(renderer, grid, origin, this.nearIndex, frame, globe.radius);
      this.nearOrigin = origin;
      this.nearDrawn = true;
      const u = this.uniforms;
      u.uCloudTerrainNear.value = this.near[this.nearIndex].texture;
      u.uCloudTerrainNearCentre.value.copy(frame.centre);
      u.uCloudTerrainNearEast.value.copy(frame.east);
      u.uCloudTerrainNearNorth.value.copy(frame.north);
      u.uCloudTerrainNearReach.value = NEAR_REACH / globe.radius;
    }
    info.set(
      this.earthDrawn ? 1 : 0,
      Math.max(
        this.earthGrid?.max ?? 0,
        this.nearDrawn ? (this.nearGrid?.grid.max ?? 0) : 0,
        0,
      ),
      this.nearDrawn ? 1 : 0,
      0,
    );
  }

  // The tiles about `latitude`, `longitude` (degrees) that the near map's square takes in.
  private loadNear(latitude: number, longitude: number, radius: number) {
    const source = this.source;
    if (!source) return;
    const generation = this.generation;
    const span = 180 / 2 ** NEAR_DEPTH;
    // The square's corners lie √2 its reach off: some margin over that.
    const reach = ((1.5 * NEAR_REACH) / radius) / DEG;
    const south = Math.max(latitude - reach, -90);
    const north = Math.min(latitude + reach, 90);
    const widest = Math.min(Math.max(Math.abs(south), Math.abs(north)), 85);
    const across = reach / Math.cos(widest * DEG);
    const rows = 2 ** NEAR_DEPTH;
    const firstRow = Math.min(Math.floor((90 - north) / span), rows - 1);
    const lastRow = Math.min(Math.floor((90 - south) / span), rows - 1);
    const firstColumn = Math.floor((longitude - across + 180) / span);
    let lastColumn = Math.floor((longitude + across + 180) / span);
    const tileRows = lastRow - firstRow + 1;
    lastColumn = Math.min(
      lastColumn,
      firstColumn + Math.floor(NEAR_MOST_TILES / tileRows) - 1,
    );
    const tileColumns = lastColumn - firstColumn + 1;
    const around = 2 ** (NEAR_DEPTH + 1);
    const keys: number[] = [];
    for (let r = 0; r < tileRows; r++)
      for (let c = 0; c < tileColumns; c++)
        keys.push(
          tileKey(
            NEAR_DEPTH,
            (((firstColumn + c) % around) + around) % around,
            firstRow + r,
          ),
        );
    this.nearLoading = true;
    loadTiles(source, keys, NEAR_CELLS).then(tiles => {
      if (generation !== this.generation) return;
      this.nearLoading = false;
      this.nearGrid = {
        grid: geoReliefTileGrid(
          key => tiles.get(key),
          NEAR_DEPTH,
          firstColumn,
          tileColumns,
          firstRow,
          tileRows,
          NEAR_CELLS,
        ),
        latitude,
        longitude,
      };
      this.nearDrawn = false;
    });
  }

  // Draw `grid` for `origin`: into the Earth's cube map (`near` −1), or into a near map with
  // its frame. Leaves `renderer`'s target and settings as they were.
  private draw(
    renderer: WebGLRenderer,
    grid: GeoReliefGrid,
    origin: ConformalOrigin,
    near: number,
    frame?: NearFrame,
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
    (u.uTerrainGridPlace.value as Vector3).set(grid.west, grid.north, grid.step);
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
    if (near < 0) {
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
      u.uMapSize.value = NEAR_SIZE;
      u.uTerrainNearReach.value = NEAR_REACH / radius;
      (u.uTerrainNearCentre.value as Vector3).copy(frame.centre);
      (u.uTerrainNearEast.value as Vector3).copy(frame.east);
      (u.uTerrainNearNorth.value as Vector3).copy(frame.north);
      renderer.setRenderTarget(this.near[near]);
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
    for (const target of this.near) target.dispose();
    this.generator.geometry.dispose();
    release(this.material);
  }
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

// Where `latitude`, `longitude` (degrees) lie in the frame fixed on the Earth, and east and
// north there: on the conformal sphere of `origin`, at its longitude from the disc's centre's.
function nearFrame(
  origin: ConformalOrigin,
  latitude: number,
  longitude: number,
): NearFrame {
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
