import {
  Color,
  ColorRepresentation,
  DataTexture,
  FloatType,
  Matrix3,
  NearestFilter,
  RGFormat,
  Vector4,
} from 'three';
import { SurfaceMeta, Vec2, surfaceWorldToGrid } from '../../sdk';

/**
 * The contact types, in the order they are stacked when several are declared.
 *
 * ⚠️ It is only a DEFAULT ordering, used for draw order and for legends. Nothing
 * in the library derives geology from it: a contact is drawn where its own grid
 * says it is, and two contacts are never ordered against each other.
 */
export const CHUNK_CONTACT_TYPES = ['goc', 'gwc', 'owc', 'hwc', 'fwl'] as const;

/** Gas/oil, gas/water, oil/water, hydrocarbon/water, free water level. */
export type ChunkContactType = (typeof CHUNK_CONTACT_TYPES)[number];

/**
 * Widest a screen-space contact line may get, in metres. At field scale anything
 * thicker starts reading as a band rather than a line.
 */
export const DEFAULT_CONTACT_MAX_WIDTH = 25;

/**
 * Default colour per contact type, keyed on the fluid ABOVE the contact — the
 * line marks where that fluid stops.
 *
 * ⚠️ A convention chosen here, not a standard. Override with `color`.
 */
export const CHUNK_CONTACT_COLORS: Record<ChunkContactType, string> = {
  goc: '#c8452f',
  gwc: '#c8452f',
  owc: '#3f7a3f',
  hwc: '#3f7a3f',
  fwl: '#3f6fa8',
};

/**
 * A fluid contact, drawn as a LINE rather than as a volume.
 *
 * ⭐ A contact is an ordinary depth surface grid — mostly flat, but with the same
 * conventions as a horizon — and it is deliberately NOT a stack layer: it takes no
 * part in the depth order, so it can neither truncate a horizon nor be truncated
 * by one. It is drawn per fragment, where the geometry's own height crosses the
 * contact's, so ONE test yields both the accumulation outline on a cap and the
 * horizontal line on a section face. Nothing is rebuilt when it changes.
 *
 * ⚠️ It is drawn on whatever face crosses it, so a contact given no `layers`
 * restriction will also draw across units that hold no fluid. That is deliberate —
 * masking it to a unit is the host's interpretation to make, not the library's.
 *
 * @group Components
 */
export type ChunkContact = {
  /** referenced by {@link ChunkLayer.contacts} */
  id: string;
  /** the contact's depth grid */
  surface: SurfaceMeta;
  /** picks a default colour; carries no behaviour */
  type?: ChunkContactType;
  color?: ColorRepresentation;
  /** line width, in pixels or metres per {@link ChunkContact.widthSpace} */
  width?: number;
  /** default `'screen'`, so the line stays legible at any zoom */
  widthSpace?: 'screen' | 'world';
  /**
   * Widest a SCREEN-space line may get in metres, default 25.
   *
   * ⚠️ Not a style knob — a guard. The screen width is derived from `fwidth`, which
   * is taken over the 2x2 fragment quad, so at a block corner or a silhouette the
   * quad straddles two faces and the derivative is far too large; without a bound
   * the line smears along the corner. Raise it if you work at a scale where a
   * contact line is legitimately thicker than this.
   */
  maxWidth?: number;
  /**
   * `[dash, gap]` in PIXELS. Omit for a solid line.
   *
   * ⚠️ Best-effort: the dash runs along the line in SCREEN space (the line has no
   * arc-length parameterisation, being an implicit contour), so it degrades where
   * the line turns within a pixel or runs nearly edge-on to the camera.
   */
  dash?: Vec2;
  /** blend strength of the line over the rock, default 1 */
  opacity?: number;
};

/** A contact's grid, uploaded once and shared by every chunk that draws it. */ export type ChunkContactMap =
  {
    texture: DataTexture;
    /** object XZ -> texture uv, as `uv = m * vec3(x, z, 1)` */
    toUv: Matrix3;
  };

/** A contact prepared for the shader. */
export type ChunkContactTexture = ChunkContactMap & {
  id: string;
  color: Color;
  /** x: half width, y: 1 world / 0 screen, z: dash, w: gap */
  style: Vector4;
  opacity: number;
  /** world-space bound on a screen-space line's half width, in metres */
  maxHalfWidth: number;
};

