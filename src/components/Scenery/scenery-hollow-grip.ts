import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Camera,
  Group,
  LineBasicMaterial,
  LineLoop,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from 'three';
import type { Globe } from '../../sdk/projection/globe';
import { SceneryCutawayHandle } from './scenery-cutaway-handle';
import { sceneryHollowPointAt } from './scenery-hollow';

// Points round the ghost ring.
const GHOST_POINTS = 512;
// Where round the rim the grips stand: true east, north, west and south.
const GRIP_TURNS = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
// How far outside the cut the rim's ring runs, in drawing-buffer pixels: the cubes' centres
// (HOLLOW_SIMPLE_RIM).
const RING_PIXELS = 1.5;
// How large a grip is, in drawing-buffer pixels: its cube's side, a little wider than the ring
// (3 px, 4–5 with its soft edges).
const GRIP_PIXELS = 7;
// The cubes' faces' shades, as a diagram's: lit from above, the sides a little darker.
const TOP_SHADE = 0.93;
const SIDE_SHADES = [0.78, 0.62];

/** What a {@link SceneryHollowGrip} reports. */
export type SceneryHollowGripEvents = {
  /** let go with the ring at `radius` */
  drop: (radius: number) => void;
  /** a double click or tap */
  reset: () => void;
};

/**
 * The simple hollow's rim grips (SceneryHollow.handle): four tiny cubes centred on the rim's ring
 * at its true east, north, west and south, as large on screen from any distance, each under an
 * invisible element that takes the pointer. Dragging any drags the radius: a ghost ring at sea
 * level follows the pointer, the hollow itself left as it is until the drop. Add {@link object}
 * to the scene. Internal to `Scenery`.
 */
export class SceneryHollowGrip {
  /** the cubes and the ring drawn while dragging */
  readonly object = new Group();
  private readonly ghost: LineLoop<BufferGeometry, LineBasicMaterial>;
  private readonly cubes: Group[];
  private readonly cubeGeometry: BoxGeometry;
  private readonly cubeMaterial: MeshBasicMaterial;
  private readonly handles: SceneryCutawayHandle[];
  private dragged: number | null = null;
  private range: [number, number] = [0, Infinity];

