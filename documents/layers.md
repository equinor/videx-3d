# Geographic layers: polygons, labels and tracks

Data of your own, in longitude and latitude, laid over the world: licences, fields,
discoveries and safety zones as polygons; their names; ships and vehicles from a tracking
feed. Each layer places itself by latitude and longitude — on a `Scenery`'s globe when there
is one, else flat on the `World`'s frame — and **needs no relief**: with one, without one, or
with no `Scenery` at all.

```tsx
<World frame={frame}>
  <Scenery>
    <SceneryOcean />
    <SceneryStage bounds={bounds} relief={{ layers }} />
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
`Discoveries` and `Discoveries (World only)`) and `Components/Layers/Tracks` (`Ships`).

## The pieces

| piece | draws | how |
| --- | --- | --- |
| `GeoPolygons` | polygons, filled and outlined, at a height over the sea | geographic tiles of its own: a distance field per tile, drawn on the globe |
| `GeoLabels` | a label per feature, flat inside a polygon | a `LabelLayer`, placed on the globe |
| `MinimapGeoLayer` | the same features on a `Minimap` | SVG paths, carried to scene X/Z once |
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

## Polygons: `GeoPolygons`

Drawn from **geographic tiles of their own** (the relief's quadtree, `geo-tile-keys`), not
from meshes of the polygons:

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
  globe or the height. A view held still costs nothing. Each tile's bounds — flat, at a
  fixed height, on a globe placed once — are kept between frames (`OverlayTileBounds`), so
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
- **Drawn** as one instanced flat patch (16 x 16 cells) per tile, each node placed on the
  globe by its latitude and longitude (`globeGeodetic`, through `geo-tile.glsl`, which the
  relief's tiles share), `height` metres over the sea's level, then moved toward the camera by
  `lift` + `liftPerDistance` x distance — a move, not a depth bias, so it holds with a linear,
  logarithmic or reversed depth buffer.
- **The fragment shader** draws the fill's edge from R (anti-aliased by `fwidth`) and an
  outline `strokeWidth` pixels wide inside it, coloured by the polygon on top: its `fill`,
  `fillOpacity`, `stroke` and `strokeOpacity`, from a small texture of styles by id.
  Where polygons overlap the later one's fill is on top, and every outline shows.
- **On top of the see-through**: on `LAYERS.OVERLAY` (after the transparent layers with an
  `OITRenderPass`, at `renderOrder` 999 without), tested against what is opaque, not picked.

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
| **tiles of its own** | the surface is the overlay's own: flat at a height, so it needs no relief; on the ground it needs one more step (below) |

## Labels: `GeoLabels`

Each feature's `text`, as a `Label` lying flat (read from above, reading east): a polygon's
at the point inside it farthest from its edge (`geoFeatureLabelPoint`, `polygonLabelPoint`:
inside however concave), a line's at the middle of its longest part, points' at the first.
`size` `'fit'` (default) sizes each to the room it has there, between `minSize` and
`maxSize` metres. On the globe by latitude and longitude (`Globe.geodetic`, its normal and
reading direction there), placed again when the globe is. The rest is `LabelLayer`'s: one
instanced draw, faded when too small on screen (`minPixels`), every `LabelStyle` option.

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
map emptied, points closer than a pixel dropped.

## Helpers (sdk)

`geoFeaturesFromGeoJson`, `densifyPlanarGeometry`, `projectGeoFeature`; `polygonLabelPoint`;
`layerVisibilityAt`; `advanceTrack`, `courseToHeading`, `knots`; `buildOverlayTile`,
`packOverlayShapes`; `geoFrameXZ` (the reverse of `geoFrameLonLat`); the geographic tiles
on a globe, shared with the relief (`sdk/tiles/geo-tile-globe.ts`: `geoTileLayout`,
`geoTileOffsets`, `geoTileSquare`, …) and its GLSL (`shaderLib/geo-tile.glsl`, with
`geoTileFrom`); and soft swaps between levels of detail for any quadtree
(`sdk/tiles/tile-transitions.ts`: `TileTransitions`, `tileOffsetIn`).

## Not done

- **Polygons on the ground** (`height` follows the relief): a relief-backed height for the
  overlay's patch, given by the stage as an optional provider, so the layer still does not
  depend on it. The overlay's tiles then also split by the relief tile's error, so its
  surface stays within the relief's `pixelError` of what the relief draws, and the lift
  covers the rest. Labels on the ground would ask the worker (`sampleReliefSource`) rather
  than pin tiles under hundreds of features.
- **On the sea's own surface**: polygons are drawn over the sea, lifted; waves higher than the
  lift show through close up. In the sea's shader they would lie on the waves.
- **Lines** in the overlay (an unsigned distance channel per tile), and **picking** by the
  id channel.
- **Instanced tracks** for large fleets, and a time scale for replaying a feed.
- Polygons across the 180th meridian.
- **The relief's own choosing** costs 3.6 to 8.5 ms of the main thread a frame in the same
  view, still or moving (`SceneryStageReliefTiles`, unchanged here): the same two steps — skip
  it while nothing changed, keep what does not depend on the camera — would help it too.
