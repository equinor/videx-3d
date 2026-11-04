# GeoMap: a map of the Earth, on its own or over the 3D view

`GeoMap` is a 2D map: the relief drawn top-down from the same tiles as a `GeoRelief` (see
[relief.md](./relief.md) and [tiles.md](./tiles.md)), shaded by the ground's slope or as an
outline, in the scene's own map or a projection of the whole world, with layers over it. It
fills its container — a page, a `Panel`, an `Overlay` item — and draws on a canvas and a WebGL
context of its own, only when its view changes or tiles come in, so it costs no frame of the 3D
view's. It needs no 3D view at all: a map page of its own is a `GeoMap` in a `div`.

A `Minimap` ([minimap.md](./minimap.md)) is a `GeoMap` in a resizable, closable panel, with a
`GeoMapCamera` in it following the camera.

```tsx
// A map of its own, filling the page.
<GeneratorsProvider registry={registry /* with the sceneryReliefTile generator */}>
  <div style={{ position: 'fixed', inset: 0 }}>
    <GeoMap frame={frame} layers={reliefLayers} defaultView={{ center: [2, 58.4], extent: 400000 }}>
      <GeoMapGraticule latLon labels />
      <GeoMapPolygons {...discoveries} />
      <GeoMapPoints points={[{ at: [0, 0], label: 'Volve' }]} />
    </GeoMap>
  </div>
</GeneratorsProvider>

// Over the 3D view, filling it, with the camera on it: in an Overlay in the World.
<Canvas>
  <World frame={frame}>
    <Overlay>
      <OverlayItem anchor="fill">
        <GeoMap layers={reliefLayers}>
          <GeoMapFields />
          <GeoMapCamera>
            <GeoMapTargetMarker />
            <GeoMapCameraMarker />
          </GeoMapCamera>
        </GeoMap>
      </OverlayItem>
    </Overlay>
  </World>
</Canvas>
```

Story: `Components/Html/GeoMap` (`src/components/Html/GeoMap/GeoMap.stories.tsx`), a map of
its own with no 3D view; `Components/Html/Overlay`, a full-view map over the 3D view.

## What it shows

- **The relief**, as a `GeoRelief` takes it: `layers` (ids coarse to fine, `feather` as the
  stage's) and `depth` (the flat seabed where no layer has data, default 100 m), merged onto the
  relief's geographic tiles by the `sceneryReliefTile` generator (`buildGeoReliefTile`) exactly
  as the scene's are; coloured by `color`, `contours` and `layerLooks` (default the terrain ramp
  over the bathymetry ramp). The two take the same props (`ReliefSourceProps`,
  `ReliefLookProps`): give one object to both and the map shows the scene's ground as the scene
  colours it. Both draw from `useReliefLooks`, which writes the looks texture by value. Without
  `layers`, or without a `GeneratorsProvider`, no relief is drawn: the `background` shows.
- **The tiles it reads** (`selectGeoMapTiles`): over what it shows, down to the depth whose
  cells span at most `cellPixels` device pixels (default 2; `geoTileDepthFor`) — no finer than
  half its slots hold — or one level past a tile with no finer data under it (`pastLeaf`). A
  tile is gone into only once it is in, so the map fills in from the roots, coarse to fine, and
  where a tile is not in yet its nearest ancestor that is stands in. The tiles' heights, normals
  and layers are kept in texture arrays of the map's own (`SceneryReliefTileTextures`), and the
  fragment shader (`geo-map-fragment.glsl`) reads the ground per pixel through an index of the
  tiles drawn (`relief-atlas.glsl`, `SceneryReliefAtlas`, about the view's middle so it keeps
  its precision at metre-sized cells), bilinear between their nodes.
