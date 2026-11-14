# Driving the camera

`CameraManager` (`sdk/managers/CameraManager.ts`) is the library's optional bridge to
whatever camera controls the host has installed. It owns no camera and installs
nothing: the host hands it a `CameraControls` instance and it drives that.

Everything it does is also reachable as a **DOM event**, which is how a component
that has no reference to the manager — a label, a story, a picked wellbore — asks for
a camera move.

| Event | Method | What it does |
| --- | --- | --- |
| `camera-set-position` | `setTarget` | pan so a point becomes the pivot, without changing distance or heading |
| `camera-focus-point` | — | keep the heading, fly closer to a point |
| `camera-look-at` | `lookAt` | state the whole pose: position and target |
| `camera-fly-to` | `flyTo` | travel the long way: retreat, swing, approach |

## Poses in degrees and metres

`orbit({ azimuth, polar, distance, target })` places the camera in spherical terms
around a pivot. Degrees and metres because that is the form a view can be **written
down and reproduced** — a position vector cannot be reasoned about at a glance, which
is what makes framing a view by hand a matter of trial and error. `pose()` reads the
current one back in the same form, so a view worth keeping can be pasted straight
into a story's `parameters` or into another `orbit` call.

Every term is optional and defaults to what the camera has now, so a pure dolly is
`orbit({ distance })` and a pure swing is `orbit({ azimuth })`.

`frame(box)` takes the other kind of instruction: *this must be visible*. The distance
comes from the box's bounding **sphere** against the camera's own fov and aspect, so
the whole box stays inside the frustum whichever way it is being looked at — and so
the answer is usable before the heading is known, which is what `flyTo` needs.
`frameDistance(box, padding)` exposes just that number.

`smoothTime` may be given per move. `CameraControls` eases exponentially, so it is a
time constant rather than a duration; the manager sets it for the leg and restores the
controls' own value afterwards.

## Flying the long way

`flyTo(plan)` runs three legs:

1. **retreat** — dolly out, holding the heading and the pivot;
2. **swing** — travel to the destination's heading and pivot *at that distance*;
3. **approach** — come in to the framed distance.

⭐⭐ Why not go straight there. The shortest path between two close-up views runs
**through** what is being looked at — inside the block, inside the well — and whatever
is being rebuilt on the way is rebuilt right in front of the lens. Retreating first
puts the change at arm's length and gives it the length of the pull-back to happen in.

⭐⭐ That is also why `destination` may be a **function**, and why it may return a
promise. The whole point of retreating is to do the disruptive part of the transition
while the camera is far away, so what is being flown to does not exist yet when the
flight starts. The caller is asked for it once the retreat is done, and may take as
long as it needs; returning `null` abandons the flight where it is.

```ts
dispatchEvent(
  new CameraFlyToEvent({
    retreat: { factor: 3 },
    smoothTime: { retreat: 0.8, swing: 1.2, approach: 0.8 },
    destination: async () => {
      setFenceWellbore(next);          // the old cut is already gone
      const fence = await awaitFence(next);
      if (!fence) return null;
      const pose = fenceViewPose(fence, { top, bottom, from });
      return { box: pose.box, azimuth: pose.azimuth, polar: pose.polar, padding: 1.6 };
    },
  }),
);
```

A second `flyTo` supersedes the first. That needs a token rather than a flag, because
`camera-controls` **resolves** an interrupted transition instead of rejecting it — so
without one the abandoned flight would wake up between legs and fight the new one for
the camera. Every leg checks the token; `cancel()` bumps it and stops the controls.

## Using it with the wellbore fence

The fence is the case this was built for, and it needs all three legs:

- the old cut is dropped as the **retreat** starts, so the block closes up while the
  camera is pulling away from it;
- the new wellbore is set once the camera is out, and the rebuild — a fetch, a
  ~300 ms build and a texture upload — happens during the **swing**;
- `fenceViewPose` (see [fence-curves.md](./fence-curves.md)) turns the finished fence
  into the `box`, `azimuth` and `polar` the **approach** lands on.

Two things the host has to get right:

- ⚠️ **Only one mover.** A second component reaching for the camera partway through
  hijacks the flight, and an `async` selection handler will do it late and
  unpredictably. The Storybook well map takes `parameters.wellMapCamera: false` for
  exactly this reason.
- ⚠️ **Pin the fence's side for the duration.** `side: 'auto'` follows the camera, and
  the swing crosses the cut — so the side the flight chose is held until it lands, and
  handed back to `auto` afterwards, which then agrees with it.

The demo is `Spikes/Chunks/FieldColumn` with `fence` on: its **Fly to** controls cover
the pull-back factor, the arrival padding (how much of the fence to take in), the
arrival polar angle and the easing.

## Where the camera is

Much of the scene changes with where the camera is: in the water or in air, in the ground
under the void's lid, inside a hollow's rim, its height over the sea. Each part used to work
its part of that out on its own, every frame. The **camera site** (`sdk/utils/camera-site.ts`)
works it out once a frame for everything that asks:

- `sceneCameraSite(scene)` (or `useCameraSite()` in a component) is the scene's one
  `CameraSiteStore`; `get(camera)` is where that camera is this frame, a `CameraSite`.
- What knows part of it registers a **probe** (`useCameraProbe(probe, order)`): a function
  writing what it knows into the site. The first to ask in a frame has every probe run, in
  their order (`CAMERA_PROBE_ORDER`), and all that ask after it read the same answer.
  The hook starts the site's frame after the camera's controls have moved the camera (at
  priority -0.5: drei's controls run at -1), so nothing reads last frame's camera.

| Field | Written by | Read by |
| --- | --- | --- |
| `ground` | the relief's tiles (`ground`): the relief's ground under the camera, on its triangles | the `Scenery`, a `SceneryStage` |
| `height`, `seaLevel`, `altitude` | a `Scenery` (`sky`) | the geographic layers (`layerShownAt`), a `SceneryStage` |
| `lid`, `buried`, `trench`, `hollow` | a `Scenery`: the void's lid over the camera in the ground, in rock above the seabed, in a trench, how far inside the hollow's rim | the `Scenery`'s own frame, the layers, a `SceneryStage` |
| `water` | each sea (`water`): an `Ocean`, a `ChunkStack`'s water, a `Scenery`'s sea (`reportCameraWater`: the one the camera is in, one with an edge over an endless one) | the seas' own water bodies (`WaterBody.cameraOver`) |
| `medium` | a `ChunkStack`'s `immersion` (`medium`): water or rock, to fade by | `useImmersionFog` |

Without a probe for a field it stays `null` and its readers fall back to working it out
(a layer with no `Scenery` takes its altitude from its own globe). A site is the store's
own: read it within the frame, do not keep it.

⚠️ A probe runs when something first asks, which may be inside another component's frame
callback or as a material renders: keep it cheap (a few lookups) and free of side effects
other than its own state, as an `Ocean` syncing its water to the camera.

### Over the water, exactly

An `Ocean`'s water is where its surface geometry lies in plan, whatever its outline:
`geometryFootprint(geometry)` (`sdk/geometries/geometry-footprint.ts`) keeps, per geometry,
an exact point test (`contains`, a grid of the triangles: a few tested per lookup). The camera
is tested with it on the CPU (`CameraWater.over`, to the shaders as `WaterBody.cameraOver`):
beside the water, in a notch or a hole of the outline, it is in air. What lies in the water is
told by the water's box alone (`waterBodyOver`): beside the water but in its box, it fades as
if in it. (A signed-distance texture of the outline told them apart until 2026-11; one cell off
on the outline, it left the seabed's rim unfaded, and nothing else needed it.)

Seen from the air, nothing here works out a sight line's part in the water: the sea's surface
and its walls carry the water in front of what lies in it, which is only dimmed. From in the
water, what is seen fades by the part of the line in the water, taken over the box
(`waterBodyPath`, `waterBodyLight`). Marching the outline per pixel was tried and dropped: a march over
an arbitrary outline trades exactness against its steps (lines running along the outline crawl;
a share-of-the-line step skips narrow strips).
