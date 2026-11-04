# Seamless zoom between a GeoMap and the 3D view (idea)

> **Status (2026-11-04): an idea, nothing of it built.** Saved to be picked up later; it gets a
> plan and a review of its own before anything is built. What exists today and what it would
> build on: [geo-map.md](./geo-map.md), [minimap.md](./minimap.md), [overlay.md](./overlay.md),
> [camera.md](./camera.md) (`setCameraPose`, `CameraRest` in `src/sdk/utils/camera.ts`).

- [The idea](#the-idea)
- [Why the two views can match](#why-the-two-views-can-match)
- [What it needs](#what-it-needs)
- [Keeping it cheap](#keeping-it-cheap)
- [How a host would put it together](#how-a-host-would-put-it-together)
- [Open questions](#open-questions)
- [Order of work](#order-of-work)

---

## The idea

A host app's main window shows a `GeoMap`, full size. Zooming in past a threshold hands over to
the R3F view **at the same place**: the map gives way to the 3D scene, seen from straight above
at the zoom the map had. Zooming the 3D view back out past the threshold hands back to the map.
To the user it is one zoom, from the whole Earth down to a wellbore and back.

## Why the two views can match

The handoff is seamless only if both views show the same picture at the moment they swap: the
3D camera looking straight down, and the map in the scene's own map.

- **Same parameters.** A `GeoMapView` is `{ center, extent, rotation }`: lon/lat in the middle,
  ground metres across the map's shorter side, radians clockwise from north to up. A camera
  looking straight down is fixed by the same three and a height:
  `h = extent / (2 · tan(fov / 2))`, with the fov across the shorter side (a
  `PerspectiveCamera`'s `fov` is vertical: in a portrait view, use the horizontal one). Its
  target is the map's middle on the ground, its heading the map's rotation.
- **Same projection.** With `projection="auto"`, the map draws in the scene's own map up to
  `globalFrom` (2000 km across): the same X/Z plane the 3D scene is laid out on, so at a
  handoff of tens of km the two agree in plan exactly. The globe's curvature drops the ground
  `d² / 2R`, about 50 m at 25 km out, which does not show from that height.
- **Same looks.** The relief's colours and shading are shared (`useReliefLooks`), and the map
  layers mirror the scene's from the same props ([layers.md, On a map](./layers.md)).

## What it needs

1. **Pose ↔ view, exactly** (sdk, pure functions): `geoMapViewToCameraPose(view, frame, fov,
   aspect, level)` and its inverse `cameraPoseToGeoMapView(...)`, on top of `geoFrameXZ` and
   `geoFrameLonLat`. A minimap's `autoZoomFactor` (4) only approximates this; the handoff needs
   it exact.
2. **A trigger on the map's side.** `onViewChange` is told only once a gesture has settled. A
   map event such as `onZoomLimit(view, pointer)` would be told when the user zooms in past
   `minExtent`, which the map already stops at, with where the pointer is: the handoff zooms
   about it.
3. **No tilt when handing back.** The camera's tilt limited by its height, as Google Earth does:
   the higher it goes toward the threshold, the less it may tilt, down to none at the
   threshold. The view flattens of itself as the user zooms out, and nothing moves the camera
   against the user: anything that changes the camera on its own waits for it to rest
   (`CameraRest`, `src/sdk/utils/camera.ts`) and eases what shows. A component in the `Canvas`
   tells the host once the camera rests above the threshold.
4. **A cross-fade** of 200–300 ms between the two, hiding what still differs: lighting,
   hillshade, labels, perspective. Optionally a dolly-zoom on the way to the threshold (the
   fov narrowed as the camera backs off, keeping the extent) so the 3D view is nearly
   orthographic when it swaps, for a near pixel match.
5. **Hysteresis**, as the `'auto'` projection has: into 3D below an extent E, back to the map
   only above about 1.25 · E, so a zoom hovering about the threshold does not flicker.

## Keeping it cheap

- **Both views stay mounted.** Unmounting the `Canvas` would make every swap cost seconds:
  shaders compiled again, tiles streamed again. Paused instead: `frameloop="never"` and the
  canvas hidden while the map shows. The map already draws nothing while it is off the page
  (`IntersectionObserver`). The view hidden costs memory, not frames.
- **The 3D view pre-warmed.** Once the map is within about 2× of the threshold, the hidden
  camera is set to the pose the handoff would give and the scene advanced now and then
  (R3F's `advance`), so its relief tiles have streamed in by the time it shows.

## How a host would put it together

The `GeoMap` and the `Canvas` are siblings in the host's page: no context bridge is needed. The
host holds which view shows and where; the map's view is controlled, and a component in the
`Canvas` sets the camera (`setCameraPose`) and says when to hand back. Building blocks first, in
the spirit of the `Overlay` ([overlay.md](./overlay.md)); a ready-made switch can come later.

```tsx
const [mode, setMode] = useState<'map' | '3d'>('map');
const [view, setView] = useState<GeoMapView>(start);

<div style={{ position: 'relative', width: '100%', height: '100%' }}>
  <GeoMap
    layers={reliefLayers}
    view={view}
    onViewChange={setView}
    minExtent={HANDOFF_EXTENT}
    onZoomLimit={next => {           // to be built
      setView(next);
      setMode('3d');
    }}
    style={{ opacity: mode === 'map' ? 1 : 0, transition: 'opacity 0.25s' }}
  />
  <Canvas frameloop={mode === '3d' ? 'always' : 'never'} style={{ opacity: mode === '3d' ? 1 : 0 }}>
    <World frame={frame}>
      {/* … the scene … */}
      <MapHandoff                    // to be built
        view={view}
        active={mode === '3d'}
        handBackAbove={HANDOFF_EXTENT * 1.25}
        onHandBack={next => {
          setView(next);
          setMode('map');
        }}
      />
    </World>
  </Canvas>
</div>
```

## Open questions

- **The `World`'s frame.** The 3D scene is laid out about its `World`'s frame. Zooming in on a
  place 500 km from it means large scene coordinates and a curved globe. Either the handoff is
  allowed only within some distance of the frame, or the `World` is re-anchored there at the
  swap: safe, since the 3D view is hidden then, but it rebuilds the tiles. The biggest choice.
- **Gesture continuity.** Zoom momentum left at the swap mid-gesture is lost. Both sides can
  zoom about the pointer (`CameraControls`' `dollyToCursor`).
- **Left-drag.** It pans the map and orbits the 3D view. Near top-down, the 3D controls could
  pan with it instead, so a drag does the same thing either side of the swap.
- **A ready-made component.** Building blocks first; whether to ship a `GeoMapHandoff` that does
  all of it for a host, and how much of the host's layout it would assume.

## Order of work

1. Pose ↔ view functions, with unit tests round-tripping them at several extents, rotations and
   aspects.
2. `onZoomLimit` on the `GeoMap`.
3. The camera's tilt limited by its height, and the hand-back trigger in the `Canvas`.
4. A story: a full-window map handing over to a `Scenery` and back, with the cross-fade.
5. Pre-warming, then the dolly-zoom if the cross-fade alone does not hide the difference.
6. The `World`'s frame: re-anchoring at the swap, if wanted.