- **`mode="shaded"`** (default): colour by height, lit from the upper left of the screen by the
  slope, from the tiles' normals filtered between their nodes as the stage shades them
  (`shading.exaggeration` 2, `shading.strength` 0.8). **`"outline"`**: the coast (where the
  height crosses the sea's level, one pixel wide), the contours if the look has them, over a
  faint land fill (`outline`).
- **Its frame**: `frame`, or the enclosing `World`'s. Without one it draws nothing (and warns).

## The view

The view is a longitude and latitude at the middle, an extent (ground metres across the map's
shorter side) and a rotation (radians clockwise from north to up): `GeoMapView`. The middle is
geographic, not scene X/Z, so a map in a projection of the whole world pans anywhere on the
Earth — to the other side of it, where the scene's own map does not reach.

- **Controlled or not**: `view` (changes to it are eased into), or `defaultView` (default 50 km
  across the frame's origin); `onViewChange` is told the view once a pan or a zoom by the user
  has settled — not on every frame of it. A ref (`GeoMapHandle`) reads and sets it:
  `getView()`, `setView(view, animate)`, `zoomBy(factor)`.
- **Limits**: `minExtent` (default 100 m) and `maxExtent` (default 40 000 km); a zoom eases over
  `smoothing` seconds (default 0.2, to close all but 1/e of it), in log space.
- **North up**: in the scene's map, its grid north; in a projection, true north. The compass
  turns with the map; a click on it turns the map north up again (`onCompassClick` to do
  otherwise, as a minimap toggles heading-up).

## Interaction

- **Drag** (the left button, or a finger) pans it: the ground under the pointer follows the
  pointer (`mapViewLonLatAt`, in any projection). A map following something (a `GeoMapCamera`
  with `follow`) is dragged off what it follows, and eases back when let go.
- **The wheel** zooms `'smooth'`ly about the pointer — the ground under it stays under it while
  the zoom eases (`mapViewZoomAt`) — or by `'steps'` (`onStepZoom`, the host's levels, else half
  and double), or not at all (`wheel`). A trackpad's flicks add up to a step.
- **Pinch** zooms about the fingers' middle; **a double click** zooms in about the pointer, with
  Shift out (`doubleClickZoom`).
- **Keys**, the map focused (`keyboard`): the arrows pan an eighth of it, + and − step the zoom.
  The map is an `application` to assistive technology (`aria-roledescription="map"`).
- **The scene does not hear it.** Over the 3D view, in an `Overlay` or a `CanvasHtml`, a press,
  a wheel or a click on the map does not reach the scene's controls (see
  [overlay.md](./overlay.md)).

## Projection

`projection` is what the map is drawn in:

| | |
|--|--|
| `'scene'` | the scene's own map: the `frame`'s projection, a transverse Mercator such as UTM. What the 3D view shows; true to scale for a few hundred kilometres about it, and ever more distorted past that. Past 500 km across it is drawn on a finer grid, and where the map stops holding — a point does not come back through it, or a cell spans its far meridian or a pole — it is left out, the background showing, rather than smeared. |
| `'web-mercator'` | conformal: shapes and bearings hold, but areas grow toward the poles (twice as wide at 60°) and it ends at 85.05°. |
| `'equal-earth'` | equal-area: the whole world, every region its true size against the others; shapes squeezed toward the poles, which are lines on its rounded outline. |
| `'lambert-conformal-conic'` | conformal, and nearly true to scale between its two standard parallels: a region wider east–west than north–south at middle latitudes. Its parallels follow the view — a sixth of the map in from its top and bottom (`lambertParallelsFor`) — unless fixed with `lambertParallels`; its origin is the middle's parallel. |
| `'auto'` (default) | the scene's map up to `globalFrom` (default 2000 km across), `globalProjection` (default `'web-mercator'`) past it, and back below 80 % of it. |

- **About the middle.** A projection's plane (`mapPlane`) is centred on the meridian under the
  map's middle, so the antimeridian is its edge, never a seam across it. The view
  (`geoMapView`) keeps its middle, its ground metres a pixel there (the scale bar is true
  there), and its way up.
- **Layers need nothing.** Points in scene X/Z go through the frame and the projection
  (`mapViewToPixel`); points in longitude and latitude straight into the plane
  (`mapViewLonLatToPixel`, `mapViewGeoPixel`), so data far from the scene lands where it is.
- **Drawn per pixel.** The grid's vertices carry their longitude and latitude, and their point
  of the plane, from which the fragment shader masks off what lies past the projection's
  outline. Past 100 m a device pixel they are worked out per pixel from the plane
  (`geoMapLonLat`, each projection's inverse in GLSL). Tiles are chosen by each one's own scale:
  Web Mercator toward the poles gets finer ones.
- **A change cross-fades** over `GEO_MAP_PROJECTION_FADE` (0.3 s): both views are drawn, added
  premultiplied. The layers move to the new one at once.
- **The zone's bounds.** In the scene's map a dashed outline marks the zone it is laid out for:
  by default the `frame`'s UTM zone (`zoneBounds` to give another, `false` for none;
  `zoneColor`). It is hidden in a projection.

## Layers

Children are drawn over the relief: on two 2D canvases, or in an SVG over them. Moving, the map
draws them without a React render: they are told the map's state (`GeoMapState`: its view,
extent, compass angle, projection, the frame's conversions, the camera with a
`GeoMapCamera`, and `labelSpacer`, which every layer's labels on a canvas take their room
from — so no label covers another, the layers drawn first winning, nor the map's own compass,
buttons and labels).