/** Scene XZ of a surface grid's origin. */
export type UtmToScene = (
  easting: number,
  northing: number,
  altitude: number,
) => [number, number, number];

/**
 * Pack a contact's grid into a texture the chunk shaders can sample.
 *
 * ⚠️ Two channels, not one: R carries the contact's scene Y and G its validity,
 * because the grid's nodata sentinel is a legal float that would otherwise be
 * drawn as a contact at an absurd depth.
 *
 * ⚠️ NEAREST filtering, deliberately. Linear filtering of a 32-bit float texture
 * needs `OES_texture_float_linear`, and half float cannot hold a depth of a few
 * thousand metres to better than a couple of metres — far coarser than the line
 * being drawn. The shader interpolates the four texels itself, which also lets it
 * reject a sample whose neighbours are unmapped instead of smearing across them.
 */
export function buildContactMap(
  surface: SurfaceMeta,
  values: Float32Array | number[],
  utmToScene: UtmToScene,
  nullValue = -1,
): ChunkContactMap {
  const { header, max } = surface;
  const { nx, ny } = header;
  const count = nx * ny;
  // ⚠⚠ R is FILLED everywhere, G carries the truth. An unmapped node left at 0
  // would be a cliff of a couple of thousand metres at the edge of the mapped
  // area, and the shader takes screen-space derivatives of this field — which
  // painted a vertical tick off the end of every line. A contact is nearly flat,
  // so the mean of what IS mapped is an unobtrusive continuation of it.
  let total = 0;
  let mapped = 0;
  for (let i = 0; i < count; i++) {
    const v = values[i];
    if (v !== nullValue && Number.isFinite(v)) {
      total += v - max;
      mapped++;
    }
  }
  const fill = mapped ? total / mapped : 0;

  const data = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const v = values[i];
    const valid = v !== nullValue && Number.isFinite(v);
    // Scene Y, upwards-positive: the grids are stored as `max - depth`.
    data[2 * i] = valid ? v - max : fill;
    data[2 * i + 1] = valid ? 1 : 0;
  }
  const texture = new DataTexture(data, nx, ny, RGFormat, FloatType);
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;

  const origin = utmToScene(header.xori, header.yori, 0);
  const toGrid = surfaceWorldToGrid(header, [origin[0], origin[2]]);
  // Recovered by evaluation rather than rederived, so the mapping cannot drift
  // from the one the geometry is built with.
  const o = toGrid(0, 0);
  const ex = toGrid(1, 0);
  const ez = toGrid(0, 1);
  const toUv = new Matrix3().set(
    (ex[0] - o[0]) / nx,
    (ez[0] - o[0]) / nx,
    (o[0] + 0.5) / nx,
    (ex[1] - o[1]) / ny,
    (ez[1] - o[1]) / ny,
    (o[1] + 0.5) / ny,
    0,
    0,
    1,
  );
  return { texture, toUv };
}

/** Combine a contact's grid with its appearance. Cheap — no upload. */
export function styleContact(
  contact: ChunkContact,
  map: ChunkContactMap,
): ChunkContactTexture {
  const [dash, gap] = contact.dash ?? [0, 0];
  return {
    ...map,
    id: contact.id,
    color: new Color(
      contact.color ??
        (contact.type ? CHUNK_CONTACT_COLORS[contact.type] : '#ffffff'),
    ),
    style: new Vector4(
      (contact.width ?? 2) / 2,
      contact.widthSpace === 'world' ? 1 : 0,
      dash,
      gap,
    ),
    opacity: contact.opacity ?? 1,
    maxHalfWidth: (contact.maxWidth ?? DEFAULT_CONTACT_MAX_WIDTH) / 2,
  };
}

/** Which contacts a layer draws, honouring an explicit opt-out. */
export function resolveLayerContacts(
  contacts: ChunkContactTexture[],
  selection: string[] | false | undefined,
): ChunkContactTexture[] {
  if (selection === undefined) return contacts;
  if (selection === false) return [];
  return contacts.filter(c => selection.includes(c.id));
}
