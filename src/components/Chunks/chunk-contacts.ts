import { Color, ColorRepresentation, Vector4 } from 'three';
import { SurfaceMeta, Vec2 } from '../../sdk';
import { ChunkDepthMap } from './chunk-depth-map';

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

/** A contact prepared for the shader. */
export type ChunkContactTexture = ChunkDepthMap & {
  id: string;
  color: Color;
  /** x: half width, y: 1 world / 0 screen, z: dash, w: gap */
  style: Vector4;
  opacity: number;
  /** world-space bound on a screen-space line's half width, in metres */
  maxHalfWidth: number;
};

/** Combine a contact's grid with its appearance. Cheap — no upload. */
export function styleContact(
  contact: ChunkContact,
  map: ChunkDepthMap,
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