- **The canvas** (`useGeoMapCanvasLayer(draw, { tier, order })`, `GeoMapCanvasLayer`): `draw(ctx,
  state)` in the map's CSS pixels, called when the map changes and when the layer asks
  (`invalidate`). Two tiers: `'features'`, drawn again when the map moves or a layer changes;
  and `'live'`, over it, drawn again also as the camera moves (the camera's cone, tracks), so a
  still map whose camera moves does not redraw its features. By `order`, then in the order they
  came. A tier with no layers is not composited.
- **SVG** (`GeoMapSvgLayer`, `useGeoMapFrame`): for the few things that take pointer events —
  the camera's and the target's markers, dragged and dropped. Many things are far cheaper on
  the canvas.
- **Ready-made, in scene X/Z**: `GeoMapPoints` (dots with labels that keep out of each other's
  way), `GeoMapPolyline` (a line or a filled outline, dashed or not).
- **The helpers** (`sdk/layers/map-draw`, free of three.js): `traceMapPixels` (a path cut to
  the map), `mapViewGeoLine` (a line of the Earth in pixels, vertices closer than a pixel
  dropped), `mapViewLonLatBox` and `lonLatBoxesMeet` (what the map shows, to pass over what it
  does not), `paintMapPath`, `drawMapLabel` and `MapLabelSpacer` (labels that do not overlap).
- `useGeoMap()` (`project`, `projectLonLat`, `unproject`, `state`) for your own.

⚠️ **Cut paths to the map.** A canvas, as a browser does an SVG path, strokes, dashes and fills
a path at its full length, off the map or not. Zoomed in to a kilometre, a route running on past
the map reaches a million pixels beyond it: when the minimap's layers were SVG, the `Pipelines`
story's routes took 120–160 ms a frame while the camera moved, and 17 ms once cut. The
ready-made layers write only what lies on the map and a margin round it (`traceMapPixels`,
`mapClipRect`). A layer of your own drawing long paths should do the same.

```tsx
const Rings = ({ at }: { at: [number, number] }) => {
  const draw = useCallback<GeoMapCanvasDraw>((ctx, { view }) => {
    const [x, y] = mapViewToPixel(view, at[0], at[1]);
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    paintMapPath(ctx, { stroke: '#ff5a36', strokeWidth: 2 });
  }, [at]);
  return <GeoMapCanvasLayer draw={draw} />;
};
```

## The scene's layers on a map

Each of the scene's geographic layers has a twin on the map that takes the same props: its
data, its style and its band of camera heights. Declare the data once, as an object, and give
it to both:

```tsx
const discoveries = {
  data,
  style: (f: GeoFeature<Discovery>) => ({ fill: f.properties.gas ? '#e5383b' : '#2fbf4a' }),
  maxHeight: 1500000,
};

<World frame={frame}>
  <GeoPolygons {...discoveries} />           {/* in the scene */}
  <Overlay>
    <Minimap layers={reliefLayers}>
      <GeoMapPolygons {...discoveries} />    {/* on the map */}
    </Minimap>
  </Overlay>
</World>
```

| scene | map | drawn as |
|--|--|--|
| `GeoRelief` | `GeoMap` itself (`layers`, `depth`, `color`, `contours`, `layerLooks`) | the relief, shaded or as an outline |
| `GeoPolygons` | `GeoMapPolygons` | filled and outlined (`strokeWidth` in pixels) |
| `GeoTubes` | `GeoMapLines` | lines `strokeWidth` pixels wide, over a dark casing (`casing`); a width per feature |
| `GeoSymbols` | `GeoMapSymbols` | dots `radius` pixels across; a radius per feature |
| `GeoLabels` | `GeoMapLabels` | text with a halo: a polygon's where it has the most room (`polygonLabelPoint`), a line's at its middle, a point's beside it; left out where one would cover another |
| `GeoGraticule` | `GeoMapGraticule` | latitude and longitude by the same steps (`graticuleStep`), thinned toward the poles as the scene's are (`graticuleMeridianThinning`); the UTM zones' edges; the time zones' meridians; named along the edges and in the cells |
| `TrackLayer` | `GeoMapTracks` | an arrow per track turned to its course, carried on between fixes by the same dead reckoning (`advanceTrack`), its annotation's text beside it; drawn again five times a second while they move |
| the `World`'s fields | `GeoMapFields` | each `UtmArea` with a `boundary` where it lies now, and the anchored stage's area highlighted |

- **What shows when.** A twin takes the scene layer's band of camera heights (`minHeight`,
  `maxHeight`, `fade`) to the extents a map shows from those heights
  (`layerExtentVisibilityAt`): `heightPerExtent` times them, 4 by default — a minimap's
  `autoZoomFactor`, so an adaptive minimap shows a layer when the scene does. Give `minExtent`
  and `maxExtent` for a band of its own.
