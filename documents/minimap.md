# Minimap: an inlet map of the relief that follows the camera

`Minimap` is a small panel over the canvas, drawn top-down from the same relief tiles as a
`SceneryStage`'s `relief` (see [relief.md](./relief.md) and [tiles.md](./tiles.md)): shaded by
the ground's slope or as an outline, centred on the camera, zoomed by level or by the camera's
height, and carrying layers of your own. It is an HTML overlay like `Panel` and `RenderStats`,
and costs no frame of the 3D view's: it draws on a canvas and a WebGL context of its own, only
when the view changes or tiles come in. However many layers the relief has, and however large
they are, only the tiles the map shows are read, at the detail it shows them at.

```tsx
<World frame={geoFrameFromCrs(crs)}>
  <GeneratorsProvider registry={registry /* with the sceneryReliefTile generator */}>
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

- **Data**: its own `layers` (ids coarse to fine, `feather` as the stage's) and `base`, merged
  onto the relief's geographic tiles by the `sceneryReliefTile` generator (`buildGeoReliefTile`)
  exactly as the stage's tiles are. The map chooses the tiles it shows (`selectGeoMapTiles`):
  over what it shows, down to the depth whose cells, on average at its latitude, span at most
  `cellPixels` device pixels (default 2; `geoTileDepthFor`) — no finer than half its slots
  hold (`geoTileCountOver`) — or one level past a tile with no finer data under it (a leaf's
  cells may be a third coarser than its data: `pastLeaf`). A tile is gone into only once it is
  in, so the map fills in from the roots, coarse to fine, and where a tile is not in yet its
  nearest ancestor that is stands in. The tiles' heights, normals and the layer each node came
  from are kept in texture arrays of the minimap's own (`SceneryReliefTileTextures`, up to 512
  slots), and the fragment shader (`minimap-fragment.glsl`) reads the ground per
  pixel through an index of the tiles drawn (`relief-atlas.glsl`, `SceneryReliefAtlas`, about
  the view's middle so it keeps its precision at metre-sized cells), bilinear between their
  nodes, looked from the same `SceneryReliefLooks` (`color`, `contours`, `layerLooks`, with the
  same shapes as a `SceneryStage`'s relief; default the terrain ramp over the bathymetry ramp)
  by the layer that gave the nearest node. Where no layer has data (the tiles' base) it is
  transparent, so the panel's `background` shows.
- **`mode="shaded"`** (default): colour by height, lit from the upper left of the screen by
  the slope, from the tiles' normals filtered between their nodes as the stage shades them
  (`shading.exaggeration` 2,
  `shading.strength` 0.8). **`"outline"`**: the coast (where the height crosses the sea's
  level, one pixel wide), the contours if the look has them, over a faint land fill
  (`outline`).
- **Projected**: by default the map is the scene's own, a flat similarity of scene X/Z, so a
  layer's `[x, z]` lands on it without the globe; or a projection of the whole world (see
  [Projection](#projection)). Grid north (true north in a projection) is up in `north-up`;
  in `heading-up` the camera's heading is. The compass turns with the map, and a click on
  it toggles the two (`orientation`, or `defaultOrientation` and `onOrientationChange`).
  Longitude and latitude are known per vertex of an 8 x 8 grid (32 x 32 in a projection;
  `geoFrameLonLat`, in 64-bit floats, relative to the middle so the shader's pixel steps
  keep their precision), and the shader interpolates between them.
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

## Projection

`projection` is what the map is drawn in:

| | |
|--|--|
| `'scene'` | the scene's own map: the `frame`'s projection, a transverse Mercator such as UTM. What the 3D view shows; true to scale for a few hundred kilometres about it, and ever more distorted past that. Meant for regional views: past 500 km across it is drawn on a finer grid, and where the map stops holding — a point does not come back through it, or a cell spans its far meridian or a pole — it is left out, the panel's background showing, rather than smeared. For wider views use `'auto'` or a global projection. |
| `'web-mercator'` | conformal: shapes and bearings hold, but areas grow toward the poles (twice as wide at 60°) and it ends at 85.05°. |
| `'equal-earth'` | equal-area: the whole world, every region its true size against the others; shapes squeezed toward the poles, which are lines on its rounded outline. |
| `'lambert-conformal-conic'` | conformal, and nearly true to scale between its two standard parallels: a region wider east–west than north–south at middle latitudes (a continent, an ocean basin). Its parallels follow the view — a sixth of the map in from its top and bottom (`lambertParallelsFor`) — unless fixed with `lambertParallels` (`[35, 65]` for Europe as EPSG:3034, say); its origin is the middle's parallel. It holds the half of the Earth about the map's meridian, to 10° short of the far pole; parallels either side of the equator give Mercator. |
| `'auto'` (default) | the scene's map up to `globalFrom` (default 2000 km across), `globalProjection` (default `'web-mercator'`) past it, and back below 80 % of it. |

- **About the middle.** A projection's plane (`mapPlane`, `sdk/projection/map-projections.ts`)
  is centred on the meridian under the map's middle, so the antimeridian is its edge, never a
  seam across it. The view (`projectMapView`) keeps its middle, its ground metres a pixel at
  the middle (the scale bar is true there; in Web Mercator not toward the poles), and its way
  up carried into the plane.
- **Overlays need nothing.** `mapViewToPixel` and `mapViewFromPixel` still take and give scene
  X/Z, through the frame (`geoFrameLonLat`, `geoFrameXZ`) and the projection, so markers,
  layers, dragging and panning work in any. A `MinimapPolyline`'s or `MinimapGeoLayer`'s long
  segments are bent through points between (`mapViewBetween`), as straight lines in the
  scene's map are curves in a projection's.
- **Drawn per pixel.** The grid's vertices carry their longitude and latitude, and their point
  of the plane, from which the fragment shader masks off what lies past the projection's
  outline, anti-aliased (`minimapOnMap`). Past 100 m a device pixel the longitude and
  latitude are worked out per pixel from the plane (`minimapLonLat`, each projection's
  inverse in GLSL): a grid cell straddling the antimeridian — a cone's wedge, Equal Earth's
  edge — interpolated them across ±180° into a smear. Closer in, the grid's are more
  precise in 32 bits, and a close view never reaches the edge. Tiles are chosen by each one's own scale
  (`selectGeoMapTiles`'s `depthAt`): Web Mercator toward the poles, where a pixel spans less
  ground, gets finer ones.
- **A change cross-fades** over `MINIMAP_PROJECTION_FADE` (0.3 s): both views are drawn, about
  the same middle and from the same tiles, added premultiplied (`1 - t` and `t`, eased).
  The overlays move to the new one at once.
- **The zone's bounds.** In the scene's map a dashed outline marks the zone it is laid out
  for: by default the `frame`'s UTM zone (`geoFrameUtmZone`, `utmZoneBounds`: its 6° of
  longitude, from the equator to 84°N or from 80°S), carried through the map every 0.25° so
  its meridians bend and close in toward the pole as they lie in it. Give `zoneBounds`
  (`[west, south, east, north]`, degrees) for a frame in another map, `false` for none;
  `zoneColor` colours it. It is hidden in a projection.
- **Limits**: a point dropped or panned to far from the scene goes back through the scene's
  map, which a transverse Mercator holds only so far from its central meridian; Web Mercator
  shows nothing past 85.05°. `zooms` must reach past `globalFrom` for `'auto'` to switch.

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
  extent, which keeps its size at every zoom (default `{ fraction: 0.45 }`). Both are laid out
  on the ground about the camera and carried onto the map (`mapViewCone`, from the state's
  `forward`): a radius in metres reaches that far along the ground in every direction (an egg
  in Web Mercator far north), and the cone's angle is the camera's even where the map is not
  conformal (Equal Earth).
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
  (`altitudeControl.dragRange` pixels each way, default 100, at most a sixth of the map's
  height, so on a short map the control keeps its proportion to it)
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

- A WebGL context of its own, so it holds its own tiles on the GPU: at most 512 of about
  11 KB each (heights, normals, layer ids), under 6 MB whatever the relief, against the
  whole-layer maps of before (31 MB for the demo's five layers). Browsers limit contexts, so
  it is given back (`forceContextLoss`) on unmount. A new context is made only for a new look
  table; new layers or a new `base` start a new set of tiles on the one there is.
- Its tiles come from the same generator as the stage's, at most two at a time, so the stage's
  own come first; on the same worker they share its block cache (`ReliefReader`), so blocks
  the stage has read are not read again. A full view at the default `cellPixels` is about a
  hundred tiles; half of it four times as many.
- The colour ramps and the looks are the scene's textures, drawn from textures of the
  minimap's own that share their data: three keeps every renderer a texture was uploaded to
  alive through a listener on that texture, so sharing the scene's own would keep each
  disposed minimap renderer alive. A change to them (`color`, `contours`, `layerLooks`, a
  ramp registered) redraws the map.
- No limit on the number of layers: they are merged onto the tiles, so the shader reads one
  height whatever their number (a tile numbers its nodes' layers in 8 bits).
- Heights are read in full precision from the tiles' 32-bit heights, bilinear from four
  fetches. The shading's slope comes from the tiles' normals, not from the heights'
  differences: bilinear heights are faceted, a cell to a facet, which a relief with no data
  finer than a few pixels shows as blocks.
- A pixel's neighbours are sampled for the coast and the contours, so the fragment shader
  reads the ground five times. It runs only when the view moves a quarter pixel, its scale, turn, size or style
  change, or tiles come in.
- Heights over the sea (the readout, `'auto'`, the altitude control) and the camera's and
  target's places on the map are the globe's under a `Scenery` (the `World`'s globe,
  `globeMapSurface`): far from the field the sea curves below Y = 0, and the map's point under
  the camera is its foot on the globe, not its scene X/Z. A dropped marker keeps its height
  over the sea there. Without a `Scenery`, the plane Y = `level` (`flatMapSurface`). Without
  controls, the target is where the view ray meets the plane Y = `level`.
- Not done: globe mode, resizing by dragging, custom buttons, and a mode switch among the controls.
- Across the 180th meridian it takes the tiles either side, each about the view's middle the
  short way round (`geoTileSquareFrom`).

Story: `Components/Html/Minimap` (`src/components/Html/Minimap/Minimap.stories.tsx`). The
stories with a `Scenery` (`Components/Misc/Scenery`, `Components/Layers/Tracks`, the
`Spikes/Scenery` ones and `Spikes/Chunks/FieldColumn`) have a `minimap` switch, off by default:
`SceneryArgsMinimap` (`src/storybook/components/scenery-features.tsx`), the minimap's defaults
and a camera marker over the ticked demo reliefs, in the story's map and at its sea's level.
