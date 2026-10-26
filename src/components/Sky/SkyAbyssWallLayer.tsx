import {
  MutableRefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import {
  BufferGeometry,
  Camera,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  PlaneGeometry,
  Vector2,
  Vector3,
  Vector4,
} from 'three';
import {
  createSkyAbyssWallFillMaterial,
  createSkyAbyssWallGeometry,
  createSkyAbyssWallMaterial,
  SKY_ABYSS_WALL_UNCUT,
  skyAbyssWallReach,
} from './sky-abyss-walls';
import type { SkyMaterial } from './sky-material';

// The cut plane's grid lines across and down.
const CUT_GRID = [16, 8];
const CUT_COLOR = '#4fd8ff';

// Lines over x -1 to 1 and y -1 to 0, placed on the cut plane each frame (cutPlaneFrame).
function createCutGrid() {
  const [across, down] = CUT_GRID;
  const points: number[] = [];
  for (let i = 0; i <= across; i++) {
    const x = -1 + (2 * i) / across;
    points.push(x, 0, 0, x, -1, 0);
  }
  for (let j = 0; j <= down; j++)
    points.push(-1, -j / down, 0, 1, -j / down, 0);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(points, 3));
  return geometry;
}

const across = new Vector3();
const normal = new Vector3();
const centre = new Vector3();
const size = new Vector3();

// How far out from the stage's centre the walls' rock can reach, at the mesh's foot.
function wallReach(sky: SkyMaterial) {
  const u = sky.uniforms;
  const box = u.uSkyStageBox.value as Vector4;
  const walls = u.uSkyAbyssWalls.value as Vector4;
  const shape = u.uSkyAbyssWallShape.value as Vector4;
  const depth = (u.uSkyAbyssWallGrid.value as Vector3).z;
  return skyAbyssWallReach(
    [box.z, box.w],
    walls.x,
    shape.y,
    depth,
    shape.w,
    shape.x,
  );
}

// The stage's centre at the lid (world).
function stageCentre(sky: SkyMaterial, target: Vector3) {
  const u = sky.uniforms;
  const box = u.uSkyStageBox.value as Vector4;
  return target
    .copy(u.uSkyEast.value as Vector3)
    .multiplyScalar(box.x)
    .addScaledVector(u.uSkyNorth.value as Vector3, -box.y)
    .addScaledVector(sky.up, sky.abyssLevel);
}

// x -1 to 1 across the plane the walls are cut along and y -1 to 0 from the lid down to the
// mesh's foot, about the stage's centre, as wide as the hollow can be.
function cutPlaneFrame(sky: SkyMaterial, target: Matrix4) {
  const u = sky.uniforms;
  const clip = u.uSkyAbyssWallClip.value as Vector4;
  const depth = (u.uSkyAbyssWallGrid.value as Vector3).z;
  normal.set(clip.x, clip.y, clip.z);
  across.crossVectors(sky.up, normal).normalize();
  stageCentre(sky, centre);
  centre.addScaledVector(normal, clip.w - normal.dot(centre));
  return target
    .makeBasis(across, sky.up, normal)
    .scale(size.set(wallReach(sky), depth, 1))
    .setPosition(centre);
}

// x and y -1 to 1 over the lid, east and north, about the stage's centre.
function lidFrame(sky: SkyMaterial, target: Matrix4) {
  const u = sky.uniforms;
  const reach = wallReach(sky);
  return target
    .makeBasis(
      u.uSkyEast.value as Vector3,
      u.uSkyNorth.value as Vector3,
      sky.up,
    )
    .scale(size.set(reach, reach, 1))
    .setPosition(stageCentre(sky, centre));
}

// A quad over x -1 to 1 and y -1 to 0, as the cut plane's frame lays it.
function createCutQuad() {
  return new PlaneGeometry(2, 1).translate(0, -0.5, 0);
}

/**
 * The walls' layer's work each frame, which the {@link Sky} runs once it has cut them:
 * `fromAbove` while the void can show from above the lid (`SkyMaterial.abyssOpenFromAbove`).
 */
export type SkyAbyssWallFrame = (camera: Camera, fromAbove: boolean) => void;

type SkyAbyssWallLayerProps = {
  sky: SkyMaterial;
  renderOrder: number;
  visible: boolean;
  /** given this layer's work each frame, for the sky to run after the walls' cut (`clipAbyssWalls`) */
  frame: MutableRefObject<SkyAbyssWallFrame | null>;
  /** its triangles drawn as lines, in one colour */
  wireframe?: boolean;
  /** shaded without the rock's relief, as the mesh faces; its cut faces drawn as geometry */
  flat?: boolean;
  /** the plane they are cut along, as a grid over everything */
  cut?: boolean;
};

