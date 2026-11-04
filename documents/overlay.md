# Overlay: gadgets, panels and maps over the 3D view

`Overlay` is a layer of HTML over the 3D view where gadgets, panels, buttons and maps are
organised: in a dock down either side of the view, at the corners and the middles of the edges
of the space between the docks, stacked by their order and never over each other, or filling
that space. Its children are plain React HTML, and see every context the `Canvas` sees: R3F's
`useThree` and `useFrame`, the `World`, the data.

```tsx
<Canvas>
  <World frame={frame}>
    {/* … the scene … */}
    <Overlay>
      <Panel anchor="left" resizable closable width={260}>
        <WellMap wellIdentifier={well} />
      </Panel>
      <AltitudeControl anchor="left-center" />
      <Minimap anchor="bottom-right" layers={reliefLayers}>
        <GeoMapCameraMarker />
      </Minimap>
      <OverlayItem anchor="top-right">
        <OverlayButton title="Home" onClick={goHome}>⌂</OverlayButton>
      </OverlayItem>
    </Overlay>
  </World>
</Canvas>
```

Story: `Components/Html/Overlay` (`src/components/Html/Overlay/Overlay.stories.tsx`): a well
map in a sidebar, the altitude control beside it, a minimap, and a toolbar button opening a
map that fills the view. (In an app a well map would usually sit beside the canvas, not over
it: the story is more crowded than a host would make it.) Its `Own layout` story does without
the overlay: see [Without the overlay](#without-the-overlay-a-layout-of-your-own).

The overlay is optional: one layout, made of building blocks that are public, for a layout of
your own.

## The overlay

- **Inside the `Canvas`**, inside the `World` for what is placed on the Earth. It is a
  `CanvasHtml` with its layout in it: it appends an element to the canvas's parent (or
  `parent`) and renders its children there, in a React root of its own.
- **Every context, bridged.** The children see the contexts the `Canvas` sees, bridged with
  `its-fine` (`useContextBridge`, under a `FiberProvider` of the overlay's own in R3F's tree):
  R3F's store, so `useThree` and `useFrame` work in them; the `World`, the data, the generators;
  and the host's own. `its-fine` is a peer dependency: React Three Fiber 8 and 9 install it.
- **Where items go**, inside the `inset` (default 10 px):

  ```
  ┌───────┬─────────────────────────────────────────────┬───────┐
  │       │ top-left        top-center        top-right │       │
  │ left  │ left-center      (fill)        right-center │ right │
  │       │ bottom-left    bottom-center   bottom-right │       │
  └───────┴─────────────────────────────────────────────┴───────┘
  ```

  - **The docks**, `'left'` and `'right'`: a column the full height of the view along its
    edge, its items stacked from the top by their `order`. As wide as its widest item, `gap`
    pixels from the space between the docks; nothing when empty.
  - **The eight anchors** between the docks — the corners and the middles of the edges — in
    three columns side by side (`overlayCell`): the left corners and the middle of the left
    edge in the first, the middles of the top and bottom edges in the second, the right ones in
    the third; each column shares its height among its top, middle and bottom. The columns
    never overlap, nor do the rows of a column, so no two anchors' items ever do. The middles
    stay centred while there is room (`OVERLAY_GRID_TRACKS`): an outer track is never smaller
    than its items, so a corner that needs more pushes the middle of its edge aside rather than
    running over it — and only the stacks of one column push each other. Items at one anchor
    stack by their `order`, the lowest nearest the edge, `gap` pixels apart (default 8): in a
    column, or in a row in the middles of the top and bottom edges (`directions`). What does
    not fit runs past the view: nothing shrinks of itself.
  - **`'fill'`**: the whole of the space between the docks, under the anchored items; items
    filling it lie over each other, the later over the earlier.
- **The scene does not hear it.** A press, a wheel, a click, a double click or a context menu on
  an item does not reach the scene's controls or R3F's events, which listen on the canvas's
  parent. Moves and releases go on, so a drag of the scene passing over an item is not cut off.
  Between the items the overlay lets everything through.