  constructor(
    private readonly globe: Globe,
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: () => Camera,
    private readonly events: SceneryHollowGripEvents,
  ) {
    this.object.name = 'scenery-hollow-grips';
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(GHOST_POINTS * 3), 3),
    );
    this.ghost = new LineLoop(
      geometry,
      new LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.55,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.ghost.frustumCulled = false;
    this.ghost.visible = false;
    this.ghost.renderOrder = Number.MAX_SAFE_INTEGER;
    this.object.add(this.ghost);

    // A unit cube about its centre, its top lighter than its sides (local +y up).
    this.cubeGeometry = new BoxGeometry(1, 1, 1);
    const colors: number[] = [];
    const shades = [
      SIDE_SHADES[0],
      SIDE_SHADES[0],
      TOP_SHADE,
      SIDE_SHADES[1],
      SIDE_SHADES[1],
      SIDE_SHADES[1],
    ];
    for (const shade of shades)
      for (let v = 0; v < 4; v++) colors.push(shade, shade, shade);
    this.cubeGeometry.setAttribute(
      'color',
      new BufferAttribute(new Float32Array(colors), 3),
    );
    this.cubeMaterial = new MeshBasicMaterial({ vertexColors: true });
    this.cubes = GRIP_TURNS.map(() => {
      const cube = new Group();
      cube.matrixAutoUpdate = false;
      cube.visible = false;
      const faces = new Mesh(this.cubeGeometry, this.cubeMaterial);
      faces.frustumCulled = false;
      cube.add(faces);
      this.object.add(cube);
      return cube;
    });

    const parent = canvas.parentElement ?? document.body;
    this.handles = GRIP_TURNS.map(
      () =>
        new SceneryCutawayHandle(
          parent,
          {
            drag: (x, y) => {
              const radius = this.radiusAt(x, y);
              if (radius === null) return;
              this.dragged = Math.min(
                Math.max(radius, this.range[0]),
                this.range[1],
              );
              this.setGhost(this.dragged);
            },
            release: () => {
              this.ghost.visible = false;
              if (this.dragged === null) return;
              const radius = this.dragged;
              this.dragged = null;
              this.events.drop(radius);
            },
            reset: () => {
              this.dragged = null;
              this.ghost.visible = false;
              this.events.reset();
            },
          },
          { cursor: 'move' },
        ),
    );
  }

  /** any grip is being dragged */
  get active() {
    return this.handles.some(handle => handle.active);
  }

  /**
   * Once a frame: over the rim at `radius`, the radii it drags between `range`, `shown` (the
   * hollow open and seen from over the seabed) or hidden.
   */
  update(radius: number, range: [number, number], shown: boolean) {
    this.range = range;
    const camera = this.camera();
    camera.updateMatrixWorld();
    const box = this.canvas.getBoundingClientRect();
    const centre = sphereCentre(this.globe, scratchCentre);
    const fov = (camera as Camera & { fov?: number }).fov ?? 50;
    const tanHalf = Math.tan(((fov / 2) * Math.PI) / 180);
    this.handles.forEach((handle, i) => {
      const cube = this.cubes[i];
      const turn = GRIP_TURNS[i];
      const point = this.rimPoint(turn, radius, scratchA);
      const visible = shown && this.facing(point, camera, centre);
      cube.visible = visible;
      if (!visible) {
        if (!handle.active) handle.hide();
        return;
      }
      // Its frame on the ground: round the rim, up, and out of it.
      const up = this.globe.upAt(point, scratchB);
      const outer = this.rimPoint(turn, radius * 1.01, scratchC);
      const out = outer.sub(point);
      out.addScaledVector(up, -out.dot(up)).normalize();
      const along = scratchD.crossVectors(up, out).normalize();
      // As large on screen at any distance, larger held or under the pointer. In the drawing
      // buffer's pixels, as the ring is drawn (fwidth), so the two agree at any pixel ratio.
      const perPixel =
        (2 * tanHalf * camera.position.distanceTo(point)) /
        Math.max(this.canvas.height, 1);
      const held = handle.active || handle.hover ? 1.5 : 1;
      const side = GRIP_PIXELS * perPixel * held;
      cube.matrix
        .makeBasis(along, up, out)
        .scale(scratchE.setScalar(side))
        .setPosition(
          scratchF.copy(point).addScaledVector(out, RING_PIXELS * perPixel),
        );
      cube.matrixWorldNeedsUpdate = true;
      if (handle.active) return;
      // scratchF still holds the cube's centre.
      const ndc = scratchF.project(camera);
      if (Math.abs(ndc.z) >= 1 || Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1) {
        handle.hide();
        return;
      }
      handle.place(
        ((ndc.x + 1) / 2) * box.width,
        ((1 - ndc.y) / 2) * box.height,
        0,
      );
    });
  }

  dispose() {
    for (const handle of this.handles) handle.dispose();
    this.ghost.geometry.dispose();
    this.ghost.material.dispose();
    this.cubeGeometry.dispose();
    this.cubeMaterial.dispose();
  }

  // The rim at `radius` at `turn`, at the sea's level, in the world.
  private rimPoint(turn: number, radius: number, target: Vector3) {
    return sceneryHollowPointAt(this.globe, turn, radius, 0, target).add(
      this.globe.discCentre,
    );
  }

  // `point` at the sea's level faces `camera`: on the near side of the globe.
  private facing(point: Vector3, camera: Camera, centre: Vector3) {
    if (!this.globe.enabled) return true;
    scratchG.subVectors(point, centre);
    return scratchG.dot(scratchH.subVectors(camera.position, point)) > 0;
  }

  private setGhost(radius: number) {
    const positions = this.ghost.geometry.getAttribute(
      'position',
    ) as BufferAttribute;
    for (let k = 0; k < GHOST_POINTS; k++) {
      const point = this.rimPoint(
        (2 * Math.PI * k) / GHOST_POINTS,
        radius,
        scratchA,
      );
      positions.setXYZ(k, point.x, point.y, point.z);
    }
    positions.needsUpdate = true;
    this.ghost.visible = true;
  }

  // The radius whose rim lies under client point `x`, `y`: where the pointer's ray meets the
  // sea's level, along the sea from the disc's centre. Null where it meets none.
  private radiusAt(x: number, y: number): number | null {
    const camera = this.camera();
    const globe = this.globe;
    const box = this.canvas.getBoundingClientRect();
    const dir = scratchA
      .set(
        ((x - box.left) / box.width) * 2 - 1,
        1 - ((y - box.top) / box.height) * 2,
        0.5,
      )
      .unproject(camera)
      .sub(camera.position)
      .normalize();
    const origin = camera.position;
    const up = globe.up;
    if (!globe.enabled) {
      const above = scratchB.subVectors(origin, globe.discCentre).dot(up);
      const down = -dir.dot(up);
      if (above <= 0 || down <= 0) return null;
      const hit = scratchC
        .copy(origin)
        .addScaledVector(dir, above / down)
        .sub(globe.discCentre);
      hit.addScaledVector(up, -hit.dot(up));
      return hit.length();
    }
    const centre = sphereCentre(globe, scratchD);
    const R = globe.radius;
    const toOrigin = scratchB.subVectors(origin, centre);
    const b = toOrigin.dot(dir);
    const c = toOrigin.lengthSq() - R * R;
    const disc = b * b - c;
    if (disc < 0) return null;
    const root = Math.sqrt(disc);
    const t = c > 0 ? -b - root : -b + root;
    if (t <= 0) return null;
    const hit = scratchC.copy(origin).addScaledVector(dir, t).sub(centre);
    const angle = Math.atan2(
      scratchE.crossVectors(hit, up).length(),
      hit.dot(up),
    );
    return angle * R;
  }
}

// The globe's centre: `centreDepth` under the disc's centre.
function sphereCentre(globe: Globe, target: Vector3) {
  return target
    .copy(globe.discCentre)
    .addScaledVector(globe.up, -globe.centreDepth);
}

const scratchA = new Vector3();
const scratchB = new Vector3();
const scratchC = new Vector3();
const scratchD = new Vector3();
const scratchE = new Vector3();
const scratchF = new Vector3();
const scratchG = new Vector3();
const scratchH = new Vector3();
const scratchCentre = new Vector3();
