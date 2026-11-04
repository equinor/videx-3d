# Minimap: an inlet map that follows the camera

`Minimap` is a small map over the 3D view that follows the camera: a `GeoMap`
([geo-map.md](./geo-map.md)) with a `GeoMapCamera` in it, in a `Panel` that can be resized by
its edges and closed into a button ([overlay.md](./overlay.md)). The relief shaded or as an
outline, centred on the camera or what it looks at, zoomed by level or by the camera's height,
north-up or heading-up, with layers of your own; dragged, it looks around and eases back; its
markers dropped on it fly the camera there.

```tsx
<World frame={geoFrameFromCrs(crs)}>
  <GeneratorsProvider registry={registry /* with the sceneryReliefTile generator */}>
    <Canvas>
      <Overlay>
        <Minimap
          anchor="bottom-right"
          layers={[{ id: 'etopo-2022-nordic' }, { id: 'emodnet-2020-volve', feather: 500 }]}
          width={240}
          height={240}
        >
          <GeoMapTargetMarker />
          <GeoMapCameraMarker />
          <GeoMapPoints points={[{ at: [0, 0], label: 'Volve' }]} />
        </Minimap>
        <AltitudeControl anchor="left-center" />
      </Overlay>
    </Canvas>
  </GeneratorsProvider>
</World>
```

Story: `Components/Html/Minimap` (`src/components/Html/Minimap/Minimap.stories.tsx`). The
stories with a `Scenery` (`Components/Misc/Scenery`, `Components/Layers/Tracks`, the
`Spikes/Scenery` ones and `Spikes/Chunks/FieldColumn`) have a `minimap` switch, off by default:
`SceneryArgsMinimap` (`src/storybook/components/scenery-features.tsx`), the minimap's defaults
and a camera marker over the ticked demo reliefs, in an `Overlay` of its own, bottom right.

## Where it sits

It is HTML that follows the 3D view's camera, so it needs the `Canvas`'s contexts, and is not
a 3D object: render it in an `Overlay` or a `CanvasHtml`, not directly in the `<Canvas>`.

- **In an `Overlay`**: at its `anchor` (default its `origin`, `'bottom-right'`), among the other
  items there by its `order`.