- **`layout`**: where items go by their `id`, over what they ask for — a layout the user
  arranged and the host kept, say. Dragging items to another anchor or order is to come, on the
  same ids.

## Items

- **`OverlayItem`** (`anchor`, `order`, `id`): places its children. It takes pointer events.
  In a dock, `stretch` makes it take the height the dock's other items leave. Outside an
  overlay its children are rendered where they are.
- **The gadgets place themselves**: a `Panel`, a `Minimap` and an `AltitudeControl` take
  `anchor`, `order` and `id`. Outside an overlay they are placed where they are rendered (see
  [Without the overlay](#without-the-overlay-a-layout-of-your-own)); a `Minimap` and an
  `AltitudeControl` need the `Canvas`'s contexts, so not directly in the `Canvas`: in an
  overlay or a `CanvasHtml`.
- **`OverlayButton`**: a small square button in the gadgets' look (`title`, `onClick`, `active`
  for a toggle, `size`, its face as children), for toolbars of your own, in an overlay or out
  of one. A closed panel's button is one.
- `useOverlay()`, `useOverlayItem()`: the enclosing overlay and the item a component is placed
  by — a panel resizes away from its item's anchor.

## Panels: resized and closed

A `Panel` is a box of HTML: in a corner of its container (`origin`, `offset`), in the flow of
a layout of your own (`inline`; its handles still face away from `origin`), or in an overlay
at its `anchor`. In a dock it is a **sidebar**: the full height of the dock, less its other
items, and as wide as `width` (or its size, resizable). Optionally:

- **`resizable`**: dragged by its edges and corner away from where it is anchored, so the
  anchored side stays (`panelHandles`, `anchorGrowth`); about the middle of an edge, by both
  sides at once; a sidebar by its inner edge alone. Within `minWidth`/`minHeight` (default
  120 × 80) and `maxWidth`/`maxHeight` (default what the view leaves it: the space between
  the docks; for a sidebar, the view's width less the other dock and 200 px between them;
  `inline`, whose container grows with it, the window; in a corner, its container less the
  offsets).
  While dragged, the size is set on the element, not through React; told once the drag ends
  (`onSizeChange`). `size` controls it; `width` and `height`, or `defaultSize`, are where it
  starts. What is inside follows: a `GeoMap` resizes its canvases as its box does.
- **`closable`**: a close button top right (`closeButton={false}` for one of your own:
  `usePanel().close()`), closing it into a button where it sat (`collapsed`: its `icon`,
  `title`, and an `anchor` and `order` of its own if wanted), which opens it again. Closed, its
  children are unmounted — a map's WebGL context given back, nothing done per frame — unless
  `keepMounted`; it keeps its size. `open` controls it, `defaultOpen` starts it.

Its content lies in a stacking context of its own: nothing inside it (a `z-index` of its own)
covers the panel's close button and resize handles.

A panel that neither is resizable nor closable, nor has a `height`, nor is a sidebar, lets
pointer events through, as before.

## The altitude control: `AltitudeControl`

A slim vertical control over the 3D view for the height of the camera, or of its target
(`marker`): a groove with a mark at each end and in the middle, a round knob, and the height
under it (`readout`). It was the minimap's; it is now a gadget of the overlay, anchored to the
view (default `'left-center'`).

- **Pull the knob up to climb, down to descend.** The knob sets the climb **speed directly**, in
  metres a second, the same at any height: nothing within a 4 px dead zone, then with the square
  of how far the knob is from the middle, up to `maxSpeed` (default 100 m/s) at the end of the
  groove (`dragRange` pixels each way, default 100, at most a sixth of the view's height:
  `altitudeControlTravel`) (`altitudeRate`).
- **Only at the end of the groove does it accelerate.** Held there in one direction, the speed
  doubles every `boostTime` seconds (default 1), up to `boost` times `maxSpeed` (default 200)
  (`boostFactor`). Pull the knob back from the end and it is the direct speed again at once.
- **Let go and it springs back** to the middle, and the height stays where it got to. Escape
  puts the height back to what it was when the knob was taken. Pressing on the knob holds it
  where it was grabbed; pressing the groove brings the knob to the pointer.
- **The range** is `min` to `max` (default −5 km to +50 km). A height already outside it can
  move back, and no farther out (`moveAltitude`). `color` colours it.
- **The camera takes its target along**, by the same move, straight up or down where it is
  (along the globe's up far out), so it looks the same way at the same angle from the new
  height; its target alone leaves the camera (`setMarkerHeight`, `setCameraPose`). Heights are
  over the `World`'s globe's sea, or the plane Y = `level`. It moves the scene's controls (drei's
  `CameraControls`, or an `OrbitControls`), and is dimmed and inert without them.
- Per frame it touches the page only when the readout's text changes.

## The look

The gadgets share one look (`src/components/Html/hud.ts`, public): small dark square buttons
with a faint edge, highlighted when a toggle is on (`HUD_BUTTON`, `HUD_ACTIVE`, `HUD_IDLE`),
and labels of sharp white text with a hard one-pixel outline, readable on light ground and dark
(`HUD_LABEL`); distances and heights written short (`formatHudDistance`, `formatHudAltitude`),
and a readout written per frame touching the page only when its text changes (`setHudText`).

## Without the overlay: a layout of your own

The overlay is one layout. A host that wants its own — another arrangement, its own CSS, a
sidebar of the page beside the canvas — uses the pieces it is made of, all exported:

| Building block | What it does |
| --- | --- |
| `CanvasHtml` | HTML rendered from inside the `Canvas`, with every context the `Canvas` sees bridged (`useThree`, `useFrame`, the `World`, the data): into a layer of its own over the canvas (`parent`, `zIndex`), or into an element of the page (`container`, laid out by it). What it renders does not reach the scene's controls (`isolate`); its layer lets the pointer through where nothing is drawn. |
| `anchorStyle(anchor, inset)` | the CSS placing an absolutely positioned box at a corner or the middle of an edge |
| `anchorStack(anchor, direction)` | the flex direction and alignment for items stacked at an anchor, the first nearest the edge |
| `anchorGrowth`, `resolveAnchorLayout`, `ANCHORS` | which edges move when a box at an anchor grows; items grouped and ordered by anchor; every anchor |
| `overlayCell`, `OVERLAY_GRID_TRACKS` | the overlay's own grid: the column, row and alignment of each anchor |
| `panelHandles`, `resizePanel`, `panelHandleCursor` | a resizable box of your own: its handles away from its anchor, its size after a drag, the cursor |
| `Panel` with `inline` | a resizable, closable panel in the flow of your layout, its closed button where it was |
| `Minimap` with `inline`, `AltitudeControl` | the gadgets, placed where you render them |
| `OverlayButton`, the `hud.ts` helpers | buttons and readouts in the gadgets' look |
| `useControllable` | a value the host may control or leave to the component, as the gadgets' are |

```tsx
<Canvas>
  <World frame={frame}>
    {/* … the scene … */}
    <CanvasHtml>
      <div
        style={{
          position: 'absolute',
          ...anchorStyle('bottom-left', 10),
          display: 'flex',
          ...anchorStack('bottom-left', 'row'),
          gap: 8,
        }}
      >
        <Minimap inline origin="bottom-left" layers={reliefLayers}>
          <GeoMapCameraMarker />
        </Minimap>
        <AltitudeControl />
      </div>
    </CanvasHtml>
  </World>
</Canvas>
```

- **Pointer events**: the layer lets the pointer through. The gadgets, panels and buttons take
  it themselves; give anything of your own that should take it `pointer-events: auto`.
- **Beside the canvas**: `<CanvasHtml container={element}>` renders into an element of the
  host's page — a sidebar, say — still inside the `Canvas`'s React tree, so a `Minimap` there
  follows the camera. Keep that element empty of anything React renders.
- **Not directly in the `Canvas`**: everything here is HTML, and the `Canvas`'s children are
  three.js objects. Render the gadgets in a `CanvasHtml` (or an `Overlay`, which is one).

Story: `Components/Html/Overlay` → `Own layout`: the minimap inline in a row with the altitude
control bottom left, a toolbar and a readout of the camera's distance top right.
