# Geographic layers: polygons, lines, points, labels and tracks

Data of your own, in longitude and latitude, laid over the world: licences, fields,
discoveries and safety zones as polygons; pipelines and cables as tubes; facilities as
symbols; their names; ships and vehicles from a tracking feed. Each layer places itself by
latitude and longitude — on a `Scenery`'s globe when there is one, else flat on the `World`'s
frame — and **needs no relief**: with one, without one, or with no `Scenery` at all. Inside a
`Scenery` they can also lie on its relief, the seabed and the land, and be seen through its
sea as the seabed is (`water`).

```tsx
<World frame={frame}>
  <Scenery>
    <SceneryOcean />
    <SceneryStage bounds={bounds} relief={{ layers }} />
    {/* Inside the Scenery: on its relief, seen through its sea. */}
    <GeoTubes
      data={pipelines}
      style={f => ({ color: '#e5383b', diameter: f.properties.diameter * 0.0254 })}
      exaggeration={20}
      span={60}
    />
    <GeoSymbols data={facilities} style={{ color: '#ffd43b', size: 80 }} />
  </Scenery>
  <GeoPolygons
    data={discoveries}
    style={f => ({ fill: f.properties.hcType === 'GAS' ? '#e5383b' : '#2fbf4a' })}
    maxHeight={1500000}
  />
  <GeoLabels data={discoveries} text={f => f.properties.name} maxHeight={250000} />
  <TrackLayer tracks={ships} annotations={{ layer: 'ships', text: s => s.name }}>
    {(ship, ref) => <Tanker ref={ref} length={ship.length} />}
  </TrackLayer>
  <Minimap layers={layers}>
    <MinimapGeoLayer data={discoveries} frame={frame} />
  </Minimap>
</World>
```

Stories: `Components/Layers/GeoLayers` (the Norwegian continental shelf's discoveries,
`Discoveries` and `Discoveries (World only)`), `Components/Layers/Pipelines` (its pipelines
and facilities on the seabed, `On the seabed` and `To the coast`) and
`Components/Layers/Tracks` (`Ships`).

## The pieces

| piece | draws | how |
| --- | --- | --- |
| `GeoTileLayer` | area data from tiles of your own: the core `GeoPolygons` is built on | geographic tiles: your texels per tile, your GLSL per pixel |
| `GeoPolygons` | polygons, filled and outlined | a signed distance field per tile |
| `GeoTubes` | lines as 3D tubes on the ground, their diameter as built (exaggerated), never thinner than a few pixels | one instanced tube, a segment per instance, nodes laid about the camera |
| `GeoSymbols` | points as 3D symbols of any geometry, standing on the ground, their size as built (exaggerated), never narrower than a few pixels | one instanced mesh (`Symbols`) |
| `GeoLabels` | a label per feature, flat inside a polygon, by a point | a `LabelLayer`, placed on the globe |
| `MinimapGeoLayer` | the same features as the scene's layers, less what its `filter` leaves out, on a `Minimap` | SVG paths and dots, carried to scene X/Z once |
| `TrackLayer` | things that move: anything you render, a `Tanker` say | dead reckoning between fixes, an object moved per frame |

The data is GeoJSON (`GeoJsonFeatureCollection`) or features read from it
(`geoFeaturesFromGeoJson`, `GeoFeature`): their geometry a `PlanarGeometry` in longitude and
latitude, multi-part kinds folded in. Read once per collection, so pass the same object
until the data changes.

### Where it lies on the Earth

`useLayerGlobe(frame?)` is what each layer is placed on: the enclosing `Scenery`'s globe, else
the `World`'s, else a globe of its own that does not curve, laid on `frame` (default the
`World`'s). With the curve off, the globe lays the Earth flat stereographically about the
scene's origin, as the relief draws it then, while a `UtmArea` uses its map's projection: the
two agree to centimetres over a field and drift to metres 100 km out.

## Visibility by height