- **In a layout of your own** (a `CanvasHtml`, over the view or in an element of the page
  beside it; see [overlay.md](./overlay.md#without-the-overlay-a-layout-of-your-own)): at its
  `origin` corner of its container, `offset` pixels in, or `inline`, in the flow of your
  layout. Either way its resize handles face away from `origin`, and closed, its button is
  where it was.

Wherever it is, it is inside the `World` (its `frame`, its globe), and a `GeneratorsProvider`
with the `sceneryReliefTile` generator, as a `GeoRelief` is.

## What it shows

What a `GeoMap` shows, and as it takes it (see [geo-map.md](./geo-map.md)): the relief from
`layers` and `depth`, as a `GeoRelief` takes them, looked by `color`, `contours` and
`layerLooks`; `mode`, `shading`, `seaColor`, `outline`; in the scene's map or a projection
(`projection`, `globalProjection`, `globalFrom`, `lambertParallels`), with the zone's outline
(`zoneBounds`); its compass, its scale bar and its extent. Its layers are a `GeoMap`'s: the
camera's markers, `GeoMapPoints`, `GeoMapPolyline`, the twins of the scene's layers
(`GeoMapPolygons`, `GeoMapLines`, …: give them the same props as the scene's), your own.

- **Centred** on the camera, or on its **target** (`center`, `defaultCenter`,
  `onCenterChange`; the button showing the marker it is centred on toggles it): what the
  camera looks at, on the sea's level. The camera's arrow is then off the middle, and the
  target's marker in it.
- **North-up** or **heading-up** (`orientation`, `defaultOrientation`,
  `onOrientationChange`): the compass turns with the map, and a click on it toggles the two.
- **The altitude readout** (`altitude`, on by default), top centre: the height over the sea of
  what the map is centred on. A display only: the altitude control is a gadget of the overlay
  now (`AltitudeControl`, see [overlay.md](./overlay.md)).
- **The camera's cone** (`GeoMapCameraMarker`) reaches as far as the scale bar measures: it
  reads as the distance the bar shows, at every zoom; `radius` gives metres of its own.

## Zoom

`zooms` are the host's own extents in metres across the map's shorter side, ascending: any
list, with the default (1, 5, 25, 100 and 1000 km) only when none is given. The map zooms
between the least and the most of them.

- **`zoom="auto"`** (the default): the extent follows the camera's height over the sea
  (`level`, the sea's Y): `autoZoomFactor` (4) times the height, between the least and the
  most of `zooms`, eased in log space over `autoZoomSmoothing` seconds. At 2.5 km up the map
  is 10 km across; from 250 km up, the most the list has.
- **a number**: an index into `zooms`. The + / − buttons and the wheel (`wheelZoom`) step one
  level from the map's own (from the adaptive extent when auto) and A returns to auto.
- Controlled with `zoom` and `onZoomChange`, or uncontrolled with `defaultZoom`.
- The layers' bands of camera heights are taken to extents by the same `autoZoomFactor`, so a
  layer shows on an adaptive minimap when it shows in the scene.

## Moving around, and moving the camera

- **Drag the map** (the left button, or a finger) to look around (`pan`, on by default): it
  follows the pointer, and eases back to what it is centred on when let go. The camera does not
  move. The markers are taken first.
- **Drop a marker** to move the camera: the camera's arrow flies the camera there, its target
  along; the target marker re-aims it (`dragControls`, `onMarkerDrop`; see
  [geo-map.md](./geo-map.md#the-camera-geomapcamera)).
- **Double-click the marker button** to fly the camera and its target back home: `home`, or the
  pose the controls had at the first frame. Zoom, orientation and centre are kept (the two
  clicks toggle the centre twice). It needs controls, like a drop.

## Resized, and closed

- **Resized** by dragging its edges and its corner away from where it sits (`resizable`, on by
  default, at least 120 × 120): `width` and `height` are where it starts, `size` and
  `onSizeChange` control it. The map follows as the panel is dragged.
- **Closed** into a button where it sat, a folded map (`closable`, on by default; the `'close'`
  button, ×), which opens it again (`collapsed` for its own look, or another place). Closed,
  the map is unmounted: its WebGL context given back, its tiles let go, nothing done per frame —
  it costs nothing. It keeps its size, zoom, orientation and centre for when it opens; its tiles
  load again then, mostly from the worker's block cache. `open`, `defaultOpen` and
  `onOpenChange` control it.

## Buttons and layout

`controls` says which buttons to show, in which order: `true` (all of `MINIMAP_CONTROLS`:
`'zoom-in'`, `'zoom-out'`, `'zoom-auto'`, `'center'` and, closable, `'close'`), `false`, or a
list. `compass` shows or hides the compass.

`layout` places its items — `compass`, `altitude` (the readout), `controls`, `extent` and
`distance` (the scale bar) — each `{ anchor, direction, order }`: a corner or the middle of an
edge, how the buttons flow (a row or a column) and, among the items at one anchor, its order,
the lowest nearest the edge (`resolveAnchorLayout`). The defaults: the compass top left, the
readout top centre, the buttons top right, the extent bottom left, the distance bottom right.

## From the earlier minimap

| was | now |
|--|--|
| `MinimapCameraMarker`, `MinimapTargetMarker` | `GeoMapCameraMarker`, `GeoMapTargetMarker` (in a `GeoMapCamera`; a `Minimap` has one) |
| `MinimapPoints`, `MinimapPolyline` | `GeoMapPoints`, `GeoMapPolyline` (on the canvas; `dash` a list of numbers) |
| `MinimapLayer` | `GeoMapSvgLayer`, or `GeoMapCanvasLayer` for drawing on the canvas |
| `MinimapGeoLayer` | the twins of the scene's layers: `GeoMapPolygons`, `GeoMapLines`, `GeoMapSymbols`, `GeoMapLabels` — the same props as the scene's |
| `useMinimap`, `useMinimapFrame`, `MinimapState` | `useGeoMap`, `useGeoMapFrame`, `GeoMapState` (the camera in its `camera`) |
| `minimapPathData`, `minimapClipRect` | `mapPathData`, `traceMapPixels`, `mapClipRect` (`sdk/layers/map-draw`) |
| `altitudeControl` | the `AltitudeControl` gadget, in the overlay |
| `base` | `depth` (metres below the sea), as a `GeoRelief`'s |
| `radius: { fraction }` on the camera marker | the scale bar's length by default; `radius` in metres |
| the right mouse button pans | the left (or a finger), easing back |
| `origin`, `offset` | in a layout of your own (a `CanvasHtml`), at a corner, or `inline`; in an `Overlay`, `anchor` and `order` |
| placed directly in the `Canvas` | in an `Overlay` or a `CanvasHtml` (`parent`: a `CanvasHtml`'s) |
