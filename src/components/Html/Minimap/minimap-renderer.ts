import {
  BufferAttribute,
  BufferGeometry,
  Color,
  type ColorRepresentation,
  type DataTexture,
  Mesh,
  OrthographicCamera,
  Scene,
  ShaderMaterial,
  type Texture,
  Uniform,
  Vector4,
  WebGLRenderer,
} from 'three';
import { colorRampTexture } from '../../../common/color-ramps';
import type { ReliefGeoGrid } from '../../../sdk/geometries/relief-grid';
import { mapViewGrid, type MapView } from '../../../sdk/projection/map-view';
import type { Vec2 } from '../../../sdk/types/common';
import {
  createSceneryReliefTexture,
  SCENERY_RELIEF_FAR_MAX_LAYERS,
} from '../../Scenery/scenery-relief';
import fragmentShader from './shaders/minimap-fragment.glsl';
import vertexShader from './shaders/minimap-vertex.glsl';

/** Cells along each side of the minimap's grid: the longitude and latitude are exact at its corners and interpolated between. */
export const MINIMAP_GRID = 8;

/** How the minimap draws the relief: see {@link MinimapProps.mode}. */
export type MinimapMode = 'shaded' | 'outline';

/** What a minimap's relief looks like beyond its colours (`SceneryReliefLooks`). */
export type MinimapAppearance = {
  mode: MinimapMode;
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

/** One of the relief's layers on a minimap: its grid in longitude and latitude, and its look (1 + its index in the relief). */
export type MinimapRenderLayer = {
  grid: ReliefGeoGrid;
  look: number;
};

const NO_LAYERS = new Vector4();

/**
 * Draws a relief, merged from its layers in longitude and latitude, top-down on a canvas of
 * its own: a small grid whose vertices carry their longitude and latitude, and a fragment
 * shader that merges the layers' maps as the stage's overview does
 * (`minimap-fragment.glsl`). A context of its own, so it owns its textures' GPU copies, but
 * the grids' data is shared with the caller; and no frame of the host's is spent: it renders
 * only when asked.
 */
export class MinimapRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera();
  private readonly geometry = new BufferGeometry();
  private readonly geoAttribute: BufferAttribute;
  private readonly material: ShaderMaterial;
  private readonly textures: DataTexture[];
  private readonly grids: ReliefGeoGrid[];
  private readonly frames: Vector4[];
  private readonly minimap = new Vector4(0, 2, 0.8, 1);
  private readonly seaColor = new Color();
  private readonly outlineColor = new Color();
  private readonly outlineFill = new Vector4();
  private pixelRatio = 1;

  /**
   * @param layers the relief's layers, coarse to fine, at most
   *   {@link SCENERY_RELIEF_FAR_MAX_LAYERS} (the rest are left out)
   * @param base the height where no layer has data, metres over the sea
   * @param looks the relief's looks (`SceneryReliefLooks.texture`); not disposed here
   * @throws if there is no WebGL 2 context to be had
   */
  constructor(layers: MinimapRenderLayer[], base: number, looks: Texture) {
    const used = layers.slice(0, SCENERY_RELIEF_FAR_MAX_LAYERS);
    this.renderer = new WebGLRenderer({
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'low-power',
    });
    this.renderer.setClearColor(0x000000, 0);
    this.canvas = this.renderer.domElement;

    this.grids = used.map(({ grid }) => grid);
    this.textures = this.grids.map(createSceneryReliefTexture);
    this.frames = used.map(() => new Vector4());

    const cells = MINIMAP_GRID;
    const position = new Float32Array((cells + 1) ** 2 * 3);
    for (let j = 0; j <= cells; j++) {
      for (let i = 0; i <= cells; i++) {
        const at = (j * (cells + 1) + i) * 3;
        position[at] = (i / cells) * 2 - 1;
        position[at + 1] = 1 - (j / cells) * 2;
      }
    }
    const index: number[] = [];
    for (let j = 0; j < cells; j++) {
      for (let i = 0; i < cells; i++) {
        const a = j * (cells + 1) + i;
        const b = a + 1;
        const c = a + cells + 1;
        index.push(a, c, b, b, c, c + 1);
      }
    }
    this.geoAttribute = new BufferAttribute(
      new Float32Array((cells + 1) ** 2 * 2),
      2,
    );
    this.geometry.setAttribute('position', new BufferAttribute(position, 3));
    this.geometry.setAttribute('aGeo', this.geoAttribute);
    this.geometry.setIndex(index);

    const uniforms: Record<string, Uniform> = {
      uReliefMapFrames: new Uniform(
        this.frames.length ? this.frames : [NO_LAYERS],
      ),
      uReliefMapSizes: new Uniform(
        this.grids.map(
          grid =>
            new Vector4(
              grid.levels[0].width,
              grid.levels[0].height,
              grid.levels.length - 1,
              grid.wraps ? 1 : 0,
            ),
        ),
      ),
      uReliefMapLooks: new Uniform(used.map(({ look }) => look)),
      uReliefBase: new Uniform(base),
      uReliefLook: new Uniform(looks),
      uColorRamps: new Uniform(colorRampTexture),
      uMinimap: new Uniform(this.minimap),
      uSeaColor: new Uniform(this.seaColor),
      uOutlineColor: new Uniform(this.outlineColor),
      uOutlineFill: new Uniform(this.outlineFill),
    };
    this.textures.forEach((texture, i) => {
      uniforms[`uReliefMap${i}`] = new Uniform(texture);
    });
    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
      defines: {
        RELIEF_FAR_LAYERS: Math.max(this.textures.length, 1),
        // Heights at full precision, for the slope: see relief.glsl.
        RELIEF_EXACT: '',
      },
      depthTest: false,
      depthWrite: false,
    });
    const mesh = new Mesh(this.geometry, this.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }

  /** Set the canvas's size in CSS pixels, and the device pixels to a CSS pixel. */
  setSize(width: number, height: number, pixelRatio: number) {
    this.pixelRatio = pixelRatio;
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height);
  }

  /** How it looks: the mode, the shading, the colours. */
  setAppearance(a: MinimapAppearance) {
    this.minimap.x = a.mode === 'outline' ? 1 : 0;
    this.minimap.y = a.exaggeration;
    this.minimap.z = a.strength;
    this.seaColor.set(a.seaColor);
    this.outlineColor.set(a.outlineColor);
    const fill = new Color(a.outlineFill);
    this.outlineFill.set(fill.r, fill.g, fill.b, a.outlineFillOpacity);
  }

  /**
   * Place the view on the Earth: each vertex of the grid takes its longitude and latitude,
   * relative to the middle's, and each layer its own place relative to it, in 64-bit floats
   * here so the shader keeps its precision in 32. Call before {@link render}.
   *
   * @param view the ground the canvas shows
   * @param toLonLat the scene's X/Z to longitude and latitude (`geoFrameLonLat`)
   */
  setView(view: MapView, toLonLat: (x: number, z: number) => Vec2) {
    const [centerLon, centerLat] = toLonLat(view.center[0], view.center[1]);
    const points = mapViewGrid(view, MINIMAP_GRID);
    const data = this.geoAttribute.array as Float32Array;
    points.forEach(([x, z], i) => {
      const [lon, lat] = toLonLat(x, z);
      // Across the antimeridian: the short way round.
      let dLon = lon - centerLon;
      if (dLon > 180) dLon -= 360;
      else if (dLon < -180) dLon += 360;
      data[i * 2] = dLon;
      data[i * 2 + 1] = lat - centerLat;
    });
    this.geoAttribute.needsUpdate = true;

    this.grids.forEach((grid, i) => {
      this.frames[i].set(
        grid.origin[0] - centerLon,
        grid.origin[1] - centerLat,
        grid.cell[0],
        grid.cell[1],
      );
    });
    this.minimap.w = view.metresPerPixel / this.pixelRatio;
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.textures.forEach(texture => texture.dispose());
    this.geometry.dispose();
    this.material.dispose();
    this.renderer.dispose();
    // Browsers allow only so many contexts: give it back now, not when it is collected.
    this.renderer.forceContextLoss();
  }
}
