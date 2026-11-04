# Geographic layers: polygons, lines, points, labels and tracks

Data of your own, in longitude and latitude, laid over the world: licences, fields,
discoveries and safety zones as polygons; pipelines and cables as tubes; facilities as
symbols; their names; ships and vehicles from a tracking feed; and lines of latitude and
longitude, the UTM zones and the time zones (`GeoGraticule`). Each layer places itself by
latitude and longitude on the `World`'s globe, and **needs no relief**: with one, without
one, or with no `Scenery` at all. With a `GeoRelief` in the `World` they can also lie on it,
the seabed and the land, and inside a `Scenery` be seen through its sea as the seabed is
(`water`).

```tsx
<World frame={frame} boundary={boundary}>
  <Scenery>
    <SceneryOcean />
    <SceneryStage />
    {/* Inside the Scenery: seen through its sea. */}
    <GeoTubes
      data={pipelines}
      style={f => ({ color: '#e5383b', diameter: f.properties.diameter * 0.0254 })}
      exaggeration={20}
      span={60}
    />
    <GeoSymbols data={facilities} style={{ color: '#ffd43b', size: 80 }} />
  </Scenery>
  {/* The ground the pipelines and the facilities lie on. */}
  <GeoRelief layers={layers} />
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
and facilities on the seabed, `On the seabed` and `To the coast`),
`Components/Layers/Tracks` (`Ships`) and `Components/Layers/Graticule` (with a `Scenery`, in a
`World` alone, and with no relief).

## The pieces

| piece | draws | how |
| --- | --- | --- |
| `GeoTileLayer` | area data from tiles of your own: the core `GeoPolygons` is built on | geographic tiles: your texels per tile, your GLSL per pixel |
| `GeoPolygons` | polygons, filled and outlined | a signed distance field per tile |
| `GeoGraticule` | lines on the Earth: latitude and longitude, the UTM zones, the nautical time zones, and their names | a `GeoTileLayer` with no data: each pixel's lines worked out from where it lies |
| `GeoTubes` | lines as 3D tubes on the ground, their diameter as built (exaggerated), never thinner than a few pixels | one instanced tube, a segment per instance, nodes laid about the camera |
| `GeoSymbols` | points as 3D symbols of any geometry, standing on the ground, their size as built (exaggerated), never narrower than a few pixels | one instanced mesh (`Symbols`) |
| `GeoLabels` | a label per feature: a polygon's fitted inside it, broken into lines and turned along it where that fits better; by a point | a `LabelLayer`, placed on the globe |
| `MinimapGeoLayer` | the same features as the scene's layers, less what its `filter` leaves out, on a `Minimap` | SVG paths and dots, carried to scene X/Z once |
| `TrackLayer` | things that move: anything you render, a `Tanker` say | dead reckoning between fixes, an object moved per frame, stood upright on the globe where it is |

The data is GeoJSON (`GeoJsonFeatureCollection`) or features read from it
(`geoFeaturesFromGeoJson`, `GeoFeature`): their geometry a `PlanarGeometry` in longitude and
latitude, multi-part kinds folded in. Read once per collection, so pass the same object
until the data changes.

### Where it lies on the Earth

`useLayerGlobe(frame?)` is what each layer is placed on: the enclosing `World`'s globe, else
the `Scenery`'s, else a globe of its own that does not curve, laid on `frame`. In a `World`
the layer lies in the same place with or without a `Scenery`. With the curve off, the globe lays the Earth flat stereographically about the
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

One test, made by every scene layer — `GeoTileLayer` (so `GeoPolygons` and `GeoGraticule`), `GeoTubes`,
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
  toward the horizon where the globe curves the ground below the camera's level — and a layer drawn without the depth test (a `GeoLabels` given `depthTest` false)
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
- **Drawn from the shader alone:** a source with no `load` holds no texels. Every tile chosen
  is drawn at once, in no slot of its own; `size` still splits it, until `size` cells of it
  span no more than `texelPixels`. The sampling may read where the pixel lies on the Earth
  before the lift, `vGeoTileWorld`: a formula of the place, as `GeoGraticule`'s lines are.
  With derivatives in it, swap at once (`transition` 0): the tile a swap blends from is
  sampled in a branch.
- **Out to the horizon** (`reach` `'horizon'`): tiles are chosen past the camera's far plane
  too — its plane left out of the culling — out to the globe's horizon, drawn at the far
  plane's depth there (as `GeoTubes` and `GeoSymbols` are). Default `'far'`.
- ⚠️ **Not for lines or points.** Tiles are split by their texels' size on screen the same
  every way, but at a grazing angle a texel is squeezed one way, by up to tens of times.
  Anything only a few texels wide — a line, a dot — is then thinner than a pixel that way,
  missed between pixels, and breaks into dashes; a wider distance band and tiles split by
  their squeeze would cost far more than the geometry. Lines and points were drawn this way
  until 2026-10-29 (`GeoLines`, `GeoPoints`) and were dropped for it: draw lines as
  `GeoTubes` and points as `GeoSymbols`. Area fills keep their look at any angle; only their
  outlines thin there.

### On the relief: `drape`

With `drape`, the layer lies on the relief the `World`'s `GeoRelief` draws — the seabed and
the land — exactly as drawn, through its swaps between levels of detail too. The relief
tells what it draws each time it chooses (`WorldReliefState.tiles`, also handed on as
`SceneryOceanState.reliefTiles`, a `SceneryReliefHub`: the heights' texture array, and per
tile drawn its slot, the tile it blends from and how far). The relief's tiles and the layer's share the geographic quadtree,
so each tile of the layer is drawn as one square per relief tile under it
(`tilesUnder`): the tile itself where a relief tile holds all of it, or each finer relief
tile drawn under it. Each square is a patch of 32 cells — the relief's own, so its nodes
include the relief's — whose heights are read on the relief tile's triangles as the relief
reads them, and mixed with the tile it blends from as the relief mixes them. The layer's
data is read at the square's place in its own tile (`tileOffsetIn`), so no tile of the layer
is loaded for the relief's sake. Where no relief tile is drawn, flat at `height`: the whole
tile, or each part of it no relief tile is drawn under (`tilesUnder` with `fill`), so none
of it is left out — past the far plane, where the relief draws its overview alone, a layer
reaching for the horizon showed holes, tile-shaped, until 2026-11-03. The lift
covers the rest: the globe's latitude across a deeper square is its own, not interpolated
from the relief tile's, by less than a millimetre.

**A floor** (`floor`, metres over the sea): the layer never lies lower — 0 lies on the land
above the sea and on the sea's level over the sea, as `GeoGraticule` does with a sea that
has water. Each tile whose ground lies wholly at or below it (the relief's `rangeAt`; the
open sea) is drawn flat on it in a draw of its own: one 16-cell patch, not one 32-cell patch
per relief tile under it, and no relief read per vertex. Only the coast and the land are
draped: in the `Graticule` story from 30 km over the North Sea, 118k triangles instead of
330k, about 1.8 ms instead of 4 (Iris Xe). Without a floor, nothing changes.

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

**Under the background's sea.** A stage draws the sea out to the far plane, but no farther
than 3000 km, and only while the camera is over its area (see
[scenery.md](./scenery.md#the-globe)); past that the background draws it, on the far plane,
where it hides nothing by depth. So with `'fog'` a layer hides itself under it
(`skyOceanCover`, sky-ocean.glsl, taken in `geo-water.glsl`): its alpha takes the cover of
what the background draws between the camera and it, by the layer's own height, with no depth
needed — the same past the far plane:

- the sea's surface, from above the water, over what lies under it, as opaque as the surface
  is there (from a few kilometres up, and far off, all of it);
- the seabed, from anywhere above it, with the water on or off, over what lies below the
  sea's `depth`, as much as it hides (`seabedOpacity`, the cutaway; nothing without a
  seabed). Not where a relief's tiles draw the seabed — out to the far plane from in the water
  and over a dry sea, where they hide what lies below by depth;
- either over what lies past the Earth's curve: nothing shows through the globe.

What lies above both stays in sight, past the far plane too: `GeoTubes` and `GeoSymbols`
keep their depth just inside it, in front of the background and the relief's overview drawn
on it. Field data needs none of this: it lies in a stage's area, whose surface and seabed hide
it by drawing and by depth.

### Revealed as a map: `reveal`

A `'fog'` layer can be shown through the sea and its seabed — `GeoTubes`, `GeoSymbols` and
`GeoTileLayer` (so `GeoPolygons`) take `reveal` (`LayerReveal`): `true` always, or by the
camera's height over the sea as a `LayerVisibility` says — `visible` the toggle, `minHeight`
and `maxHeight` the band, `fade` its soft edge (`layerRevealAt`):

```tsx
// On the sea as a map from 20 km up, fading in just below it; under the water, closer in.
<GeoTubes data={pipelines} reveal={{ minHeight: 20000, fade: 0.5 }} />
```

Revealed, it is projected onto the sea as a map: lifted to the sea's level where it lies
below it (`geo-reveal.glsl`, `geoRevealHeight`; for `GeoSymbols` in their matrices, so a
material of your own is lifted too), and drawn over the sea (`drawOverSea`: on
`LAYERS.OVERLAY`, which an `OITRenderPass` draws after the see-through layers, and at
`renderOrder` 999 without one, after the sea's surface). Nothing else changes: lying on the
sea, the water's dimming and cover leave it (`geoThroughWater`), depth puts it in front of
every seabed and behind the land and what stands out of the sea, and what lies past the
Earth's curve stays hidden. What lies on land stays where it is.

- **Fading in**, its alpha takes the share revealed; opaque tubes and symbols are left out
  by a screen door (a 4x4 Bayer pattern, `geoRevealDoor`), so they stay opaque. At 0 it is
  drawn as before, at its depth: the two are never drawn at once, so the swap is seamless
  where the sea is opaque — from a few kilometres up — and shows close up over clear water.
- **Where it lies on the map**, not in 3D: an outline 2.5 km down is drawn at the surface,
  over where it lies, so in an oblique view it does not meet a well's path at its depth.
  Data at different depths share the sea's level (tubes keep their volume; flat layers their
  lift toward the camera and their order).
- **Under land** it stays under it: lifted to the sea's level only.
- Only with `water` `'fog'` inside a `Scenery` with a sea; `'clear'` is always drawn as it is.

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
  as built and thins out of sight with distance, as any geometry does. Widened, never out of
  the water: on ground under the sea's level, what of its ring would rise over the surface is
  flattened under it (from 1400 km a 2 pixel tube is 3 km across, and stood up out of a 100 m
  sea along the horizon), by more than the depth buffer resolves there — as wide from above,
  under the sea from the side. On land it is round at any width.
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
  for again a tile at a time. Those lie on the ground of the relief's tiles in there instead
  (`groundGeoTubeNodes`, `SceneryReliefDrawn.heightAt`), the overview's past the far plane,
  coarser, so a pipeline on land stays on land: set when laid, and again as tiles come in or
  the relief chooses again, no more often than every half second; only those nodes are
  looked up. Without a relief, flat at `height`.
- **Free spans:** a stiff pipe rests on the high points and bridges the hollows (`span`,
  `smoothing`): the nodes closer than the span are marked `near` where they are laid — farther
  off a span is under a pixel — and rested on the ground on the main thread, where the
  relief's finest tiles in are (`liftGeoTubeNodes`: `SceneryReliefDrawn.heightAt`,
  `geoSpanLift`), again as finer tiles come in, without laying the nodes again; handed to the
  GPU per node, over the ground it reads.
- **Through the sea:** `water` `'fog'` dims it as the seabed under it (`geo-water.glsl`); like
  the seabed, it is gone where the sea turns opaque from a few kilometres up, and under the
  background's sea and seabed past a stage (see [Through the sea](#through-the-sea-water)).

## Points: `GeoSymbols`

Facilities, wells and buoys as 3D symbols: one `Symbols` instanced mesh, of any `geometry`
(default a disc a unit across) and `material`, each placed on the globe where it lies, upright
on the relief (the relief's ground on the CPU, `heightAt`, again as finer tiles come in), its
`size` in metres as it stands, `exaggeration` times as large. Never narrower than `minPixels`
on screen — **widened, never raised**, so a symbol on the seabed stays under the water from
afar. On the globe too: widened, its own material keeps each vertex as high over the globe as
built over the symbol's foot, so a wide one follows the curve rather than stand off it at its
rim (from 9000 km a 6 pixel disc is 60 km across, its rim 75 m over its foot's level), and the
water over it is taken at that height. Past the far plane it stands on the relief's tiles in
there (the overview's). With its own material the widening is the vertex shader's, so a symbol's matrix is made
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

Each feature's `text`, as a `Label` lying flat (read from above): a line's at the middle of
its longest part, points' at the first, reading east. On the globe by latitude and
longitude (`Globe.geodetic`, its normal and reading direction there), placed again when the
globe is. The rest is `LabelLayer`'s: kept apart on screen from every label layer's in the
scene (`priority` 0, over the graticule's names), faded when too small on screen
(`minPixels`), every `LabelStyle` option.

**In a polygon**, its name goes where it fits best (`geoPolygonLabelPlaces`): for each way
of breaking it into lines, up to `maxLines` (default 3; `labelTextVariants`, balanced:
`wrapLabelText`), the largest rectangle of that shape inside the polygon
(`polygonLabelPlaces`), its room the rectangle's, 85 % of it each way
(`GEO_LABEL_PADDING`), so the text keeps clear of the edge. The rectangle reads east, or,
with `turn` (default on), along the polygon's main axis (`polygonMainAxis`, its area's
second moments) where the polygon is elongated (1.5 or more) and that gives 1.25 times the
room (`POLYGON_LABEL_TURN_GAIN`): text reads best level. A way whose text could be no larger
than in fewer lines is left out, never drawn. Then, by `size`:

- **`'fit'`** (default; metres, `sizing` `'world'`): each name as large as it fits
  between `minSize` (150 m: smaller still, it overflows) and `maxSize` (3 km), in the fewest
  lines that make it so (more lines must make it 15 % larger) — but never drawn larger on
  screen than reads clearly: `maxPixels`, 18 CSS pixels by default
  (`GEO_LABEL_MAX_PIXELS`). Nearer, a name is held at that size rather than filling its
  polygon, and broken into fewer lines where the polygon then has room: every way is a
  `Label.places` entry, its room the polygon's (made as much larger where `minSize` makes
  the name overflow, so it is never shrunk below it), and the label group draws the first
  that fits at the size drawn.
- **On screen** (a preset, or `sizing` `'screen'` or `'auto'`; `'fit'` is then `'small'`),
  or **a number of metres**: every way is a `Label.places` entry, and the label group draws
  the first that fits at the size it is drawn, else the roomiest, shrunk to fit — again as
  the view zooms (see labels.md, *Wrapping and places*). Zooming out, names break into more
  lines, then shrink, then fade out once too small to read: a polygon labels itself only
  while its name fits in it. `maxPixels` is 18 by default in metres, none on screen (the
  size is on screen already).

The rectangle is `polygonLabelRect`: stretched along its angle by one over its aspect, a
rectangle is a square, and the largest square about a point inside the polygon reaches its
Chebyshev (L∞) distance to the edge — so the rectangle's middle is the polygon's pole of
inaccessibility in that norm, found as `polylabel` finds the Euclidean one
(`polygonLabelPoint`), with a binary heap, the distance to each segment exact (convex and
piecewise linear along it), segments whose box lies farther than the nearest so far
skipped. Its default precision is a twentieth of the stretched polygon's smaller side
(within 10 % of the best; never larger than fits). Rings are simplified to a fiftieth of
their size first (`simplifyRing`). Measured 2026-11-03 on the 598 discoveries (61 654
vertices; up to 3 ways each, two angles where elongated): 1.6 s as first written, with a
closure per segment, a sorted array for a queue and a hundredth's precision; ~95 ms now.
Still too long for one frame, so `GeoLabels` fits polygons a few at a time between frames
(4 ms a turn, `setTimeout`), handing its labels on as they come in (every 100 ms, and when
done): all 598 in about 0.7 s, no frame waiting on them.

**Over the relief**: each label lies at `height` (the sea's, by default), or over the highest
ground of the relief under it where that is higher (`useReliefCeiling`), placed again as the
relief's tiles come in, and is depth tested: ground between it and the camera hides it, the
ground under it never buries it. The highest ground is `reliefCeiling`'s: the most of the
relief hub's `rangeAt` over the geographic tiles about as large as the label's footprint (a
polygon place's room, or `labelReachEstimate` from a point's text and size), each from the
finest relief tile in there — never lower than the ground as drawn, as a tile's range holds
its nodes and a coarser tile's nodes average its children's. Over the sea it changes
nothing; over land a label floats over lower ground near a peak, at a slant by as much off
its place. A first version drew them without the depth test, over everything, as the relief
rose through them; they then showed through mountains in front of them as well. Lifted 5 m,
and 1 m more each kilometre off (`lift`, `liftPerDistance`), over the waves near the field
and clear of the sea far off. As every label layer's,
they turn to read left to right whichever way the camera looks (`flip`). Labels past the globe's horizon
face away from the camera and are not drawn.

Not drawn far off either: past `maxDistance` (default 150 km, fading over its last tenth,
`fadeDistance`) a label is dropped, and while none of a layer's could show — all past it, or
too small to read at the nearest any could be (`minPixels`) — the `LabelLayer` costs nothing
(`LabelBounds.reachable`: a sphere round its labels, their size at the least depth
in view). In the ground under them (see [When a layer is drawn](#when-a-layer-is-drawn)) the
layer is hidden: the void's lid leaves pixels to the background, which would not hide it.

Where polygons crowd, their names are kept apart on screen, the less wanted fading out
(see labels.md, *Overlap and priority*). For a label that keeps its size on screen and
follows something that moves, use an `Annotations` layer (as `TrackLayer` does).

## Tracks: `TrackLayer`

`Track`: an id, `longitude`, `latitude`, `speed` (m/s; `knots()` converts), `course`
(degrees from true north) and the `time` of the fix. The layer, each frame and without a
React render:

- carries each track on from its fix along its speed and course (`advanceTrack`, a rhumb
  line), unless `extrapolate` is off;
- turns it to its course in the scene (`courseToHeading`: a short step along the course
  carried into the scene, so the map's convergence is counted — 1.7° 2° east of the meridian
  at 58° N);
- eases into a new fix over `smoothing` seconds, its position (in degrees) and its heading
  the short way round, instead of jumping;
- moves what `children(track, ref)` attached to `ref`: its `position.x`, `position.z` and
  `rotation.y` only, and its `position.y` once, so a `Tanker`'s buoyancy keeps its own height,
  pitch and roll (its ref is its group).

A new fix is a new array with a changed track (another `time`, position, speed or course).
`annotations` puts a label per track on an `Annotations` layer, anchored to its object's
world matrix, so it follows it.

**Anywhere on the Earth.** Each object is drawn in a group of the layer's, which stands it
upright on the globe where its track is (`placeTrackOnGlobe`): the point the globe places at
its latitude and longitude on the sea's level (`Globe.geodetic`), turned from the scene's up
to the globe's up there by the least rotation (`globeUprightMatrix`, in the sdk). The
object's own X/Z stay the point's in the scene, and its heading is the course's step carried
onto the globe and turned back into the group. Over the globe's flat disc the group is the
identity, so a ship there is drawn exactly as flat; beyond it, it floats on the curved sea —
150 km out, 400 km out, or the mid-Atlantic seen from the North Sea (the `Ships` story's
`far`). No map is involved, unlike `Globe.tangent`, so it holds where the `World`'s
transverse Mercator does not (90° from its meridian); only at the disc's antipode is the turn
ill defined. Without a globe with a frame (a `Scenery` alone), flat on `frame`.

- **Waves far off:** `useBuoyancy` and the sea's contact foam take the object's X/Z and
  heading as the scene's, exact over the disc; far from it they follow the flat wave field,
  not the waves drawn there (see [world.md, 4d](./world.md#4d-the-waves-far-off-built-2026-10-27)), which shows
  only close up — where a `World` anchored at the target (`useTargetAnchor`) has the ship on
  its disc again.
- **Cost:** two `Globe.geodetic` and one `upAt` a track a frame. Each track is an object of
  its own: for thousands, instance them.

## Graticule: `GeoGraticule`

`<GeoGraticule>` draws lines on the Earth — latitude and longitude, the UTM zones and the
nautical time zones — each a width in screen pixels at any distance, from the field out to
the horizon and from space. A layer of its own since 2026-11-03 (it was `SceneryGraticule`,
drawn inside the `Scenery`'s sea, stage and relief shaders, built 2026-10-27): it needs no
`Scenery` and no relief.

```tsx
<World frame={frame} boundary={boundary}>
  <Scenery observer={observer}>
    <SceneryOcean />
    <SceneryStage />
    <GeoGraticule
      utm={{ color: '#ffd23f', thickness: 2 }}
      timeZones
      labels={{ latLon: true }}
    />
  </Scenery>
  <GeoRelief layers={layers} />
