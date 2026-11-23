import { type Camera, type ColorRepresentation, Vector3 } from 'three';

/**
 * The water the camera is at, as the sea that knows it reports it (an `Ocean`, a `Scenery`'s
 * sea, a `ZoneStack`'s water).
 *
 * @group Utils
 */
export type CameraWater = {
  /** how far under the water's surface the camera is, metres; negative over it */
  depth: number;
  /** whether the camera is over the water's footprint (beside a box of water, it is not) */
  over: boolean;
  /** whether it is in the water: under its surface, over its footprint, above its seabed */
  inside: boolean;
  /** the sea that reported it */
  owner: unknown;
  /** a sea with no edge (a `Scenery`'s): one with an edge the camera is in is taken first */
  endless?: boolean;
};

/**
 * What the camera is inside of, to fade everything by (`useImmersionFog`): water, or rock.
 *
 * @group Utils
 */
export type CameraMedium = {
  /** what everything fades toward */
  color: ColorRepresentation;
  /** per-metre build-up */
  density: number;
  /** 0..1, how far inside the medium the camera is: ramps it in at a boundary */
  amount: number;
};

/**
 * Where the camera is, worked out once a frame for all that asks ({@link CameraSiteStore}):
 * what each owner of the scene knows of it, `null` (or its default) where none does.
 *
 * @group Utils
 */
export type CameraSite = {
  /** the camera it is for */
  camera: Camera | null;
  /** its position, world */
  readonly position: Vector3;
  /** its height along the world's up as the sky measures it (a `Scenery`): the sea at {@link seaLevel} */
  height: number | null;
  /** the sea's level in the same measure as {@link height} */
  seaLevel: number | null;
  /** its height over the sea, metres */
  altitude: number | null;
  /** the relief's ground under it, in the measure of {@link height} */
  ground: number | null;
  /** under the relief's {@link ground}, by the relief's own measure of where it lies: in rock, or the void below; false without a ground */
  underground: boolean;
  /** the void's lid over it while it is in the ground (`sceneryLidOverCamera`), in the measure of {@link height} */
  lid: number | null;
  /** in the ground above the sea's seabed, as from inside rock */
  buried: boolean;
  /** over the relief's ground below the sea's own seabed, as in a trench */
  trench: boolean;
  /** how far inside a `Scenery`'s hollow's rim (`sceneryHollowInside`); -Infinity none */
  hollow: number;
  /** the water it is at; the one it is in first */
  water: CameraWater | null;
  /** what it is inside of, to fade by; `null` open air */
  medium: CameraMedium | null;
};

/**
 * Works out part of a {@link CameraSite} for `camera`: writes what its owner knows, and reads
 * what probes of a lower order wrote before it.
 *
 * @group Utils
 */
export type CameraProbe = (site: CameraSite, camera: Camera) => void;

/**
 * The orders probes run in, lowest first: the ground before the sky that reads it, the sky
 * before the waters, the waters before what fades by them.
 *
 * @group Utils
 */
export const CAMERA_PROBE_ORDER = {
  ground: 0,
  sky: 10,
  water: 20,
  medium: 30,
} as const;

function emptySite(site: CameraSite, camera: Camera | null) {
  site.camera = camera;
  site.height = null;
  site.seaLevel = null;
  site.altitude = null;
  site.ground = null;
  site.underground = false;
  site.lid = null;
  site.buried = false;
  site.trench = false;
  site.hollow = -Infinity;
  site.water = null;
  site.medium = null;
}

/**
 * Report the water the camera is at to `site`, as a sea's probe does: the one it is in wins
 * over one it is only at; of those it is in, one with an edge (an `Ocean`'s, a `ZoneStack`'s)
 * over an endless sea, and else the first.
 *
 * @group Utils
 */
export function reportCameraWater(site: CameraSite, water: CameraWater): void {
  const now = site.water;
  if (
    !now ||
    (water.inside && !now.inside) ||
    (water.inside && now.endless && !water.endless)
  )
    site.water = water;
}

/**
 * Where the camera is in one scene (`sceneCameraSite`): the owners that know part of
 * it register a probe ({@link CameraSiteStore.probe}); what needs it asks
 * ({@link CameraSiteStore.get}), and the first to ask in a frame has the probes run, in
 * their order, for all. A new frame begins with {@link CameraSiteStore.tick} (the
 * `useCameraProbe` hook ticks after the camera's controls move it); without ticks, every
 * ask works it out again.
 *
 * @group Utils
 */
export class CameraSiteStore {
  private readonly probes: { probe: CameraProbe; order: number }[] = [];
  private frame = 0;
  private readonly sites = new Map<
    Camera,
    { frame: number; site: CameraSite }
  >();
  private working: CameraSite | null = null;

  /** Register `probe`, run at `order` ({@link CAMERA_PROBE_ORDER}). Returns its unregister. */
  probe(
    probe: CameraProbe,
    order: number = CAMERA_PROBE_ORDER.water,
  ): () => void {
    const entry = { probe, order };
    const at = this.probes.findIndex(p => p.order > order);
    if (at < 0) this.probes.push(entry);
    else this.probes.splice(at, 0, entry);
    this.tick();
    return () => {
      const i = this.probes.indexOf(entry);
      if (i >= 0) this.probes.splice(i, 1);
      this.tick();
    };
  }

  /** A new frame (or what the probes read changed): the next ask works the site out again. */
  tick(): void {
    this.frame++;
  }

  /**
   * Where `camera` is this frame. ⚠️ Shared: read it, do not keep it past the frame. A probe
   * asking gets the site being worked out.
   */
  get(camera: Camera): CameraSite {
    if (this.working) return this.working;
    let entry = this.sites.get(camera);
    if (entry && entry.frame === this.frame && this.frame > 0)
      return entry.site;
    if (!entry) {
      if (this.sites.size > 8) this.sites.clear();
      entry = { frame: -1, site: { position: new Vector3() } as CameraSite };
      this.sites.set(camera, entry);
    }
    const site = entry.site;
    emptySite(site, camera);
    camera.updateWorldMatrix(true, false);
    site.position.setFromMatrixPosition(camera.matrixWorld);
    this.working = site;
    try {
      for (const { probe } of this.probes) probe(site, camera);
    } finally {
      this.working = null;
    }
    entry.frame = this.frame;
    return site;
  }
}

const SCENE_SITES = new WeakMap<object, CameraSiteStore>();

/**
 * The camera site of a scene (one per scene, {@link CameraSiteStore}).
 *
 * @group Utils
 */
export function sceneCameraSite(scene: object): CameraSiteStore {
  let store = SCENE_SITES.get(scene);
  if (!store) {
    store = new CameraSiteStore();
    SCENE_SITES.set(scene, store);
  }
  return store;
}