/**
 * The void's walls' faces as a mesh (see `SkyAbyssWalls`): one fixed grid round their
 * outline and down from the lid, as many columns as the sky's grid has
 * (`uSkyAbyssWallGrid`). Drawn from below the lid, and from above it while the void can
 * show there; under an opaque seabed beyond the stage the background's seabed hides it
 * (skyAbyssWallCovered), over the stage the stage's own. The background draws their fill
 * and what lies beyond them. Its work each frame is run by the sky once it has cut them
 * (`frame`), so the camera's matrices are updated and the cut made once a frame.
 */
export const SkyAbyssWallLayer = ({
  sky,
  renderOrder,
  visible,
  frame,
  wireframe = false,
  flat = false,
  cut = false,
}: SkyAbyssWallLayerProps) => {
  const geometry = useMemo(createSkyAbyssWallGeometry, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const material = useMemo(() => createSkyAbyssWallMaterial(sky), [sky]);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => {
    material.wireframe = wireframe;
    (material.uniforms.uSkyAbyssWallDebug.value as Vector2).set(
      wireframe ? 1 : 0,
      flat ? 1 : 0,
    );
  }, [material, wireframe, flat]);
  const mesh = useRef<Mesh>(null);
  const cutGrid = useMemo(() => (cut ? createCutGrid() : null), [cut]);
  useEffect(() => () => cutGrid?.dispose(), [cutGrid]);
  const cutMaterial = useMemo(
    () =>
      cut
        ? new LineBasicMaterial({
            color: CUT_COLOR,
            transparent: true,
            depthTest: false,
            depthWrite: false,
            toneMapped: false,
          })
        : null,
    [cut],
  );
  useEffect(() => () => cutMaterial?.dispose(), [cutMaterial]);
  const cutLines = useRef<LineSegments>(null);
  // The cut's faces as geometry: on the cut plane, and on the lid from above.
  const fills = useMemo(
    () =>
      flat
        ? {
            quad: createCutQuad(),
            lid: new PlaneGeometry(2, 2),
            cutMaterial: createSkyAbyssWallFillMaterial(sky, false),
            lidMaterial: createSkyAbyssWallFillMaterial(sky, true),
          }
        : null,
    [flat, sky],
  );
  useEffect(
    () => () => {
      if (!fills) return;
      fills.quad.dispose();
      fills.lid.dispose();
      fills.cutMaterial.dispose();
      fills.lidMaterial.dispose();
    },
    [fills],
  );
  const cutFill = useRef<Mesh>(null);
  const lidFill = useRef<Mesh>(null);

  // Rebuilt each render, so it reads this render's props; run by the sky after the cut.
  useLayoutEffect(() => {
    frame.current = (camera, fromAbove) => {
      const m = mesh.current;
      if (!m) return;
      const height = sky.heightOf(camera.position) - sky.abyssLevel;
      const shown = visible && sky.abyssWallRock !== null;
      m.visible = shown && (height < 0 || fromAbove);
      const clip = sky.uniforms.uSkyAbyssWallClip.value as Vector4;
      const cuts = clip.w > SKY_ABYSS_WALL_UNCUT / 2;
      const lines = cutLines.current;
      if (lines) lines.visible = shown && cuts;
      // The cut's face looks back at what it cuts away: seen only from that side.
      const facing =
        clip.w >
        clip.x * camera.position.x +
          clip.y * camera.position.y +
          clip.z * camera.position.z;
      if (cutFill.current)
        cutFill.current.visible = m.visible && cuts && facing;
      if (lidFill.current) lidFill.current.visible = m.visible && height > 0;
      for (const object of [lines, cutFill.current]) {
        if (!object?.visible) continue;
        cutPlaneFrame(sky, object.matrix);
        object.matrixWorldNeedsUpdate = true;
      }
      if (lidFill.current?.visible) {
        lidFrame(sky, lidFill.current.matrix);
        lidFill.current.matrixWorldNeedsUpdate = true;
      }
      const grid = sky.uniforms.uSkyAbyssWallGrid.value as Vector3;
      geometry.setDrawRange(0, 6 * grid.x * grid.y);
    };
    return () => {
      frame.current = null;
    };
  });

  return (
    <>
      <mesh
        ref={mesh}
        name="sky:abyss-walls"
        geometry={geometry}
        material={material}
        frustumCulled={false}
        renderOrder={renderOrder}
      />
      {fills && (
        <>
          <mesh
            ref={cutFill}
            geometry={fills.quad}
            material={fills.cutMaterial}
            matrixAutoUpdate={false}
            frustumCulled={false}
            renderOrder={renderOrder}
          />
          <mesh
            ref={lidFill}
            geometry={fills.lid}
            material={fills.lidMaterial}
            matrixAutoUpdate={false}
            frustumCulled={false}
            renderOrder={renderOrder}
          />
        </>
      )}
      {cutGrid && cutMaterial && (
        <lineSegments
          ref={cutLines}
          geometry={cutGrid}
          material={cutMaterial}
          matrixAutoUpdate={false}
          frustumCulled={false}
          renderOrder={renderOrder + 3}
        />
      )}
    </>
  );
};