- **Map-only options**: `filter` (what would clutter a small map: subsea templates under their
  platforms), `order`, the widths and radii in pixels.
- **Carried once.** A twin densifies its features every 0.05° and carries them to scene X/Z
  once, for the scene's map; in a projection they go straight into its plane. Each frame it
  passes over the features off the map (by their bounds) and the vertices closer than a pixel,
  so the full data stays cheap at any extent: no simpler copy of it is needed.
- **Nothing is mirrored for you.** A map shows what is declared in it: a minimap and a full
  map may show different layers of the same scene.

## The camera: `GeoMapCamera`

A `GeoMapCamera` in a map shows the 3D view's camera on it, and moves it. It needs the
`Canvas`'s contexts: the map in an `Overlay` or a `CanvasHtml` (or a `Minimap`, in one of
them).

- **Markers**: `GeoMapCameraMarker`, the camera's arrow turning with its heading, with its
  horizontal field of view as a cone round it (`shape` `'cone'`, `'circle'` or `'none'`); and
  `GeoMapTargetMarker`, what it looks at — the controls' target dropped to the sea's level, or
  where the view ray meets it without controls. The cone reaches as far as the map's scale bar
  measures (`mapScaleBar`), so it reads as the distance the bar shows at every zoom; `radius`
  gives metres of its own. It is laid out on the ground and carried onto the map
  (`mapViewCone`): its angle is the camera's even where the map is not conformal. The cone is
  drawn on the live canvas, the arrow and the crosshair in the SVG.
