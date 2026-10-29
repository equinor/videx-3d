# Minimap: an inlet map of the relief that follows the camera

`Minimap` is a small panel over the canvas, drawn top-down from the same relief data as a
`SceneryStage`'s `relief` (see [relief.md](./relief.md)): shaded by the ground's slope or as an
outline, centred on the camera, zoomed by level or by the camera's height, and carrying layers
of your own. It is an HTML overlay like `Panel` and `RenderStats`, and costs no frame of the 3D
view's: it draws on a canvas and a WebGL context of its own, only when the view changes.

```tsx
<World frame={geoFrameFromCrs(crs)}>
  <GeneratorsProvider registry={registry /* with the sceneryRelief generator */}>
    <Canvas>
      <Minimap
        layers={[
          { id: 'etopo-2022-nordic' },
          { id: 'emodnet-2020-volve', feather: 500 },
        ]}
        origin="bottom-right"
        width={240}
        height={240}
      >
        <MinimapCameraMarker />
        <MinimapPoints points={[{ at: [0, 0], label: 'Volve' }]} />
      </Minimap>
    </Canvas>
  </GeneratorsProvider>
</World>
```

## What it shows

- **Data**: its own `layers` (ids coarse to fine, `feather` as the stage's), read by the
  `sceneryRelief` generator, which resamples each layer onto longitude and latitude, its
  coverage faded in over its feather, at most `maxSize` (default 2048) texels a side. The
  fragment shader (`minimap-fragment.glsl`) merges them exactly as the stage's overview does
  (`relief.glsl`, `h = mix(h, layer, weight)` over the layers), from the same
  `SceneryReliefLooks` (`color`, `contours`, `layerLooks`, with the same shapes as a
  `SceneryStage`'s relief; default the terrain ramp over the bathymetry ramp). Where no layer
  has data it is transparent, so the panel's `background` shows.
- **`mode="shaded"`** (default): colour by height, lit from the upper left of the screen by
  the slope, which the four neighbouring pixels give (`shading.exaggeration` 2,
  `shading.strength` 0.8). **`"outline"`**: the coast (where the height crosses the sea's
  level, one pixel wide), the contours if the look has them, over a faint land fill
  (`outline`).
- **Projected**: the map is the scene's own, a flat similarity of scene X/Z, so a layer's
  `[x, z]` lands on it without the globe. Grid north is up in `north-up`; in `heading-up`
  the camera's heading is. The compass turns with the map, and a click on it toggles the
  two (`orientation`, or `defaultOrientation` and `onOrientationChange`).
  Longitude and latitude are known per vertex of an 8 x 8 grid (`geoFrameLonLat`, in 64-bit
  floats, relative to the middle so the shader's pixel steps keep their precision), and the
  shader interpolates between them. Globe mode is not done.
- **Centred** on the camera, or on its **target** (`center`, `defaultCenter`,
  `onCenterChange`; the button showing the marker it is centred on toggles it): what the
  camera looks at, on the sea's level. That is the controls' target (R3F's `state.controls`:
  `getTarget` on drei's `CameraControls`, `target` on `OrbitControls`) with its height dropped
  to the sea, so only its X/Z counts; without controls, where the view ray meets the sea
  (`rayAtSeaLevel`; the camera's own X/Z for a view that looks up or level). The camera's
  arrow is then off the middle, and the target's marker in it.

## Zoom

`zooms` are the host's own extents in metres across the map's shorter side, ascending: any
list, with the default (1, 5, 25, 100 and 1000 km) only when none is given.

- **`zoom="auto"`** (the default): the extent follows the camera's height over the sea
  (`level`, the sea's Y): `autoZoomFactor` (4) times the height, between the least and the
  most of `zooms`, eased in log space over `autoZoomSmoothing` seconds. At 2.5 km up the map
  is 10 km across; from 250 km up, the most the list has (1000 km by default).
- **a number**: an index into `zooms`. The + / − buttons and the wheel (`wheelZoom`) step
  one level from the map's own (from the adaptive extent when auto) and A returns to auto.
- Controlled with `zoom` and `onZoomChange`, or uncontrolled with `defaultZoom`.
- **The scale**: along the bottom, the map's extent at the left, and at the right a bar of a
  round length (1, 2 or 5 times a power of ten, about a quarter of the width and at least 72
  pixels: `niceScaleLength`) with its length inside it.

## Position and size

`origin` and `offset` anchor it to a corner as a `Panel` does (`cornerStyle`, shared by
`Panel`, `RenderStats` and `Minimap`); `width`, `height`, `background`, `borderRadius` and
`opacity` are props: it is resized by changing them (the canvas resizes without rebuilding
anything). It is appended to the `Canvas`'s parent, or to `parent`.

`controls` says which buttons to show, in which order: `true` (all of `MINIMAP_CONTROLS`),
`false`, or a list of `'zoom-in'`, `'zoom-out'`, `'zoom-auto'` and `'center'`. The ids are
fixed for now; custom buttons would be more ids. `compass` shows or hides the compass.

## Layers of your own

Children are drawn in an SVG over the relief, in the minimap's pixels, in a React root of
their own: so they do not see the contexts the `Canvas` provides. The camera moves every frame,
so layers are not re-rendered: they subscribe and move their SVG through refs.

- `MinimapCameraMarker`: the camera's arrow (`color`, default white), turning with its
  heading, with a `shape` round it in its own colour (`shapeColor`, default white): `'cone'`
  (its horizontal field of view), `'circle'` or `'none'`. `radius` is the cone's reach or the
  circle's radius: a number is metres on the ground, `{ fraction }` a share of the map's
  extent, which keeps its size at every zoom (default `{ fraction: 0.45 }`).
- `MinimapTargetMarker`: what the camera looks at (`color`, default white).
- `MinimapPoints`, `MinimapPolyline`: ready-made, from scene X/Z.
- `MinimapLayer`: a `<g>` handed to `onFrame(group, state)` as the minimap changes.
- `useMinimapFrame(callback)` and `useMinimap()` (`project`, `unproject`) for your own.

```tsx
const Marker = ({ at }: { at: [number, number] }) => {
  const dot = useRef<SVGCircleElement>(null);
  const { project } = useMinimap();
  useMinimapFrame(() => {
    const [x, y] = project(at[0], at[1]);
    dot.current?.setAttribute('transform', `translate(${x} ${y})`);
  });
  return <circle ref={dot} r={4} fill="red" />;
};
```

## Moving the camera from the map

The camera's arrow and the target marker can be dragged and dropped on the map to move the
scene's controls (R3F's `state.controls`; `draggable` on each marker, `dragControls` on the
`Minimap`):

- **Drop the camera's arrow**: the camera flies there and takes its target along, so the view
  is the same from the new place (`setLookAt` on a drei `CameraControls`, with its transition;
  an `OrbitControls` is set directly).
- **Drop the target marker**: the camera stays and looks at the new place (the controls'
  target moves).
- **Heights are kept**: only X/Z change, for the camera and the target alike. Moving the target
  to the sea's level instead would swing the view for a horizontal drag, and be wrong over
  land. So a camera dropped over a mountain keeps its altitude and can end up inside it.
- **Cancel** by dropping outside the map, or pressing Escape: the marker waits dimmed at the
  map's edge while the pointer is outside, and goes back. Nothing moves, and `onMarkerDrop` is
  not called.
- **Grabbing**: a marker is grabbed within 12 pixels of its centre, no further than half way to
  the other marker, so the two never cover each other: a target close to the camera's arrow is
  grabbed by pointing at it (down to 5 pixels each; two markers on the very same pixel cannot
  be told apart, and the one drawn last is taken).
- While a marker is dragged the map is held still under it, then follows the camera again. A
  dropped marker stays where it was dropped while the camera flies there. The marker you drop
  ends up where you dropped it: if the map is centred on it, the map then re-centres.
  The pose a drop asks for is `dropMarkerOn` (sdk), on the map's surface: flat, or the globe's.
- Without controls there is nothing to move, and the markers cannot be dragged. With
  `dragControls={false}` a drop is only reported, `onMarkerDrop(kind, [x, z])`, for a host with
  controls of its own to act on; it is reported after the controls move otherwise.

## Altitude: the readout and the control

The **readout** (`altitude`, on by default) is the height over the sea of what the map is
centred on, top centre: the camera's on a camera-centred map, its target's on a target-centred
one. Plain text like the extent, with the marker it belongs to; a display only.

The **altitude control** (`altitudeControl`, on by default; `false` leaves it out) is a slim
vertical control fixed on the map, on its left edge, that changes that height. It is a
hairline groove with a mark at each end and in the middle, and a round knob.

- **Pull the knob up to climb, down to descend.** The knob sets the climb **speed directly**, in
  metres a second, the same at any height: nothing within a 4 px dead zone, then with the square
  of how far the knob is from the middle, so a small pull is a fine one, up to
  `altitudeControl.maxSpeed` (default 100 m/s) at the end of the groove
  (`altitudeControl.dragRange` pixels each way, default 100; a short map shortens it)
  (`altitudeRate`). A faint fill from the middle to the knob shows the pull, stronger the harder
  it is.
- **Only at the end of the groove does it accelerate.** Held at the end in one direction, the
  speed doubles every `altitudeControl.boostTime` seconds (default 1), up to `boost` times
  `maxSpeed` (default 200, about 20 km/s) (`boostFactor`). Pull the knob back from the end, or
  the other way, and it is the direct speed again at once. `boost: 1` has no acceleration.
- **Let go and it springs back** to the middle, and the height stays where it got to. Escape
  puts the height back to what it was when the knob was taken. Pressing on the knob holds it
  where it was grabbed; pressing the groove brings the knob to the pointer.
- **The range** is `altitudeControl.min` to `altitudeControl.max` (default −5 km to +50 km, so
  the seabed has its share). A height already outside it can move back, and no farther out
  (`moveAltitude`). `altitudeControl.color` colours it (default white).
- **The camera takes its target along**, by the same move, straight up or down where it is
  (along the globe's up far out), so it looks the same way at the same angle from the new
  height; its target alone leaves the camera (`setMarkerHeight`). It uses
  the same controls as dropping a marker (`dragControls`), and is dimmed and inert without them.
  The adaptive zoom follows the camera's height.

All the labels (the readout, the extent, the distance) share one look: sharp white text with a
hard one-pixel outline.

## Home, and panning the map

- **Double-click the marker button** (the camera / target toggle) to fly the camera and its
  target back to the **home** pose: `home` (`{ position, target }`), or else the pose the
  controls had at the first frame. Zoom, orientation and centre are kept: the two clicks
  toggle the centre twice. It needs controls, like a drop.
- **Right mouse button** over the map pans it (`pan`, on by default), the map following the
  pointer; on release it eases back to its centre. Only the map moves, not the camera: a press
  on the map never reaches the scene's controls (R3F's event source is the canvas's parent,
  which the map sits in, so the map stops it there). The browser's context menu is off over the
  map while `pan` is on.

## Layout

`layout` places the six items: `compass`, `altitude` (the readout), `altitudeControl`,
`controls`, `extent` (the ground across the map) and `distance` (the bar). Each takes
`{ anchor, direction, order }`: where it sits (a corner, or the middle of an edge: `'top-center'`,
`'bottom-center'`, `'left-center'`, `'right-center'`), how the buttons flow (a row or a column)
and, among the items at one anchor, its `order`, the lowest nearest the edge. Items at an anchor
stack, so they do not overlap. The defaults: the compass top left, the altitude readout top
centre, the altitude control on the left edge, the buttons top right, the extent bottom left,
the distance bottom right. `resolveMinimapLayout` is the pure part. `compass`, `controls` (a
list of buttons), `altitude` and `altitudeControl` say which are shown. The altitude control is
vertical wherever it sits.

## Costs and limits

- A WebGL context of its own, so the layers' maps are held on the GPU twice (the stage's
  overview holds its own): the demo's five layers are about 31 MB with their mips, as the
  overview's (`maxSize` only trims a layer larger than it: lower it for less). Browsers limit
  contexts, so it is given back (`forceContextLoss`) on unmount. A new context is made only
  for new layers (or a new look table); a new `base` is set on the one there is.
- The colour ramps and the looks are the scene's textures, drawn from textures of the
  minimap's own that share their data: three keeps every renderer a texture was uploaded to
  alive through a listener on that texture, so sharing the scene's own would keep each
  disposed minimap renderer alive. A change to them (`color`, `contours`, `layerLooks`, a
  ramp registered) redraws the map.
- At most six layers (`SCENERY_RELIEF_FAR_MAX_LAYERS`), as the overview's.
- Heights are RG half floats: above 2000 m the shading steps by a metre or two. A layer
  coarser than the pixel shows its cells (bilinear, so its shading is blocky). They are
  interpolated in the shader from four fetches (`RELIEF_EXACT` in `relief.glsl`), not by the
  GPU's filter, whose 8 bits of sub-texel weight read a map many pixels to a texel as a
  staircase that the shading shows as stripes; the stage keeps the GPU's.
- A pixel's neighbours are sampled for the slope, so the fragment shader merges the layers five
  times. It runs only when the view moves a quarter pixel, or its scale, turn, size or style
  change.
- Heights over the sea (the readout, `'auto'`, the altitude control) and the camera's and
  target's places on the map are the globe's under a `Scenery` (the `World`'s globe,
  `globeMapSurface`): far from the field the sea curves below Y = 0, and the map's point under
  the camera is its foot on the globe, not its scene X/Z. A dropped marker keeps its height
  over the sea there. Without a `Scenery`, the plane Y = `level` (`flatMapSurface`). Without
  controls, the target is where the view ray meets the plane Y = `level`.
- Not done: globe mode, resizing by dragging, custom buttons, and a mode switch among the controls.
- Longitudes across the 180th meridian are handled only for a layer that wraps.

Story: `Components/Html/Minimap` (`src/components/Html/Minimap/Minimap.stories.tsx`). The
stories with a `Scenery` (`Components/Misc/Scenery`, `Components/Layers/Tracks`, the
`Spikes/Scenery` ones and `Spikes/Chunks/FieldColumn`) have a `minimap` switch, off by default:
`SceneryArgsMinimap` (`src/storybook/components/scenery-features.tsx`), the minimap's defaults
and a camera marker over the ticked demo reliefs, in the story's map and at its sea's level.