</World>
```

| Kind | Lines | Default |
|--|--|--|
| `latLon` | parallels and meridians every `interval` degrees; left out, following the zoom (below) | on |
| `utm` | the zones' edges every 6° from 80°S to 84°N, Norway's 32V reaching west to 3°E (56°N–64°N) and Svalbard's 31X, 33X, 35X and 37X edged at 9°, 21°, 33° and 42°E (72°N–84°N); and the latitude bands' parallels every 8° from 80°S, the last (X) 12° to 84°N | off |
| `timeZones` | the nautical time zones: meridians at 7.5° and every 15° from it, and the date line at 180° | off |

Each kind is `true` (its defaults), `false`, or `{ color, thickness, opacity }` (`latLon`
also `interval` and `minSpacing`): white, 1.5 pixels and 0.8 by default. The lines are the
SDK's pristine lines (`pristineLine`, `grid.glsl`, after Ben Golus's grid shader, as `Grid`
and `Surface` draw theirs), their width in screen pixels at any distance, measured by how
fast latitude and longitude change across the pixel (their screen derivatives, longitude's
unwrapped across 180°), so a line is as wide seen edge-on as from above. A set of lines
fades out only where it crowds too close to tell apart, from 6 pixels apart to none at 2:
toward the horizon, and meridians toward the poles. UTM lines go over the time zones', and
those over latitude and longitude.

**Following the zoom.** Without an `interval`, latitude and longitude take one step for the
whole view, the same for meridians and parallels everywhere on screen: the finest of 30°,
10°, 5°, 1°, 30′, 10′, 5′ and 1′ whose lines lie `minSpacing` pixels apart (default 120) on
the ground the view is centred on, and the next finer one fading in as its lines go from
half that apart to all of it (`graticuleStep`). The layer measures it each frame: the
distance along the view's centre to the sea (or, over the horizon, to the horizon), its
pixel's span there, and how foreshortened the ground is (the mean of along and across the
view), so an oblique view follows what it looks at, not what lies under it
(`graticuleViewDegreesPerPixel`, `graticuleDegreesPerPixel`). A first try chose the step pixel by pixel, each direction on
its own: at an angle the parallels, squeezed along the view, dropped to a coarser step than
the meridians, and lines went missing or half faded everywhere but from straight above.

**Where it lies.** A `GeoTileLayer` with no data (see
[The core](#the-core-geotilelayer)): each pixel's lines worked out from where it lies on the
Earth (`vGeoTileWorld`; `graticuleAt`, then `graticuleLines`, `graticule.glsl`), drawn over
everything see-through as a map is (`water` `'clear'`), tested against what is opaque.

- **In a `World` alone,** or with a `frame`: flat on the sea's level (`height`, default 0).
- **With a `GeoRelief` in the `World`:** on the land and the seabed as drawn (`drape`, on by
  default where there is a relief).
- **With a `Scenery`'s sea that has water** — inside the `Scenery`, or anywhere in its `World`
  (`WorldReliefState.sky`): on the sea's level over the sea and on the land above it (`floor`
  0), and hidden while the camera is under the sea's surface (`minHeight` 0 unless given one).
  With the water off, on the dry seabed. Inside the `Scenery`, hidden under the ground too
  (`layerShownAt`).
- **Out to the horizon,** past the camera's far plane (`reach` `'horizon'`): the whole Earth
  is lined from space.
- **Lifted toward the camera** (`lift`), not drawn on the waves: close up, waves higher than
  the lift may cut through it unless an `OITRenderPass` draws it after the sea
  (`LAYERS.OVERLAY`).
- **Past the far plane over land,** at the sea's level: it is not draped on the relief's
  overview (see [Not done](#not-done)). In a `Scenery` with the water off and no relief, at
  `height`, not on the stage's flat seabed: set `height` to its depth.

**Cost**, measured in the `Graticule` story (Iris Xe, 1 megapixel, 30 km over the North Sea,
latitude and longitude and the UTM zones): about 1.5 ms of GPU flat (`drape` false, 82k
triangles), 1.8 ms draped (118k), the frame about 14 ms against 11.2 without. Draped with a
floor, the tiles wholly at or below it — the open sea — are drawn flat in a draw of their
own, and only the coast and the land are draped: before that split, 330k triangles and
about 4 ms. Most pixels lie far from every line and skip the lines' work after one test per
kind (`graticuleClear`: exact, a line covers nothing past its width and its softening); each
pixel still works out where it lies. With no kind on, or hidden, nothing is drawn and no
tile chosen; the step and the origin are set once a frame on the CPU. Taken out of the
sea's, the stages' and the relief's shaders, the lines no longer cost them a uniform branch
and their code, nor the bakes a define of their own (`SKY_NO_GRATICULE`, gone).

**Labels** (`labels`, off by default): `true` names every kind drawn, or per kind
`{ latLon, utm, timeZones }`, each `true` or its own look; a kind not drawn is not named,
and each takes its lines' colour unless given its own (`graticuleLatLonLabels`,
`graticuleZoneLabelsOf`). Latitude and longitude's (`labels: { latLon: true }`): each line's name, `60°30′N`,
`2°E`, painted flat on the sea's level along it (a `LabelLayer`, see
[labels.md](./labels.md)), a parallel's in the middle of a cell along it, a meridian's in
the middle of a cell along it, at least `reach` lines (default 10) either way from where the
view is centred (`graticuleLabels`, named by `graticuleLabelText`: minutes and seconds only
as the step needs). **Every line is named**, each once every `k` cells along it: `density`
(0.1–1, default 0.5) sets `k` (`graticuleLabelPeriod`: 4 at 1, 8 at 0.5, 40 at 0.1). A
parallel's name reaches the meridians either side of it and a meridian's the parallels
above and below, so names closer than 4 cells along a line would meet across a crossing,
however placed. The names are spread by `graticuleLabelPattern`: parallel `i` in the
columns `≡ s·i`, meridian `j` in the rows `≡ t·j + h` (mod `k`), the pattern that never
meets and keeps every name farthest from every other, found once per `k` (`s` 3 for 8: a
lattice, where `s` 1 — the first try — set them in diagonal bands; `k` 4 and 6 allow
diagonals only). **Toward the poles** the meridians close in: the names' columns widen to
`m` meridians (`graticuleLabelThinning`, a power of two, so those named farther poleward
are among those nearer), once they would be closer than 4/5 of their spacing at the
latitude the font is sized at (the field's); a row between parallels of different `m`
names no meridians. Where they lie depends on the step, density and that latitude alone.
Their font is a fraction (`size`, default 0.18) of a cell's narrower side, the
east–west one, which shrinks with the cosine of the latitude (`graticuleLabelSize`): sized
by the step alone, a parallel's labels ran into each other end to end at 58°N. A test
keeps every label clear of every other at any latitude up to 88°, step and density, drawn
smooth too. They
follow **the step the lines are seen at**: the finer of the two drawn once its weight passes
0.55, back below 0.45 (`graticuleLabelStep`, `GRATICULE_LABEL_SWITCH`). Following the step
`graticuleStep` chooses, the coarser, they doubled — up to six times — as the view tilted,
while the finer lines, all but faded in, kept the cells the same on screen. `sizing`:
`'stepped'` (default) sizes them by that step, fixed between changes of it, so they stay
glued; `'smooth'` by the lines' spacing between their two steps on a log scale
(`graticuleLabelSpacing`), set on the GPU each frame (`LabelLayer`'s `scaleRef`), so they
scale with the cells and never jump, up to `GRATICULE_LABEL_SMOOTH_MAX` (1.6) times the
stepped size. They come and go with the lines but never slide, and the layer writes nothing
again while the nearest lines to the view's centre stay the same: where the view meets the
sea, or, looking past the horizon, the horizon the way it looks (`graticuleLabelCentre`),
where the step is judged then — centred under the camera, they were drawn at a step meant
for the horizon right below it, several times too large. In a label layer's default look
(a thin crisp halo, turned to read left to right; see labels.md), in the lines' colour,
never faded for being seen at a slant (`minFacing` 0, `GRATICULE_LABEL_STYLE`) but when too small on screen as seen
(`minPixels`, their slant included: toward the horizon they thin to slivers that would only
shimmer), and never drawn larger than 48 pixels (`maxPixels`: nearer, shrunk to it),
always centred (`align`, `baseline` and `offset`
fixed), lifted over the waves near the field (`lift`, 5 % of the font, 5 m at least). They
fade out just before the camera's far plane rather than be cut by it (see labels.md): a
farther plane shows them farther. Each lies at sea level or over the highest ground of the
relief under it, its text at its largest (`'smooth'`), as `GeoLabels`' do (`heightAt`,
`useReliefCeiling`): the plateau of southern Norway, 1–1.5 km high, buried the names lying at
sea level in all but its fjords, seen from 530 km up. Kept by their lines and places (`Label.id`) as
their heights change. Where labels meet on screen they give way to data labels (`priority` −1,
`GRATICULE_LABEL_PRIORITY`; see labels.md, *Overlap and priority*).

Found on the way: `globeSphereOffset` lost the latitude across the Earth from the field,
where `e² / (q + w)` rounds to nothing in 32-bit floats: speckled lines and missing
meridians along 180° seen from Volve. It is `w − q` there, written so neither cancels.

**Close in, the lines are measured from under the camera.** Latitude and longitude are near
1 radian, which 32-bit floats hold to about half a metre: a few hundred metres up, the
lines' offsets and their change over a pixel came in steps of that, and the lines broke
into parallel strands and dashes. Each frame the lines are drawn, `setGraticuleOrigin`
works out in 64-bit floats where the ground under the camera lies: its whole degrees and
what is left of them (`uGraticuleBase`), its offset on the globe's sphere
(`uGraticuleOrigin`), and the latitude's change as a series in the sphere's latitude
offset (`uGraticuleSeries`, three terms by central differences of
`Globe.sphereGeographicLatitude`). `graticuleAt` takes a pixel's latitude and longitude as
whole degrees plus what is left (`local`), from the sphere offset's difference — the
longitude in closed form, everywhere; the latitude by the series, within 0.03 rad (~190 km)
north or south of the camera — which 32-bit floats hold to a centimetre (a test emulates it
in `Math.fround`); farther north or south, from the latitude itself, where a pixel is far
larger than its error. Not limited by longitude: about a pole, ground a few kilometres off
lies at any longitude, and the latitude itself is coarsest there (an `asin` near 1: tens
of metres), so the ring around a polar cap came out grainy. Every line's offset is measured along `base + local` (`graticuleOffAt`): the whole
degrees brought to the nearest line first (exact for steps of whole degrees, none for
steps that divide a degree), then `local`; the UTM zones' and time zones' edges the same
way. Only the geometry's precision changed: still a geometric measure in each pixel, so
it holds with any depth buffer. ⚠️ Measured from the camera's longitude, a meridian may lie
a turn away from it: anything not reduced by a step that divides 360° (the UTM zones'
exceptions about Norway and Svalbard, at 3°, 9°, 21° and 33°E) is taken the shorter way
round (`graticuleFromLon`). Looking across the pole, they were 360° out and vanished.

**Toward the poles, cells keep their proportion.** Meridians close in by the cosine of the
latitude while parallels stay as far apart, so cells narrow to slivers: at 0.5° over 89°N,
720 meridians lay a kilometre apart (3–4 px from 174 km up), a moiré just above the
crowding fade. Now each band between two parallels draws every m-th meridian
(`graticuleMeridianThinning`): the least that keeps its cells at least half as wide as
tall (`GRATICULE_CELL_ASPECT`) where they are narrowest, at its poleward parallel. `m` steps
by twos or threes (`graticuleMeridianChain`), each dividing the meridians round the Earth
— so cells keep between ½ and 1.5 times as wide as tall, those kept meet themselves evenly
at the date line, and are among those kept nearer the equator — while four or more are
left (`GRATICULE_MIN_MERIDIANS`); past that, none: a plain cap. The band reaching the pole
keeps its meridians only if its parallel lies within 60° (`GRATICULE_POLE_CAP`; 30°: twelve
to the pole), else it is a cap too. Changing only at a parallel — the shader tells the band
by which side of the nearest parallel a pixel lies — the meridians are cut clean under it,
never faded. Judged on the ground, not on screen, so nothing pops as the view moves. So 10°
draws every 2nd from 60°, every 4th from 70°, none past 80°; 0.5° every 16th (8°) from
87.5°, 48th (24°) from 88°, 144th (72°) from 89°, none past 89.5°. Each step's chain (twelve at most,
`GRATICULE_THINNING_MAX`) is set with the step (`setGraticuleStep`, `uGraticuleThinning`),
the finer step's beside it, so the shader picks from it unrolled. The labels follow
(`graticuleLabelColumns`): their columns as wide as the meridians drawn either side, so a
meridian is named only where it is drawn, and a parallel in the middle of the narrower
drawn cell beside it. No parallel is drawn at a pole itself, a point that came out as a
ring a line wide. UTM and the time zones are left as they are (UTM stops at 84°N and 80°S
anyway).

Labels are drawn with the layer while it is `visible`, whatever its heights (`minHeight`,
`maxHeight`); each kind a `LabelLayer` of its own inside the `GeoGraticule`, placed by the
layer's globe and step — there is no label component to mount on its own.

**Zone names** (`labels: { utm: true, timeZones: true }`, off by default): the
UTM zones and the nautical time zones name areas, not lines, so each cell is named once, at
its middle, flat on the sea reading east (`graticuleZoneLabels`). UTM zones as their
projections are named, `32N`, `23S` (`utmZoneLabelText`), in cells by zone and latitude band
(`utmZoneCells`): every 6°, bands every 8° from 80°S, X 12° to 84°N, Norway's 31V/32V split
at 3°E and Svalbard's 31X, 33X, 35X and 37X (no 32X, 34X or 36X), as the lines draw them.
Time zones by their offset, `UTC+1`, `UTC−3` (a true minus), `UTC±0`
(`timeZoneLabelText`), 15° about every 15th meridian, the zone about 180° split at the date
line into UTC+12 and UTC−12, in the same rows as the UTM bands (`timeZoneCells`), so a
zone is named wherever along it the view is. Each name as large as `size` (0.18) of its
cell's narrower side, east–west at its poleward edge (`graticuleZoneLabelSize`), so it
fits its cell at any latitude: a label's own size (`Label.size`, see labels.md), the layer
at `size` 1. All of them at once — about 1200 UTM names, 500 time zones — made once for the
globe's place on the Earth, nothing written as the view moves; those facing away are not
drawn. Their look is latitude and longitude's (`GRATICULE_LABEL_STYLE` over a label layer's
defaults: flipped to read, 48 pixels at the most, depth tested), in their lines' colour, each
over the highest ground of the relief under it, lifted 5 m and 1 m more per
kilometre off, over the waves near the field and clear of the sea far off. Where labels meet
on screen they give way to latitude and longitude's (`priority` −2,
`GRATICULE_ZONE_LABEL_PRIORITY`); a UTM zone's and a time zone's name, of one priority,
keep whichever was shown first. Tests keep the
cells tiling 80°S–84°N without gaps, the exceptions as drawn, and every name clear of every
other and inside its cell.

## The minimap: `MinimapGeoLayer`

A `Minimap`'s layers render in a React root of their own and see no `World`: give it the
`frame`. Its features are carried to scene X/Z once (`geoFrameXZ`, densified every 0.05° so
long edges keep their shape), and their paths are written as the map changes: those off the
map emptied, vertices and points closer than a pixel dropped, and what is left cut to the
map and a margin (`minimapPathData`; see [minimap.md](./minimap.md)), so the scene's own data
is drawn as it is: no simpler copy is needed. Points are dots `radius` pixels across. `filter`
leaves out what would clutter a small map (the `Pipelines` story's subsea templates).

## Helpers (sdk)

`geoFeaturesFromGeoJson`, `densifyPlanarGeometry`, `projectGeoFeature`; `polygonLabelPoint`,
`polygonLabelRect`, `polygonLabelPlaces`, `polygonMainAxis` (where a label goes in a
polygon); `layerVisibilityAt`, `layerShownAt` (see [When a layer is drawn](#when-a-layer-is-drawn));
`advanceTrack`, `courseToHeading`, `knots`; `globeUprightMatrix` (what is drawn flat about a
point, stood upright on the globe there, through no map); `buildOverlayTile`,
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
(`sdk/tiles/tile-transitions.ts`: `TileTransitions`, `tileOffsetIn`); one quadtree layer
laid on another's tiles (`sdk/tiles/tile-cover.ts`: `tilesUnder`, `tileAncestors`,
`composeTileOffsets`); and the graticule's lines for any shader on the globe
(`sdk/materials/graticule.ts`: its uniforms, its step for a view, `graticuleStep`,
`graticuleViewDegreesPerPixel`, and where they are measured from, `setGraticuleOrigin`;
`shaderLib/graticule.glsl`: `graticuleAt`, then `graticuleLines`).

## Not done

- **On the land, through the air**: draped over land, a layer is not hazed with distance as
  the land is (`reliefThroughAir`); seen from space, not lit as the land is.
- **The relief past the far plane**: there only its overview is drawn. `GeoTubes` and
  `GeoSymbols` stand on its tiles' ground (`heightAt`, from the tiles in), but a draped
  `GeoTileLayer`, laid on the relief's tiles drawn, lies at `height` there; and what lies
  under the ground is hidden only below the sea's `depth` (`skyOceanCover`), not under the
  relief's own land and seabed. Reading the overview's index (`SceneryReliefAtlas`) per
  vertex would mend both.
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
- **Wells, surfaces and models on the Earth** as layers — a region's wells with their related
  data close up, surfaces in their own CRS, glTF models on the relief: a draft plan,
  [geo-subsurface.md](./geo-subsurface.md).
- Features across the 180th meridian.
- **The relief's own choosing** costs 3.6 to 8.5 ms of the main thread a frame in the same
  view, still or moving (`SceneryStageReliefTiles`, unchanged here): the same two steps — skip
  it while nothing changed, keep what does not depend on the camera — would help it too.