- **Following**: `follow` `'camera'` or `'target'` centres the map on it; `extent` holds a
  number of metres across, or `'auto'` follows the camera's height (`autoZoomFactor` times it,
  within `autoZoomRange`); `headingUp` turns the camera's heading up. Following starts at the
  extent asked for at once.
- **Dropping a marker** moves the scene's controls (`dragControls`; `onMarkerDrop` told
  either way): the camera's arrow flies the camera there, its target along, the view the same
  from the new place (`setLookAt` on drei's `CameraControls`; an `OrbitControls` is set
  directly: `setCameraPose`); the target marker re-aims the camera. Heights are kept. A marker
  is grabbed within 12 pixels of its centre, no further than half way to the other one; the map
  holds still under it while it is dragged; dropped outside the map, or with Escape, nothing
  moves. Without controls the markers cannot be dragged.
- **Home**: its ref's `home()` flies the camera back to `home`, or the pose it had at the first
  frame.
- **Each frame it costs nothing while the camera does not move**: it compares the camera, its
  target and its field of view with the last frame's before doing anything. When they move it
  tells the map, which draws in the same frame as the 3D view, so the map does not lag it.

Heights (the auto zoom, a minimap's readout) and the camera's place on the map are the globe's
in a `World` (`globeMapSurface`): far from the field the sea curves below Y = 0, and the map's
point under the camera is its foot on the globe. Without a `World`, the plane Y = `level`.

## Its own items

`compass`, `controls` (`'zoom-in'`, `'zoom-out'`; `buttons` of your own after them),
`extentLabel` (the ground across the map) and `scaleBar` (a round length, 1, 2 or 5 times a
power of ten, about a quarter of the width and at least 72 pixels: `mapScaleBar`). `items` adds
your own, placed with them. `layout` places each at an anchor — a corner or the middle of an
edge — stacked by `order`, the lowest nearest the edge (`resolveAnchorLayout`, shared with the
`Overlay`): by default the compass top left, the buttons top right, the extent bottom left, the
scale bar bottom right. All the labels share one look: sharp white text with a hard one-pixel
outline, and change the page only when their text does.

## Costs and limits

- **On demand.** It draws on an animation frame of its own, only when something changed — a
  move, a tile in, a layer — and not at all while it is off the page (`IntersectionObserver`).
  A camera following it draws it in the 3D view's frame instead.
- **A WebGL context of its own**, holding its own tiles on the GPU: 512 slots of about 11 KB
  (under 6 MB) for a small map, growing with its size to two and a half times the tiles a view
  across it shows, at most 2048 (about 22 MB) and what the GPU allows (`geoMapTileSlots`):
  grown, its texture arrays are made again and the tiles in put back. Browsers limit contexts,
  so it is given back (`forceContextLoss`) on unmount; a context the browser takes back is made
  again, its tiles loaded again.
- **A pixel budget**: the relief is drawn with at most `maxPixels` device pixels (default 4
  million), a larger map at a lower pixel ratio — a full-screen map at 1920 × 1080 on a display
  of ratio 2 at about 1.4 — so it costs what a mid-range laptop can give. The canvases' layers
  stay at the display's ratio (up to 2), sharp.
- **The shader** reads the ground once a pixel, shaded, and its normal; five times in outline
  mode, for the coast between neighbours. Its grid is drawn from one index buffer, the cells
  kept written to its front.
- Its tiles come from the same generator as the scene's, at most two at a time, so the scene's
  come first; on the same worker they share its block cache.
- The colour ramps and the looks are drawn from textures of the map's own that share their
  data: three keeps every renderer a texture was uploaded to alive through a listener on it, so
  sharing the scene's own would keep each disposed map's renderer alive.
- Across the 180th meridian it takes the tiles either side, each about the view's middle the
  short way round (`geoTileSquareFrom`).
- **Not done**: picking features on the map (a click on a polygon), drawing the twins' data in
  the map's WebGL context for very large data sets, and a rotation gesture.