Every layer takes `LayerVisibility`: `visible`, `minHeight`, `maxHeight` — the camera's
height over the sea, in metres — and `fade`, a ratio of the bound (a layer up to 50 km with
`fade` 0.2 is gone at 60 km), so it fades alike at 1 km and at 1000 km
(`layerVisibilityAt`). The height is `globe.altitude(camera)`: under a `Scenery` far from the
field, scene Y is not the height (see [scenery.md](./scenery.md#the-globe)). Outside its
heights a layer draws nothing and loads nothing. `MinimapGeoLayer` takes the map's extent
instead (`minExtent`, `maxExtent`).

## When a layer is drawn

One test, made by every scene layer — `GeoTileLayer` (so `GeoPolygons`), `GeoTubes`,
`GeoSymbols`, `GeoLabels`, `TrackLayer` — before it draws or does any work for the frame:
`layerShownAt(camera.position, globe, ocean, visibility, lies)`. Not shown, its mesh is
hidden: no draw call, no vertex work, and none of its CPU work (laying nodes, choosing
tiles). Hiding what cannot be seen this way is cheaper, and surer, than leaving it to the
depth buffer or a shader to discard. It holds:

- its heights (`layerVisibilityAt`, above);
- **in the ground**: inside a `Scenery` with a sea, while the camera is under the ground —
  the relief a stage draws, else the sea's flat seabed — the void's lid hides all above it
  (see [relief.md](./relief.md)), so nothing lying above it is drawn (`sceneryLidOverCamera`).
  Depth alone does not hide it: the lid leaves pixels to the background, which writes none —
  toward the horizon where the globe curves the ground below the camera's level, and where
  the void's walls stand in front — and a layer drawn without the depth test (`GeoLabels`)
  is hidden by nothing. `lies` says where the layer is: `'ground'` (draped, on the relief),
  always above the lid; or a height over the sea, above it where it is at the lid's height
  over the camera or higher. A layer laid deeper, at a reservoir's depth say, is still seen
  from the void.

A new layer calls it too: what it must not show is decided in one place.

## The core: `GeoTileLayer`

`GeoPolygons` is a `GeoTileLayer` with tiles and sampling of its own; give it yours to draw
other area data (a raster, a heat map). It takes two things, both kept stable (`useMemo`):

```tsx
const source: GeoTileLayerSource = {
  size: 64,                                 // texels a side, a border of one aside
  format: { channels: 4, type: 'u8' },      // R, RG or RGBA; 'u8', 'f16' or 'f32'
  covers: key => index.over(key).length > 0, // is anything over the geographic tile?
  load: key => generate(index.pack(key), key), // its texels: on a worker, or here
};
const shader: GeoTileLayerShader = {
  // the premultiplied colour at uv (0…1 east and south) across the tile in `slot`
  sample: `vec4 geoTileSample(float slot, vec2 uv, float texelMetres) {
    return geoTileRead(slot, uv) * uMyTint;
  }`,
  uniforms: { uMyTint: new Uniform(new Vector4(1, 1, 1, 1)) },
};
<GeoTileLayer source={source} shader={shader} drape maxHeight={200000} />
```

- **A tile** (`GeoTileContent`) is `size + 2` texels a side, row by row from the north-west,
  with a `leaf` (nothing finer to see: never split) and an `empty` flag (nothing on it: it
  holds no texels and no slot). The tiles in sit in one texture array (`GeoTileTextures`),
  a slot each, at most 512 or the GPU's limit.
- **The sampling** reads them through `geoTileRead(slot, uv)` (filtered as the format
  says), `geoTileFetch(slot, uv)` (the texel under it) and `geoTileTexel(uv)`; `texelMetres`
  is a texel's width along a meridian, for sizes given in metres. Both a tile and the tile it
  blends from are sampled, so the colour may depend only on the arguments and uniforms; and
  derivatives (`fwidth`) only before any branch that is not the same over the tile. Per
  feature styles go in a `GeoTileStyles` texture, read with `geoTileStyle(index)`, and ids
  in a tile's G and B channels with `geoTileId` (`shaders/geo-tile-styles.glsl`).
- **Everything else is the core's**, as described for the polygons below: chosen only where
  `covers` says, split by `texelPixels`, never a blur nor a hole while loading, soft swaps,
  nothing done while the view holds still, `LayerVisibility`.
- ⚠️ **Not for lines or points.** Tiles are split by their texels' size on screen the same
  every way, but at a grazing angle a texel is squeezed one way, by up to tens of times.
  Anything only a few texels wide — a line, a dot — is then thinner than a pixel that way,
  missed between pixels, and breaks into dashes; a wider distance band and tiles split by
  their squeeze would cost far more than the geometry. Lines and points were drawn this way
  until 2026-10-29 (`GeoLines`, `GeoPoints`) and were dropped for it: draw lines as
  `GeoTubes` and points as `GeoSymbols`. Area fills keep their look at any angle; only their
  outlines thin there.

### On the relief: `drape`

With `drape`, inside a `Scenery`, the layer lies on the relief its `SceneryStage` draws —
the seabed and the land — exactly as drawn, through its swaps between levels of detail too.
The stage tells what it draws each time it chooses (`SceneryOceanState.reliefTiles`, a
`SceneryReliefHub`: the heights' texture array, and per tile drawn its slot, the tile it
blends from and how far). The relief's tiles and the layer's share the geographic quadtree,
so each tile of the layer is drawn as one square per relief tile under it
(`tilesUnder`): the tile itself where a relief tile holds all of it, or each finer relief
tile drawn under it. Each square is a patch of 32 cells — the relief's own, so its nodes
include the relief's — whose heights are read on the relief tile's triangles as the relief
reads them, and mixed with the tile it blends from as the relief mixes them. The layer's
data is read at the square's place in its own tile (`tileOffsetIn`), so no tile of the layer
is loaded for the relief's sake. Where no relief tile is drawn, flat at `height`. The lift
covers the rest: the globe's latitude across a deeper square is its own, not interpolated
from the relief tile's, by less than a millimetre.

The choosing then bounds each tile by the ground under it: the lowest and highest of the
finest relief tile in over it (`SceneryReliefDrawn.rangeAt`, `GeoTileBounds` with a range per
tile), so no tile on a mountain is culled for lying at sea level. ⚠️ Not by the relief's
lowest and highest ground in all: a box from the deepest trench to the highest peak puts the
camera next to every tile, and the layer split down to its deepest level near it, its texels
so much finer than the pixels that a line's distance reached under a pixel and lines showed
as broken dashes (found in the `Pipelines` story, 2026-10-29).

### Through the sea: `water`

Inside a `Scenery` with a sea, `water` `'fog'` (the default, but `GeoPolygons`') draws the
layer as the seabed under it is seen: from above, dimmed with its depth and through the
water in front of it; from in the water, through the water between; taken with the seabed
by the cutaway (the relief's own water, `skyOceanFog` and its kin). As the seabed, it is
gone under the water from a few kilometres up, where the sea turns opaque
(`SKY_OCEAN_OPAQUE`). It is then drawn among
the see-through objects, after the relief and before the sea's surface (`renderOrder` 0.5,
wired for an `OITRenderPass`), so the waves lie over it. `'clear'` draws it on top of
everything see-through, as a map (`LAYERS.OVERLAY`, `renderOrder` 999). Outside a `Scenery`,
always `'clear'`.

## Polygons: `GeoPolygons`

Drawn from **geographic tiles of their own** (the relief's quadtree, `geo-tile-keys`), not
from meshes of the polygons — a `GeoTileLayer`, `water` `'clear'` by default:

- **Per tile, a distance field** (`buildOverlayTile`, `OverlayTile`): 64 texels a side and a
  border of one, RGBA8. R is the distance to the nearest edge of any polygon, in metres alike
  both ways (along a parallel a texel is `cos(latitude)` narrower), positive inside any of
  them, exact within 4 texels of an edge. G and B are the id of the polygon on top (the last
  in the data), spread a texel past the polygons. Built by the `overlayTile` generator
  (`generateOverlayTile`) where it is registered, else on the main thread; only the polygons
  over a tile are sent to it (`packOverlayShapes`), so a feed of new polygons needs nothing
  of the store.
- **Chosen where there are polygons** (`OverlayFeatureIndex`, by their bounds) and split until
  a texel spans no more than `texelPixels` (2) pixels: edges stay sharp at any zoom, a
  distance field magnifies well. A tile no edge comes near is a leaf (wholly inside or
  outside), so the inside of a large polygon is never split. A polygon smaller than a texel
  shows as a dot, so none is lost from afar.
- **Chosen only when something changed**: the view, the canvas's size, the tiles in, the
  globe or the height. A view held still costs nothing. The view is taken from the
  camera's matrices of this frame (`camera.updateMatrixWorld()` first), as the relief's is.
  Each tile's bounds — flat, at a
  fixed height (or between the lowest and highest ground, draped), on a globe placed once —
  are kept between frames (`GeoTileBounds`), so
  choosing costs a few vector operations a tile rather than `geoTileInView`'s placements.
  An empty tile holds no texels, so the streamer's budget goes to what is drawn.
- **Never a blur while loading, never a hole.** The relief must load a tile to know whether
  to split it; an overlay's tile is flat with no error, so whether it splits is known without
  it. A tile too coarse to bring in — its texels wider on screen than `fallbackPixels`
  (default 4 x `texelPixels`), or shallower than `minDepth` — is passed through as if in,
  never loaded: the choice goes straight to the detail the view needs, and only the last two
  or three levels load (before, the first view drew the 180° roots first, a texel 3°
  across). What is drawn already stays drawn — a stand-in (`TileTransitions`) — until the
  tiles chosen in its place are in and cover all of it that is in view, however coarse it
  has become; they then blend from it. (Until 2026-10-28 a tile past `fallbackPixels` was
  dropped at once, and the sea showed through until its replacements loaded.) A tile with
  no edge on it — wholly inside a polygon — is drawn at any size. Measured in
  `Discoveries`, a cold zoom from 40 to 1.2 km onto an edge of Sleipner Øst: the two tiles
  drawn from afar stay until the first finer ones are in (about 40 ms with the tiles
  cached by the browser), never fewer drawn than before; the finer ones blend from them,
  settled 300 ms after the last came in.
- **`minDepth`** forces a floor on the detail: no tile shallower is loaded or drawn,
  whatever the view (a depth-`d` tile spans `180 / 2^d` degrees: 10 is about 19 km north to
  south).
- **Soft swaps** (`transition`, default 300 ms; 0 at once): each tile blends from the look of
  the one it replaces (`TileTransitions`, shared with the relief: see
  [tiles.md §5](./tiles.md#5-drawing-the-relief)). The fragment shader samples the source
  tile's distance field at the same place and mixes the two colours, premultiplied, so
  nothing is drawn twice and the see-through layer does not darken. A split blends from the
  parent drawn; on a merge the children stay drawn, blending back toward the parent, until
  they look the same. Where nothing was drawn — the first view, the layer shown again, a
  stand-in no longer fine enough — the layer fades in. Measured: a 2.5x zoom-in blends 97
  of 98 tiles, settled 300 ms later; a zoom-out holds the finer tiles, then swaps.
- **Drawn** as one instanced patch (16 x 16 cells flat, 32 x 32 draped) per tile — per
  square over the relief's tiles, draped — each node placed on the globe by its latitude
  and longitude (`globeGeodetic`, through `geo-tile.glsl`, which the relief's tiles share),
  `height` metres over the sea's level or on the relief, then moved toward the camera by
  `lift` + `liftPerDistance` x distance — a move, not a depth bias, so it holds with a
  linear, logarithmic or reversed depth buffer (`shaders/geo-tile-vertex.glsl`).
- **The fragment shader** (`shaders/geo-polygons-sample.glsl`) draws the fill's edge from R
  (anti-aliased by `fwidth`) and an outline `strokeWidth` pixels wide inside it, coloured
  by the polygon on top: its `fill`, `fillOpacity`, `stroke` and `strokeOpacity`, from a
  small texture of styles by id. Where polygons overlap the later one's fill is on top, and
  every outline shows.
- **On top of the see-through** by default (`water` `'clear'`): on `LAYERS.OVERLAY` (after
  the transparent layers with an `OITRenderPass`, at `renderOrder` 999 without), tested
  against what is opaque, not picked.

Costs, measured in the `Discoveries` story (598 discoveries, about 1.3 MB of GeoJSON;
Iris Xe, 1.33 megapixels, 30 km off at 35°): 30 to 160 tiles drawn, 512 triangles each, of
66 x 66 x 4 bytes (at most 512 held, 8.9 MB). The draw 0.7 ms of GPU, the frame within
noise of the layer off. On the main thread, choosing the tiles 0.6 to 1.2 ms a frame while
the camera moves and 0.02 ms while it is still; before the bounds were kept and the
choosing skipped, 4.7 and 7.5 ms. Nothing at all while no polygon is in view or the layer
is out of its heights.

### Why not meshes, and why not the relief's tiles

| way | against |
| --- | --- |
| a mesh per polygon, draped on the ground | must meet a surface that changes with the view and the curve: it floats or fights; a 50 km polygon needs fine triangles only near the camera; depth offsets fail with a logarithmic depth |
| the relief's tiles drawn again ([tiles.md §8](./tiles.md#8-overlays-shapes-on-the-relief-the-sea-and-the-seabed), the first design) | needs a relief; and over flat seabed the relief stops coarse (cells of 870 m from 3 km up over Volve), where a 64² distance field cannot hold a 2 km polygon |
| **tiles of its own** | the surface is the overlay's own: flat at a height, so it needs no relief; on the ground (`drape`) it is drawn per relief tile under it, reading the relief's heights |

## Lines: `GeoTubes`

Pipelines, cables and routes as 3D tubes lying on the ground, one instanced draw for the
whole network: a segment per instance between two nodes, its ring built in the vertex shader
(`tube-segment.glsl`, shared with `Trajectory`), its silhouette darkened (`tube-rim.glsl`,
shared too), unlit so its colour reads the same from any side.

- **Width:** each feature's `diameter` as built (`GeoTubeStyle`), `exaggeration` times as
  wide, and never thinner than `minPixels` (a radius found per vertex from its distance, as
  `Trajectory`'s `minPixelRadius`): the same tube is a pipe close up and a line of a couple
  of pixels from 100 km, at any angle. `minPixels` 0 turns the floor off: the tube is drawn
  as built and thins out of sight with distance, as any geometry does.
- **Nodes** (`geoTubeNodesAround`, `layGeoTubeNodes`): every route vertex, and between them
  one every `spacing` metres (20) near the camera, `spacingPerDistance` (1 %) of the distance
  to the camera farther off, the camera's height counted, so nodes go where they are seen.
  Laid again once the camera has moved a fifth of its height; spaced wider until they fit in
  `maxNodes`. Laid on a worker by the `geoTubeNodes` generator (`generateGeoTubeNodes`) where
  it is registered, else on the main thread: the routes go packed in typed arrays
  (`packGeoTubeRoutes`), the globe as its conformal sphere (`Globe.conformalOrigin`,
  `conformalOffset`), the nodes come back transferred; one request out at a time. Measured
  on the demo's 84 pipelines: 12.5k segments from 300 m over Volve, 6.5k from 150 km.
- **On the ground, on the GPU:** each node finds the relief tile drawn under it and reads its
  height on that tile's triangles, through its swaps (`relief-tile-height.glsl`, shared with
  the tile layer's drape), so the tube meets the seabed as drawn at any distance. Where no
  relief tile is drawn, flat at `height`. The axis is lifted by the radius, so it rests on
  the ground. The nodes are grouped by tile (`GeoTubeReliefGroups`): each holds where it lies
  across its tile and its group, written when it is laid and again only once its tile is no
  longer drawn (the hub's `keysVersion`); each frame only the groups' small texture is
  rewritten (the tile's slot and blend, the tile it blends from), and uploaded only when it
  changed. Nodes over no tile drawn are kept by the tile where looking stopped, and looked
  for again a tile at a time.
- **Free spans:** a stiff pipe rests on the high points and bridges the hollows (`span`,
  `smoothing`): the nodes closer than the span are marked `near` where they are laid — farther
  off a span is under a pixel — and rested on the ground on the main thread, where the
  relief's finest tiles in are (`liftGeoTubeNodes`: `SceneryReliefDrawn.heightAt`,
  `geoSpanLift`), again as finer tiles come in, without laying the nodes again; handed to the
  GPU per node, over the ground it reads.
- **Through the sea:** `water` `'fog'` dims it as the seabed under it (`geo-water.glsl`); like
  the seabed, it is gone where the sea turns opaque from a few kilometres up.

## Points: `GeoSymbols`

Facilities, wells and buoys as 3D symbols: one `Symbols` instanced mesh, of any `geometry`
(default a disc a unit across) and `material`, each placed on the globe where it lies, upright
on the relief (the relief's ground on the CPU, `heightAt`, again as finer tiles come in), its
`size` in metres as it stands, `exaggeration` times as large. Never narrower than `minPixels`
on screen — **widened, never raised**, so a symbol on the seabed stays under the water from
afar. With its own material the widening is the vertex shader's, so a symbol's matrix is made
only when it moves on the Earth (its ground, the globe), never for the camera; with a material
of your own, on the CPU each frame the camera moves. `minPixels` 0 turns the floor off: drawn
as built, shrinking out of sight with distance. Its own material shades each face by
how it turns up and is seen through the sea (`water`); a material of your own is drawn as it
is.

## The demo data

`npm run generate-overlays` (Sodir, NLOD 2.0): the shelf's 84 pipelines and 786 facilities in
place. Sodir publishes the routes at a low resolution and cut 500 m short of each facility,
some with none; the script joins each end to its facility within 60 km (the landfalls to their
terminals onshore too), draws a route missing straight between its facilities, and makes up a
hub at Volve with lines to Navion Saga and Sleipner A (`joinNearestEnd`, `greatCircleSteps`).
The minimap draws the same two files: one dataset, whatever draws it.

## Labels: `GeoLabels`

Each feature's `text`, as a `Label` lying flat (read from above, reading east): a polygon's
at the point inside it farthest from its edge (`geoFeatureLabelPoint`, `polygonLabelPoint`:
inside however concave), a line's at the middle of its longest part, points' at the first.
`size` `'fit'` (default) sizes each to the room it has there, between `minSize` and
`maxSize` metres. On the globe by latitude and longitude (`Globe.geodetic`, its normal and
reading direction there), placed again when the globe is. The rest is `LabelLayer`'s: one
instanced draw, faded when too small on screen (`minPixels`), every `LabelStyle` option.

Two of those differ from a `LabelLayer`'s defaults: **`depthTest` false**, drawn over
everything — the labels lie flat at `height` (the sea's, by default), and the relief rises
through it in places (land, a terminal onshore) and would bury them — and **`flip` true**,
turned to read left to right whichever way the camera looks. Labels past the globe's horizon
face away from the camera and are not drawn (`minFacing`), with or without the depth test.

Not drawn far off either: past `maxDistance` (default 150 km, fading over its last tenth,
`fadeDistance`) a label is dropped, and while none of a layer's could show — all past it, or
too small to read at the nearest any could be (`minPixels`) — the `LabelLayer` is not drawn
at all (`LabelLayerMesh.reachable`: a sphere round its labels, their size at the least depth
in view). In the ground under them (see [When a layer is drawn](#when-a-layer-is-drawn)) the
layer is hidden: without the depth test, nothing else would hide it.

Labels are glued to the world: they are not kept apart, and where polygons crowd they may
overlap. For a label that keeps its size on screen and is kept clear of others — on
something that moves, say — use an `Annotations` layer (as `TrackLayer` does).

## Tracks: `TrackLayer`

`Track`: an id, `longitude`, `latitude`, `speed` (m/s; `knots()` converts), `course`
(degrees from true north) and the `time` of the fix. The layer, each frame and without a
React render:

- carries each track on from its fix along its speed and course (`advanceTrack`, a rhumb
  line), unless `extrapolate` is off;
- turns it to its course in the scene (`courseToHeading`: a short step along the course
  carried into the scene, so the map's convergence is counted — 1.7° 2° east of the meridian
  at 58° N);
- eases into a new fix over `smoothing` seconds, its position and its heading the short way
  round, instead of jumping;
- moves what `children(track, ref)` attached to `ref`: its `position.x`, `position.z` and
  `rotation.y` only, and its `position.y` once, so a `Tanker`'s buoyancy keeps its own height,
  pitch and roll (its ref is its group).

A new fix is a new array with a changed track (another `time`, position, speed or course).
`annotations` puts a label per track on an `Annotations` layer, anchored to its object's
world matrix, so it follows it.

⚠️ Placed flat: on a `Scenery`'s globe, keep what floats within the stage's flat disc, past
which the sea curves away. Each track is an object of its own: for thousands, instance them.

## The minimap: `MinimapGeoLayer`

A `Minimap`'s layers render in a React root of their own and see no `World`: give it the
`frame`. Its features are carried to scene X/Z once (`geoFrameXZ`, densified every 0.05° so
long edges keep their shape), and their paths are written as the map changes: those off the
map emptied, vertices and points closer than a pixel dropped, and what is left cut to the
map and a margin (`minimapPathData`; see [minimap.md](./minimap.md)), so the scene's own data
is drawn as it is: no simpler copy is needed. Points are dots `radius` pixels across. `filter`
leaves out what would clutter a small map (the `Pipelines` story's subsea templates).

## Helpers (sdk)

`geoFeaturesFromGeoJson`, `densifyPlanarGeometry`, `projectGeoFeature`; `polygonLabelPoint`;
`layerVisibilityAt`, `layerShownAt` (see [When a layer is drawn](#when-a-layer-is-drawn));
`advanceTrack`, `courseToHeading`, `knots`; `buildOverlayTile`,
`packOverlayShapes`; `geoDistance`, `greatCircleSteps`, `joinNearestEnd`, `simplifyGeoLine`
(lines in longitude and latitude); `packGeoTubeRoutes`, `geoTubeNodesAround`,
`layGeoTubeNodes`, `liftGeoTubeNodes`, `geoSpanLift` (tubes' nodes); `conformalOffset`
(`Globe.sphereOffset` without a globe, for workers);
`createTubeSegmentGeometry` and the GLSL chunks `tube-segment.glsl` and `tube-rim.glsl`
(tubes drawn in the vertex shader, shared with `Trajectory`);
`geoFrameXZ` (the reverse of `geoFrameLonLat`); the geographic tiles
on a globe, shared with the relief (`sdk/tiles/geo-tile-globe.ts`: `geoTileLayout`,
`geoTileOffsets`, `geoTileSquare`, …) and its GLSL (`shaderLib/geo-tile.glsl`, with
`geoTileFrom`); soft swaps between levels of detail for any quadtree
(`sdk/tiles/tile-transitions.ts`: `TileTransitions`, `tileOffsetIn`); and one quadtree layer
laid on another's tiles (`sdk/tiles/tile-cover.ts`: `tilesUnder`, `tileAncestors`,
`composeTileOffsets`).

## Not done

- **On the land, through the air**: draped over land, a layer is not hazed with distance as
  the land is (`reliefThroughAir`); seen from space, not lit as the land is.
- **Labels on the ground**: `GeoLabels` lie flat at a height (the sea's, say), not on the
  relief. Draped labels would ask the worker (`sampleReliefSource`) rather than pin tiles
  under hundreds of features.
- **On the sea's own surface**: polygons are drawn over the sea, lifted; waves higher than the
  lift show through close up. In the sea's shader they would lie on the waves.
- **Picking** of polygons by the id channel, and of tubes and symbols (`Symbols` takes
  pointer events; `GeoSymbols` does not pass them on yet).
- **Tubes' nodes** are laid on the main thread; for a much larger network than the demo's,
  lay them on a worker and cull those behind the camera.
- **Instanced tracks** for large fleets, and a time scale for replaying a feed.
- Features across the 180th meridian.
- **The relief's own choosing** costs 3.6 to 8.5 ms of the main thread a frame in the same
  view, still or moving (`SceneryStageReliefTiles`, unchanged here): the same two steps — skip
  it while nothing changed, keep what does not depend on the camera — would help it too.
