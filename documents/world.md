# World: where on Earth, and more than one field

> **Status (2026-11-02): design, decisions taken; steps 1,
> [2](#9-step-2-in-detail-the-sky-on-a-fixed-globe),
> [3](#10-step-3-in-detail-fields-placed-on-the-earth),
> [4](#12-step-4-in-detail-the-sky-anywhere-on-the-globe) and
> [6](#11-step-6-in-detail-tiles-on-the-globe) built; step
> [7](#13-step-7-in-detail-more-than-one-field) designed again (2026-11-02): the `World`
> holds where things are, and the host times and covers a switch between fields; 7a–7f
> built.** How the scene
> places itself on the Earth, what more than one field needs, and a plan for it. The open
> questions are settled ([Decided](#7-decided-2026-10-26)): the Earth is a fixed globe, and
> a `World` says once where the scene lies on it. Step 3 found the view's origin (step 4)
> mostly unneeded, leaving only the sky seen from far off, and the relief's own frame
> (step 5) better left to step 6 ([Order of work](#6-order-of-work));
> [What to keep doing now](#5-what-to-keep-doing-now) keeps the later steps cheap.

- [1. Today](#1-today)
- [2. What more than one field needs](#2-what-more-than-one-field-needs)
- [3. The proposal](#3-the-proposal)
- [4. What changes, part by part](#4-what-changes-part-by-part)
- [5. What to keep doing now](#5-what-to-keep-doing-now)
- [6. Order of work](#6-order-of-work)
- [7. Decided (2026-10-26)](#7-decided-2026-10-26)
- [8. Costs and risks](#8-costs-and-risks)
- [9. Step 2 in detail: the sky on a fixed globe](#9-step-2-in-detail-the-sky-on-a-fixed-globe)
- [10. Step 3 in detail: fields placed on the Earth](#10-step-3-in-detail-fields-placed-on-the-earth)
- [11. Step 6 in detail: tiles on the globe](#11-step-6-in-detail-tiles-on-the-globe)
- [12. Step 4 in detail: the sky anywhere on the globe](#12-step-4-in-detail-the-sky-anywhere-on-the-globe)
- [13. Step 7 in detail: more than one field](#13-step-7-in-detail-more-than-one-field)

---

## 1. Today

The scene is one flat frame in metres: scene X east, Y up, Z south, its origin at one
point of one projection. A `World` says where that point is, once, as a `GeoFrame` (a
projection and an origin; step 3, built 2026-10-26), and what needs it takes it from there:

| Who | What it takes from the `World` | What it uses it for |
|--|--|--|
| `UtmArea` | the scene's frame, to place itself in: not moved in the world's own map, placed (turned, scaled, on the globe) in another | placing the data: chunks, wells, surfaces, annotations |
| `Scenery` `observer` | the origin's latitude and longitude, when it gives only a date | the sun, moon, planets and stars |
| `GeoRelief` | the frame and the globe | placing the reliefs by latitude and longitude |

Without a `World` a `UtmArea` is the scene's frame and the observer gives its place, as
before; there is no relief (since 7d-1, 2026-11-02: until then a `SceneryStage`'s relief
`frame` stood in for the `World`'s).

Above the surface the sky draws the Earth as a fixed globe (step 2, built 2026-10-26): a
sphere whose centre lies fixed below the scene and whose cap over a disc about it (the
stage's `bounds`) is cut flat, so the scene meets the sea level and nothing rises or sinks
as the camera moves ([Step 2 in detail](#9-step-2-in-detail-the-sky-on-a-fixed-globe)).
Before it the sky faked the curve: flat over the disc and falling away by `½ κ d²` beyond,
measured along each view, with the disc moved under a camera far off. The data stays flat:
a field in a frame of its own is placed on the globe by its `UtmArea`
([Step 3 in detail](#10-step-3-in-detail-fields-placed-on-the-earth)); other content drawn
flat beyond the disc — `UtmPosition` and `Wgs84Position` included — goes onto it with a
`SceneryAnchor` or `applyGlobe` ([For a host](#for-a-host)).

Precision: the GPU works in 32-bit floats, a step of about 6 cm at 1000 km from the
origin and 0.5 m at 8000 km. A field's data is drawn in its own group, whose transform
three.js composes with the camera's in 64-bit floats before it reaches the GPU, so a field
300 km out is as precise as at home; only what a shader takes through world positions (the
sky's own, and the wellbore ribbon's) works at the world-space step.

---

## 2. What more than one field needs

- **Fields in different projections:** two fields in different UTM zones, or a field in
  a local projection, each precise in its own frame.
- **A camera that travels:** flying from one field to another 300 km away, with each
  field's data as precise when the camera reaches it as it is today.
- **A chosen field:** the user picks one, and it becomes what the view is about.
- **One Earth around them:** one sky, one sea, one relief, drawn once, whichever field
  is chosen.

None of this fits one flat frame: two UTM zones disagree by metres at their border and
by kilometres away from it, and the flat frame of one field cannot hold the other's data
to the centimetre 300 km away.

---

## 3. The proposal

Three layers, each with one job.

### The Earth

The sky, the sea, the relief and the clouds belong to the Earth, not to any field. The
Earth is a **fixed globe**: a sphere of radius `R` whose centre does not move, below the
chosen field. Every point has one place on it whatever the camera does, so nothing rises
or sinks as the view turns or the camera moves. (Decided 2026-10-26, against a sphere
touching the Earth just below the camera: that one rolls the Earth under a moving camera,
and cannot hold tiles by latitude and longitude in fixed places.) The faked curve before
it (`½ κ d²`) was close in height (under 1% off at 1000 km); what it faked was where it was
measured from — a disc, along each view — which is why the ground rose and sank as the
view turned.

Over the chosen field the sea is flat: the field's plane cuts the sphere's cap off over
its disc, and the centre lies just far enough below for the two to meet exactly on the
disc's edge, at an angle of `r / R` (0.07° for a disc of 8 km). Beyond the disc the sea is
the sphere itself. See [Step 2 in detail](#9-step-2-in-detail-the-sky-on-a-fixed-globe).

Altitude is the height over the globe, not scene Y: far from the field the two part (a
camera at Y = 40 m, 215 km off, is 3.6 km over the sea there), and so does the camera's
own up from the scene's. The relief's tiles are read in a frame of a region (the chosen
field's, the `World`'s, as now; for the whole globe, tiles by latitude and longitude) and
placed on the globe. The sun and the stars need a latitude and longitude, which the
`World` gives.

### Fields

A field keeps a flat frame of its own (a projection and an origin, as `UtmArea` has now),
and all its data stays in it: chunks, wells, surfaces, annotations, picking. The frame is
placed on the Earth by a rigid transform: its origin on the globe, its up along the
globe's normal there, its north along the projection's grid north. Inside the field the
plane and the sphere part by `d² / 2R` (5 m at 8 km, 20 m at 16 km), as with a `SceneryAnchor`
today. The chosen field's sea is flat over it (its cut cap, above); another field's own
water, flat, parts from the Earth's sea by as much toward its edge, seen from far off.

### The view's origin

> Superseded: step 3 found its precision free (a placed field's model-view matrix is
> composed in 64 bits), step 4 keeps the world fixed while the camera moves, and step 7
> moves the `World`'s frame only when the host switches between fields
> ([Switching the anchor](#switching-the-anchor-a-controlled-switch)).

What is drawn is drawn relative to an origin near the camera, so 32-bit floats are
precise where it looks. The origin is the chosen field's origin, or, between fields, a
point under the camera that moves in steps (every 10 km or so). Moving it changes
transforms only: each field's geometry stays in its own frame, the relief's tiles keep
their keys, nothing is rebuilt; the globe's centre is moved into the new frame with them.
The transform from each frame to the view's origin is composed on the CPU in 64-bit
floats, and only the result reaches the GPU.

### Where on Earth, in one place

One value says where a frame is: a projection and an origin, a `GeoFrame`. `UtmArea`'s
CRS, the relief's frame and the sky's observer are all derived from it — the observer's
latitude and longitude being the origin's. Built in step 3: the `World` component holds
the scene's ([Step 3 in detail](#10-step-3-in-detail-fields-placed-on-the-earth)).

---

## 4. What changes, part by part

| Part | Before step 3 | Now (step 3), and later |
|--|--|--|
| `UtmArea` | the scene's frame, at the world origin; `UtmPosition` and `Wgs84Position` flat ([For a host](#for-a-host)) | ✅ one field's frame: takes a `GeoFrame` (`frame`), and in a `World` with another frame places itself (`placeGeoFrame`, `geoFrameMatrix`); nested `UtmPosition`, picking and annotations unchanged; `worldToUtm` through its whole transform |
| Chunks, wells, surfaces | in `UtmArea` | unchanged, inside their field's `UtmArea` |
| `SceneryAnchor` | places flat content on the globe, where it is, rigidly (step 2) | ✅ places as the globe places the ground there (`Globe.tangent`), as a placed `UtmArea` is; for content without a frame of its own; takes the `World`'s globe outside the `Scenery` |
| Sky curve | a fixed globe, its cap over the chosen field cut flat (step 2) | the same; its disc from the chosen field's stage |
| Sky observer | given by the host | ✅ its place from the `World`'s origin when it gives only a date; the date the host's |
| Relief | read in the stage's `frame`, the scene's | ✅ the `World`'s frame by default, the chosen field's, where its column meets it exactly; its own frame waits for step 6; Earth data of its own, drawn with or without a sky, in step 7 |
| Relief tiles | keyed in the frame's X/Z, roots of 2097 km about its origin | keyed by latitude and longitude for the whole globe (step 6); until then as now, within one region |
| `SceneryStage` | one stage, one occupant, at the scene's frame | as before, at the chosen field; the anchored stage switched by the host changing the `World`'s frame and disc (a controlled switch), every loaded field drawn, is [step 7's](#13-step-7-in-detail-more-than-one-field) |
| Bridge (relief → chunk) | relief and column in the same frame | the same for the chosen field; a column in a placed field samples the relief through a transform, with step 6 |

---

## 5. What to keep doing now

Nothing above is needed for one field. What keeps it cheap to add later:

- **Ask "where" in one place.** New code that needs a latitude, a projection or an origin
  takes it from the `World`'s `GeoFrame` (`useWorld`, `geoFrameLocation`), or a field's
  (`UtmAreaContext.frame`), not from a prop of its own.
- **Measure from a frame given, never from world 0.** Everything above the surface
  already does (the sky, the relief's curve, the tiles' selection); after step 2 the
  globe's centre is one such frame, and nothing measures the curve from the camera.
- **Keep a field's content under its `UtmArea`.** Its group is the field's transform.
- **Keep the relief's frame apart from the field's.** The tiles are built in the relief's
  frame; the column reads the relief through the bridge, which may then carry a transform.
- **Draw through the model-view matrix.** A shader that goes through world positions
  loses the precision a placed field keeps (see [Today](#1-today)).
- **No scene-wide constants for a place.** Not in shaders (a uniform per frame instead),
  not in stories (one place per story).

---

## 6. Order of work

| # | Step | Ends with |
|--|--|--|
| 1 | **One place for where:** sdk helpers that derive the relief's frame and the sky's observer place from the CRS a `UtmArea` is given; the sky stories take all three from one CRS (`demoCrs`) | ✅ built (2026-10-25); the helpers became `geoFrameFromCrs` and `geoFrameLocation` in step 3 |
| 2 | **The sky on a fixed globe** ([in detail](#9-step-2-in-detail-the-sky-on-a-fixed-globe)): the sea, the horizon, the air and the clouds on a sphere fixed below the chosen field, flat over its disc; the relief and anchored content placed on it with no camera in the sum; `followFlatSea` and `followAway` go | ✅ built (2026-10-26): the same pictures at one field, nothing moving anywhere, at 0–1 ms a frame over the sea (2e) |
| 3 | **Fields placed on the Earth** ([in detail](#10-step-3-in-detail-fields-placed-on-the-earth)): `GeoFrame` (was `ReliefFrame`); a `World` holding the scene's; a `UtmArea` in another frame placed in it, on the globe with a sky; the observer's place and the relief's frame from the `World` | ✅ built (2026-10-26): a second field in UTM 32N, 123 km out, placed to about 10 cm 5 km around (ReliefTiles' `facility: 'field'`), with the sky and without |
| 4 | **The sky anywhere on the globe** ([in detail](#12-step-4-in-detail-the-sky-anywhere-on-the-globe)), was the view's origin. Its precision came free in step 3: three.js composes each draw's model-view matrix in 64 bits, so a placed field is as precise 300 km out as at home. Left: the sky seen from far off. The world stays fixed and the sky's look frame follows the camera: its up, horizon and light where the camera is; the waves on fixed charts on the Earth (`OceanCharts`). A host levels its horizon with `useLevelHorizon` | ✅ built (2026-10-27); the cloud deck far off is left for step 8 |
| 5 | **The relief in its own frame** — folded into step 6. In a frame of its own the relief would part from the chosen field's UTM by the two maps' scale (UTM's 0.9996 against 1: 3 m at 8 km), right where its column meets it; laid in the chosen field's frame it meets it exactly, and a placed field's to its placement's precision | → step 6 |
| 6 | **Tiles on the globe** ([in detail](#11-step-6-in-detail-tiles-on-the-globe)): tile keys by latitude and longitude, the relief contract unchanged (a tile asks each layer for a window of its own grid, as now); the overlays' tiles move with them, sharing the core. Everything placed by latitude and longitude on one sphere, the ellipsoid's conformal sphere matched at the chosen field; each field's column samples the relief through its transform | ✅ built (2026-10-26) in five parts: 6a the geographic globe, 6b geographic tiles, 6c the relief drawn from them, 6d the whole globe — the Earth from 20 000 km, the far side included; 6e a clean-up |
| 7 | **More than one field** ([in detail](#13-step-7-in-detail-more-than-one-field)): the `World` holds where things are — its frame (the anchor), the disc and the globe — whatever the scenery, and draws nothing; the relief Earth data of its own; switching the anchor a controlled switch, timed and covered by the host; every loaded field drawn in its own group; the void the seabed's underside everywhere; the seabed see-through over each loaded field | designed (2026-10-30), designed again (2026-11-02); 7a–7f built (2026-11-02); step 3 placed the second field |

Steps 1 to 4 and 6 are built. Step 7 is designed ([§13](#13-step-7-in-detail-more-than-one-field)),
to be built against a story with two fields of realistic size.

---

## 7. Decided (2026-10-26)

- **The Earth is a fixed globe** (see [The Earth](#the-earth)), not a sphere touching the
  Earth just below the camera: that one rolls the Earth under a moving camera, where a far
  point lies depending on where the camera is, and cannot hold tiles by latitude and
  longitude in fixed places.
- **Names:** `GeoFrame` for where a flat frame lies on the Earth: a projection and an
  origin, plain data, so a worker can read it. `ReliefFrame` became it, a `CRS` is built
  from one (`crsFromGeoFrame`), and `UtmArea` takes one (step 3). The globe's shape and its
  placement are an sdk piece of their own, `Globe` (step 2), which the sky owns and
  anything else can take. The component that says where the scene lies is `World`
  (step 3; decided then, rather than with the view's origin).
- **The whole globe:** tiles by latitude and longitude, as Cesium's and most globes' are,
  with the relief contract unchanged — a tile asks each layer for a window of its own
  grid, as now (step 6). Until then, one regional frame: a projection for a region (a UTM
  zone stretched, or a Lambert conformal) holds about 2000 km well, the Norwegian shelf
  from the North Sea to the Barents Sea at 1–2% scale error at its far edges. Step 6
  (decided 2026-10-26): everything placed by latitude and longitude on the ellipsoid's
  conformal sphere, matched at the chosen field, two geographic roots, true north for
  the sun ([Step 6 in detail](#11-step-6-in-detail-tiles-on-the-globe)).
- **The chosen field's sea is flat over it,** where the column meets it exactly; beyond,
  the sea is the globe. Curved everywhere would put the column's top 5 m off the sea at
  8 km.
- **Picking and annotations across fields:** each field's `UtmArea` keeps its own
  context; a pick says which field it hit. Built in 7f without the `EventEmitter` knowing of
  fields: a listener's `ref`, its generic reference, carries what the host or the component
  registering it puts there (the field's area, from its `UtmAreaContext`), or the host's
  handler knows its field by where it was made.
- **The date** stays the host's, as the sky observer's is.
- **`UtmPosition` and `Wgs84Position` stay flat** for now: they place at the area's
  Y = `altitude`, as before, and far from the field what they place stands off the curved
  sea; the behaviour is documented ([For a host](#for-a-host)) rather than changed. Since
  step 3 a field far off has a `UtmArea` of its own, placed on the globe, and what it
  places stands on the globe there.

- **Step 3 in one go, with what of 4, 5 and 7 comes with it** (2026-10-26): the view's
  origin deferred, its precision found free; the relief kept in the chosen field's frame
  until step 6; a second field placed in the ReliefTiles story.

- **The camera's controls are never changed by the library,** as a host may use any.
  The camera stays in scene units with the scene's up. Step 4 (decided 2026-10-26) keeps
  the world fixed and has the sky follow the camera instead
  ([Step 4 in detail](#12-step-4-in-detail-the-sky-anywhere-on-the-globe)). A host levels
  its horizon far off by its camera's up, and a helper places a camera over the ground at
  a point ([For a host](#for-a-host)).

- **Step 7 designed again (2026-11-02):** the `World` holds where things are — its frame (the
  anchor), the disc and the globe — whatever the scenery, and draws nothing; the relief is
  Earth data of its own, drawn with or without a sky, and global layers lie on the `World`'s
  globe. Switching from one field to another is a controlled switch: the library applies the
  new frame in one frame and tells the host (`onFrameChange` with its matrix,
  `onFrameSettled`), and the host covers it as it likes — a fade in the stories
  ([Step 7 in detail](#13-step-7-in-detail-more-than-one-field)). Wellbores as an Earth-level
  layer are a step of their own.

---

## 8. Costs and risks

- **Rebasing:** never per frame. Step 4 keeps the world fixed and moves only the sky's look
  frame, one uniform set with the camera; step 7 changes the `World`'s frame when the host
  switches between fields, in one frame, handing the host the matrix for its camera
  ([Switching the anchor](#switching-the-anchor-a-controlled-switch)).
- **The exact curve per pixel:** a sphere's intersection costs a square root, as today's
  curve does; no change. The sea's normals become exact (from the centre), which drops
  the tilt today's curve adds.
- **Precision of a centre 6371 km away:** in 32-bit floats a distance from the centre is
  good to half a metre. Written about the disc's centre instead, in forms that subtract
  no near-equal numbers, it is good to a millimetre near the field (see
  [Step 2 in detail](#the-globe-in-32-bit-floats)).
- **Two frames meeting:** where two fields' frames overlap, their data disagree by the
  projections' difference; each field is drawn in its own, and the sea and relief in the
  chosen field's. A field placed in it meets them to its placement's precision: about
  10 cm 5 km around its origin in the next UTM zone 120 km off, 40 cm at 10 km, growing
  with the square of the distance from its origin
  ([Step 3 in detail](#10-step-3-in-detail-fields-placed-on-the-earth)).
- **Data far from any frame:** the relief already lives far from the field (hundreds of km);
  a field placed far off keeps its precision, its transform composed in 64 bits.

---

## 9. Step 2 in detail: the sky on a fixed globe

> Design (2026-10-26); built (2026-10-26).

Today the curve is measured from the camera in about ten places, and the disc it is
flat over moves under a camera far off (`followFlatSea`, `followAway`). After this step
the sea, the relief and what is anchored on them each have one place, whatever the
camera does, and nothing about the curve is measured from the camera but the horizon.

### Where the globe lives

Not in the sky. The globe is a small piece of the sdk of its own, `Globe`
(`sdk/projection/globe.ts`, beside `CRS`, and its GLSL chunk `globe.glsl` in the
materials' shader library): the disc and the centre, the functions below on the CPU and
their twins on the GPU, and the uniforms that carry them, which a material binds by
reference so nothing is copied per frame. In step 2 the `Scenery` owns one: `setFlatSea` sets
its disc, its `globe` prop turns it on or off (off, it is a flat plane), and the sky's
shaders bind its uniforms. What else is placed on the globe — the relief, a route,
an anchored field — takes a `Globe`, not a `SceneryMaterial`.

So a host can place Earth-referenced data on the globe without a `Scenery`, by making a
`Globe` and setting its disc. Without a globe, nothing curves: see
[With and without a sky](#with-and-without-a-sky). Since step 3 a `Scenery` in a `World` hands
the world its globe, and what the world places is set on it; since step 7 (7b) the `World`
owns the globe, and a `Scenery` inside draws on it.

Built (2a, 2026-10-26): `new Globe(radius = EARTH_RADIUS)`; `enabled`, `level`,
`setUp(up)`, `setDisc(bounds | null)`; read only `discCentre`, `discRadius`, `centre`,
`centreDepth`; `altitude(point)`, `upAt(point, target)`, `place(x, z, height, target)`,
`reach(origin, dir, below?, target?)` → `{ distance, hit }`; `uniforms` (`uGlobeUp`,
`uGlobeDisc`: the disc's centre and radius, `uGlobe`: `R`, `s`, `r²`, on). A ray through
the cut-off cap — over the field, below its top, which stands `r² / 2R` over the plane at
the disc's middle — meets nothing, as it leaves the sphere again over the plane.

### The surface

In the scene frame, until the view's origin moves (step 4), with `c` the middle of the
chosen field's disc at the sea's level, `r` its radius (the stage's `bounds`, as
`setFlatSea` takes them now) and `up` the scene's:

- **The centre** `C = c − s · up`, `s = √(R² − r²)`: a little less than `R` below, by
  `r² / 2R` (5 m for a disc of 8 km), so the level plane meets the sphere on the disc's
  edge. It is fixed: set with the disc, never moved after.
- **The sea:** the level plane over the disc, the sphere `|p − C| = R` beyond. The two meet
  at an angle of `r / R` (0.07° at 8 km). The seabed and the void's lid are the same
  `depth` lower: the plane `depth` down over the disc, the sphere of radius `R − depth`
  about the same centre beyond.
- **Altitude** of a point: its height over the plane above the disc, `|p − C| − R` beyond.
  **Up** at a point: the scene's above the disc, `(p − C) / |p − C|` beyond.
- **The ground at map X/Z** (a relief's node, a route's vertex): over the disc, the plane;
  beyond, the point of the plane carried along the line from the centre onto the sphere,
  and its height along up there. A gnomonic placement: good to 1.5–3% at 2000 km, which a
  regional frame does not exceed, and defined at any distance; step 6 replaces it with
  the true place of a latitude and longitude.
- **A view ray** meets the sea at the plane if it hits it inside the disc, else at the
  sphere's nearer root. A miss, past the horizon, takes the grazing point, so the
  derivatives stay continuous, as now.
- **The horizon** from the camera: where its view grazes the sphere, around the camera's
  own up. Far off that up tilts from the scene's (1.8° at 200 km), and the horizon, the
  air's layers and the sun's height over the sea follow it, or the sky's horizon and the
  sea's would part.

### The globe in 32-bit floats

`|p − C|` is good to half a metre in 32-bit floats. Written about `c` instead, with
`v = p − c`:

- altitude `(|v|² + 2 s (v · up) − r²) / (|p − C| + R)`, and the sphere's drop below the
  level at `d` from the disc's axis `(d² − r²) / (s + √(R² − d²))`: no near-equal
  numbers subtracted, good to a millimetre near the field, and far off to the precision of
  the position itself (12 cm at 2000 km);
- `s`, `r²` and `R` reach the GPU from 64-bit floats on the CPU.

### The camera, once per draw

What the shaders need of the camera — its height over the globe, its up, the distance to
where its view grazes the sphere and the horizon's dip — is the same for every pixel.
`Globe.setCamera(position)` works it out on the CPU, in 64-bit floats, into uniforms of its
own (`uGlobeCamera…`), and the shaders read them (`globeCameraHeight`, `globeCameraUp`,
`globeCameraHorizon`, `globeCameraDescent`; `globeViewHeight` for a view's origin moved
straight along up from the camera, as the background's view from under a stage's ground
is). Each mesh drawn with the sky's shaders sets them from its `onBeforeRender`
(`SceneryMaterial.onBeforeDraw`, and the stage's `setStageView`), with the camera drawing it, so
a second view or a bake's camera gets its own; for the same place it returns at once. The
bakes keep the globe off and read none of them.

Per pixel the globe still costs what only a sphere needs: where a view meets it, the
horizon along the pixel's bearing and the lowest point a view passes, each taken once. The
air's rise along a view is the camera's sphere to second order (`globeCameraRise`), with no
square root: under 1% of the rise off at 1000 km.

⚠️ The shaders are inlined whole and compiled through ANGLE to Direct3D, where an early
`return` in a small, often called function can cost far more than it saves: one that
skipped the light share's descent from the sea's level cost the stage 1.6 ms at 40 m. Write
them with one return.

### What changes, part by part

| Part | Today | After step 2 |
|--|--|--|
| `sky-curve.glsl` (`skyCurveDrop`) | the drop at X/Z as the camera sees it | `globe.glsl` (sdk): the altitude, up and ground of a point, a ray's reach and the horizon, as above |
| `Globe` (sdk, new) | — | the disc and the centre; `altitude`, `up`, `place`, `reach`, the CPU twins of `globe.glsl`; its uniforms |
| `SceneryMaterial` | `setFlatSea`; `followFlatSea` moves the disc each frame (`followAway`, `FLAT_SEA_FOLLOW`, `FLAT_SEA_AWAY`); `curveDrop(point, eye)` | owns a `Globe` (`globe`): `setFlatSea` sets its disc, once; the rest goes; its shaders bind the globe's uniforms |
| `sky-gradient.glsl` | `skyFlatRun`; the horizon and the lowest height a view passes from `½ κ d²` along the view | the horizon from the camera's altitude and up; the lowest height from the ray's closest approach to the centre; the air's heights over the globe |
| `sky-ocean.glsl` | `skyOceanReach` (flat, then `½ κ (c t − run)²`); `skyOceanTilt` tips the normal by the fall | the reach on the globe; the waves' normal turned onto up at the hit, and `skyOceanTilt` goes |
| `sky.glsl` | the clouds' deck on a sphere centred under the camera; the band's sink and squash from `½ κ d²`; the stage's sky over the curved horizon | the deck about `C`; the band from the camera's altitude; the horizon from the globe |
| Stage (`stage-fragment.glsl`) | the reach and the water's path below the surface beyond the disc | the same, through the globe's reach; the seabed facing up there; the planes sunk under a camera far off ([below](#the-stage-far-off)) |
| Relief tiles (`relief-tiles-vertex.glsl`) | each vertex lowered by `skyCurveDrop`, its height along the scene's up | placed by the ground at its X/Z, its height and skirt along up there; `vReliefFlat` (the occupant's cut) stays flat |
| Relief fragment, overview | the sea through `skyOceanReach` | the same, through the globe's reach |
| `applySkyCurve` | per vertex, the drop as the camera sees it, from a `SceneryMaterial` | per vertex, the ground at its X/Z and its height along up: the same from every camera. Takes a `Globe`; renamed `applyGlobe`, as nothing in it is the sky's |
| `SceneryAnchor`, the stage's `anchor` (`placeOnSkyCurve`) | lowered and tilted each frame, from the camera, while `followAway` | placed on the globe at `at`, when the globe or `at` changes: nothing over the disc, so the chosen field is never moved. `SceneryAnchor` takes the enclosing sky's globe, or a `globe` of its own |
| `SceneryStage` | sets `followAway` while tiled | does not |
| `Scenery` | `followFlatSea` each frame; the camera's height along up for its zones and the air's light | the camera's altitude over the globe |
| Relief tiles' selection | the ground under the camera at its X/Z; boxes flat; the farthest seen from the disc's edge | the ground where the line from the centre through the camera meets the plane; boxes from their corners placed on the globe and their heights; the farthest seen from the camera's altitude |

Unchanged: the void, its walls and the cutaway, which lie under the disc; the
environment's bakes, which draw a flat sea; `globe: false`, a flat sea everywhere.

### The stage far off

The stage's surface and seabed are flat meshes out to the far plane that only carry
fragments: each pixel is shaded from its view ray, not from where the mesh lies. Before
the globe a camera's scene height was its altitude, so they always lay below a camera over
the sea. On the globe they do not: 200 km off and 500 m up, the camera is 2.6 km below the
scene's level, under them, and the sea below it got no fragment at all. So
`stage-vertex.glsl` sinks each vertex, while the camera is beyond the disc, to the plane
touching its level under the camera. All of that level on the globe lies below that plane,
so every ray that reaches it crosses the mesh first; over the disc the plane is the level,
and nothing moves. Sunk, the mesh bends back up toward the field, where a ray crosses it
again from below: only the crossing from the camera's side draws (`gl_FrontFacing`; the
planes face up).

### For a host

- **Far from the field, scene Y is not altitude.** A camera at Y = 40 m 200 km off is
  3 km over the sea. `globe.place(x, z, height)` gives the point `height` over the ground
  at map X/Z, to place a camera or a target; the stories' `videx3d` bridge gets the same
  (`videx3d.globe`). A helper only: the library never moves the camera.
- **The horizon tilts far off.** The camera's controls keep the scene's up, so at 200 km
  a view across the direction to the field shows the horizon rolled by 1.8°, and a quarter
  of the way round the Earth it stands on end. A host levels it with `useLevelHorizon()`
  (Sky, built 2026-10-26; [4e](#4e-a-level-horizon-for-a-host)), or by setting its
  camera's up to the globe's there itself (`globe.lookUp`).
- **A field with a map of its own** (another UTM zone, a field far off) goes in a
  `UtmArea` of its own inside the `World`, which places it on the globe
  ([Step 3 in detail](#10-step-3-in-detail-fields-placed-on-the-earth)).
- **Other content beyond the disc drawn flat** still needs a `SceneryAnchor` or `applyGlobe`,
  as before, but it no longer moves as the camera does.
- **`UtmPosition` and `Wgs84Position` are flat** (decided, [above](#7-decided-2026-10-26)):
  `altitude` is the area's Y. Over the disc that is exact. Beyond it what they place stands
  off the sea by `(d² − r²) / 2R` at `d` from the disc's middle — for a disc of 10 km about
  25 m at 20 km, 270 m at 60 km, 780 m at 100 km, 3.1 km at 200 km — upright in the scene
  rather than on the globe's up (`d / R`: 1.8° at 200 km), and, against the relief and the
  sea, which the globe pulls in a little, about 100 m farther out at 200 km (12 m at
  100 km). The flat conversions back (`areaToUtm`, `worldToUtm`, `areaToWgs84`,
  `worldToWgs84`) read the same in reverse: a point on the sea 200 km out reads an
  altitude of −3.1 km and a map position 100 m nearer the field. Wrapped in a `SceneryAnchor`
  at its point (`at`, from `utmToArea`), such content stands on the globe, upright there;
  for a reading, `globe.foot(point)` and `globe.altitude(point)` give the map point and
  the altitude.

### With and without a sky

Either way the data stays flat in its field's frame. A `GeoFrame` (step 3) says where that
frame lies on the Earth; a field in another one — a facility in another UTM zone — is
placed by its `UtmArea` in the `World`, flat without a sky and on the globe with one. What
arrives in another projection as single points — a pipeline in latitude and longitude — is
converted into the field's frame. The globe is a way of drawing, applied on top.

- **Without a sky** there is usually no globe, and nothing curves. The frame is consistent
  with itself: a pipeline, a facility and a seabed surface agree wherever they are, and a
  route 200 km to shore is drawn flat, as on a map. Distortion shows only against
  something curved — the sea's horizon, a regional relief — and without a sky neither is
  drawn. A host that wants it curved anyway makes a `Globe` (above). Since step 7 (7b) a
  `World` always has one, curved unless its `globe` is off, so in a `World` the sky changes
  nothing of where things lie.
- **With a sky** the sea and the relief are on its globe. What is Earth-referenced and
  lies beyond the disc goes onto the same globe (a field's `UtmArea` in a `World`,
  `SceneryAnchor` about a point, `applyGlobe` per vertex), or it floats over the sea far off
  (3 km at 200 km).
- **Over the chosen field's disc** the globe is the field's plane: a field-scale scene is
  the same with a sky or without.

### Checked by

- **Tests** of `Globe`, against a 64-bit sphere: nothing over the disc, the plane and the
  sphere meeting on its edge, `|p − C| = R` beyond, up, the stable forms, a ray's hit on
  the surface, the horizon's dip `acos(R / (R + h))` far off, an anchor's place the same
  from any camera, flat with the globe off. `tests/apply-globe.test.ts` (was
  `sky-curve.test.ts`) is rewritten for it.
- **The same pictures at the field:** screenshots before and after at fixed poses close in
  (StageDebug, FieldColumn WithScenery, Baseline, ReliefTiles over Volve).
- **Nothing moving:** at 40 and 215 km, orbiting a fixed target, the coast holds its place
  against the sea, where today it rises and sinks.
- **Timings:** [tiles.md's poses](./tiles.md#timed-again-the-rest-of-the-relief-2026-10-25)
  again (the far ones placed with `globe.place`), within noise of today's: the sphere's
  root replaces today's quadratic.

### Order of work

| # | Step | Ends with |
|--|--|--|
| 2a | **The globe on the CPU:** `Globe` in the sdk (the centre from its disc; `altitude`, `up`, `place`, `reach`); the `Scenery` owns one, `setFlatSea` setting its disc; tests | ✅ built (2026-10-26); nothing drawn changes. `SceneryMaterial.globe`, kept in step by `setFlatSea`, `oceanLevel`, `globeEnabled` and `setFrame`; `tests/globe.test.ts` |
| 2b | **Everything drawn, at once,** so the ground and the sea always agree: `globe.glsl` for `sky-curve.glsl`; the sea, horizon, air and clouds; the stage; the relief's tiles and overview; `applyGlobe`; the anchors placed once; `followFlatSea`, `followAway` and their constants gone | ✅ built (2026-10-26), with 2c. Against step 2a, clouds off, rows averaged: at the field and out to the coast within 4 levels, the waves' own noise (30 levels at 2 m); the horizon from 100 km 10 levels apart, the sphere now exact. Low on the horizon the clouds' band is brighter, its flat-sea sink gone. Far off the stage's planes sink under the camera ([The stage far off](#the-stage-far-off)) |
| 2c | **Far off:** the tiles' selection and culling on the globe, the farthest seen, the ground under the camera | ✅ built with 2b: the ground under the camera at its foot (`Globe.foot`), the farthest seen from its altitude, boxes from corners placed on the globe. By eye at the coast and Lysefjord; the orbit and the timings in 2d |
| 2d | **For a host:** `globe.place` in the stories and `videx3d.globe`, their far poses; scenery.md (the curve, `SceneryAnchor`, the globe), tiles.md's curve section, relief.md; the timings | ✅ built (2026-10-26): `videx3d.globe` (`place`, `foot`, `altitude`, `up`, `orbit` about a point on the globe), shared with the debug panel; ReliefTiles' `facility`, a stand-in 123 km out, anchored or flat; `UtmPosition` and `Wgs84Position` documented ([For a host](#for-a-host)); the documents. Nothing moving: orbiting the coast 215 km out at 20 and 40 km, the globe's uniforms are the same from every pose and the coast holds. ⚠️ **Timed** A/B/A against 2a in ReliefTiles (GPU ms, frame and the background's draws): 40 m over Volve 12.1 → 14.9–16.7 (2.6 → 3.9–6.4), 100 km 14.5 → 17.3 (2.9 → 5.5), the coast 12.9 → 17.3–22.9 (2.5 → 4.1–5.2), Lysefjord 10.7 → 14.6 (3.8 → 6.0); the relief +0.5–2 ms, the stage +0.6–1.2; in the water and below the seabed the same or less. With the globe off the two match within noise, so it is the globe's own arithmetic per pixel: the camera's altitude and horizon about 20 times a pixel in the sky, each with a square root, and the relief's up and map point per pixel. Not within noise, as expected: taken back in 2e |
| 2e | **The globe's cost:** the camera's values per draw, not per pixel ([The camera, once per draw](#the-camera-once-per-draw)); the relief's up per vertex; the horizon, the lowest point a view passes and where it meets the sea each taken once per pixel | ✅ built (2026-10-26). The same pictures as 2d within a level (the air's rise, now to second order). Timed A/B/A against 2a in ReliefTiles, at a smaller window than 2d's (GPU ms, frame; the background, the relief and the stage): 40 m over Volve 8.4 → 9.1–9.2 (the background 1.9 → 2.3, the relief and the stage the same); 2 km, 30° down, the same; 100 km 8.8 → 9.5 (background +0.6, relief +0.3, stage +0.1); the coast 8.7 → 9.8 (+0.65, +0.3, +0.1); Lysefjord 8.8 → 8.2–8.8; in the water and below the seabed the same. So 0–1 ms over the sea, down from 2–4, and none of it below: what is left is the sphere's own per pixel, mostly in the background |

---

## 10. Step 3 in detail: fields placed on the Earth

> Built (2026-10-26).

### Where the scene lies, once

```tsx
<World frame={geoFrameFromCrs(crs)}>
  <Scenery observer={{ date }}>
    <SceneryOcean />
    <SceneryStage bounds={bounds} />
  </Scenery>
  <GeoRelief layers={layers} />
  <UtmArea crsInstance={crs} origin={crs.originUtm}>{field}</UtmArea>
  <UtmArea frame={{ projection: utm32, origin: [e, n] }}>{other}</UtmArea>
</World>
```

- **`GeoFrame`** (`sdk/projection/geo-frame.ts`, free of three.js): `{ projection, origin,
  offset? }`, what `ReliefFrame` was. `geoFrameAt(longitude, latitude)` (a transverse
  Mercator map about a point), `geoFrameFromCrs(crs)`, `crsFromGeoFrame(frame)`,
  `geoFrameLocation(frame)` (its origin's latitude and longitude), `geoFrameSameMap`.
- **`World`** holds the scene's frame: world X/Z are its map's about its origin. It renders
  nothing; `useWorld()` reads it. A `Scenery` inside hands it its globe (`provideGlobe`), so
  what the world places outside the `Scenery` is set on the same globe. Since step 7 (7b) the
  `World` owns the globe instead, with its disc (`bounds`) and its curve (`globe`).
- **The `Scenery`'s `observer`** may give only a date: its place is the world's origin's.
- **A stage's `relief.frame`** defaults to the world's. `reliefSource` still takes one:
  give it the world's. (Since 7d-1 the relief is a `GeoRelief`, its frame always the
  world's.)

### A field in another frame

A `UtmArea` takes a `frame` (or its CRS gives one, as before). In a `World` whose frame is
another, it places itself; in the world's own map about the world's origin it is not
moved, as without a world, at no cost.

- **Flat** (`placeGeoFrame`, plain data): its origin converted into the world's map with
  proj4, and the turn and the scale between the two maps' grids there, measured with proj4
  over 200 m. Rotated about +Y, scaled along X and Z (heights not), moved. In the same
  projection about another origin, only moved, exactly: proj4's round trip through a datum
  shift (ED50's, in the demo's UTM) is a millimetre off. The rest is the two maps' second
  order: the field at the trench, in UTM 32N, 123 km from Volve in 31N, lands to about
  10 cm 5 km around its origin, 40 cm at 10 km. Its scale there is 0.999, the zones' scale
  factors (UTM 32N's 1.0006 five degrees from its meridian): left out, 5 m at 5 km.
- **On the globe** (`Globe.tangent`): then onto the globe about where its origin lands, as
  the globe places the ground there, to first order: turned to the globe's up there, and
  squeezed as the globe squeezes the ground around it — the gnomonic placement's
  `cos² α` toward the disc and `cos α` across, 0.2% and 0.1% at 300 km. A rigid placement,
  as `SceneryAnchor` made before, would part from the relief by 10 m 5 km around at 300 km;
  this one by under 20 cm. Flat, the field stands off the sphere toward its edge by
  `d² / 2R` (2 m at 5 km), as the chosen field's own plane does over its disc.
- **The matrix** (`geoFrameMatrix`) is set on the area's group, which three.js then leaves
  as it is (`setObjectMatrix`: `matrixAutoUpdate` off, the world matrices composed again
  only when it changes). Each frame a handful of `Globe.place` calls, as the disc or the
  level may change. Its children stay in the area's own frame: `UtmPosition`, picking and
  annotations unchanged; `worldToUtm` and `worldToWgs84` go through the whole transform.
- **Precision:** three.js composes each draw's model-view matrix from the group's and the
  camera's in 64-bit floats, so the field's data is as precise 300 km out as at home.
  That is what made step 4 mostly unneeded.
- **`SceneryAnchor`** and the stage's occupant `anchor` place the same way now, about a point,
  for content without a frame of its own; `SceneryAnchor` takes the world's globe outside the
  `Scenery`.

### Not in this step

- **A column in a placed field** samples the relief in its own frame, which the bridge
  does not yet carry: the chosen field's column only (step 6).
- **More than one field,** and switching the chosen one (the world's frame) with a camera
  flying between them: step 7 ([in detail](#13-step-7-in-detail-more-than-one-field)).
  Switching changes the `World`'s frame and disc in one frame and hands the host the
  transform for its camera (a controlled switch); the relief's tiles, keyed by latitude and
  longitude, keep their keys and are placed again.
- **`UtmPosition` and `Wgs84Position`** stay flat, as decided: a field far off is placed by
  its own `UtmArea`.

### Checked by

- **Tests** (`tests/geo-frame.test.ts`, `tests/globe.test.ts`): the helpers; the world's
  own map not moved, another origin only moved; the trench field against proj4, flat
  (10 cm at 5 km) and on the globe (under 15 cm along the ground, `d² / 2R` over it,
  upright); `Globe.tangent` the identity over the disc and with the globe off, its point
  where `place` has it, and 5 km around 300 km out within 20 cm of the ground placed point
  by point.
- **The story** (ReliefTiles, `facility: 'field'`): the trench field drawn in UTM 32N,
  turned by the zones' convergence; magenta posts on its own grid 5 km out, thin cyan
  posts through them at the same points converted to the world's map and anchored one by
  one. They coincide with the globe on and off.

---

## 11. Step 6 in detail: tiles on the globe

> Decided (2026-10-26): everything placed by latitude and longitude on one sphere; tiles
> geographic, two roots of 180° × 180°; the sun's north true north; the whole globe in
> scope. Built in parts: 6a the geographic globe; 6b geographic tile keys and the builder;
> 6c the switch, drawing and every placement at once; 6d the whole globe.

### Why everything moves at once

Until step 6 the scene is drawn in the `World`'s map: the relief, the anchors, the placed
fields and the sea are carried from the map's plane onto the sphere along the line from its
centre (`Globe.place`, gnomonic). That agrees with itself, so nothing parts — but it is not
the Earth's: 15 m off at 123 km, 1 km at 500 km, and nothing past 90°. Tiles keyed by
latitude and longitude, placed where those are on the sphere, would part from all of it by
as much. So the relief, `place`, `tangent`, `foot` and the placed fields switch together
(6c), onto the same latitudes and longitudes.

### 6a: the geographic globe (built 2026-10-26)

- **The sphere is the ellipsoid's Gauss conformal sphere** (`conformalSphere`,
  `sdk/projection/conformal-sphere.ts`, free of three.js), matched at the disc's centre:
  the sphere the ellipsoid maps onto keeping angles, at scale 1 there — the one oblique
  stereographic projections stand on (proj's `sterea`, against which it is tested to a
  millimetre out to 1 600 km). Its radius there is the ellipsoid's mean radius of
  curvature: 6 387.8 km at 58.4°N. A plain sphere would part from the ellipsoid by 0.2%
  between north–south and east–west (16 m at 8 km).
- **In the map's units, turned to true north.** The scene's units are the map's (UTM's
  0.9996 at its meridian), so the radius is the map's metres per the ellipsoid's there
  times the sphere's: 6 385.6 km at Volve. True north is grid north turned by the
  convergence: −0.957° at Volve, west of its zone's meridian. Both measured with proj4
  (`placeGeoFrame` of a transverse Mercator map about the point, the ellipsoid's own).
- **Longitudes:** the conformal sphere scales them by `n` (1.00025 at 58.4°), which would
  overlap itself by `(n − 1) · 360°` opposite the field; `Δλ + (n − 1) sin Δλ` is `n Δλ`
  near the field and closes the sphere without a seam on the far side.
- **`Globe.setFrame(frame)`** gives the globe the map its X/Z are in. With it,
  `geodetic(latitude, longitude, height)` places a point anywhere on the Earth, the far
  side included, in forms about the disc's centre that subtract nothing near-equal
  (haversines), and `geographic(point)` gives it back (to 1e-9°); `place` beyond the disc
  goes through the point's latitude and longitude, `foot` back (to proj4's round trip, a
  millimetre through ED50), and `tangent` with them. Over the disc `place` is the map
  itself, as before. `location` is the disc's centre's latitude and longitude, `north`
  true north. Without a frame, nothing changes; since 6c the `World` sets one (until 7d-1 a
  stage's relief could too).
- **Against the map at the field:** 3 cm 5.5 km out, 11 cm 11 km out (a 16 km stage's
  corner): UTM's own scale changing across the field, 65 km off its meridian, which no
  sphere matched at one point follows. The bridge's clip closes the seams anyway.
- **Tested** (`tests/globe-geodetic.test.ts`): the sphere against `sterea`; latitudes and
  longitudes there and back, from the field to the far side; no seam opposite the field;
  the map at the field; `place` beyond the disc where `geodetic` has its point; a
  meridian's length; a field placed flat 5 km about the trench on the ground there.

### 6b: geographic tiles (built 2026-10-26)

- **Keys** (`sdk/tiles/geo-tile-keys.ts`): two roots, the western and the eastern
  hemisphere, pole to pole (`GEO_TILE_ROOTS`); a tile at depth `d` spans `180 / 2^d`
  degrees each way, its column running east from 180°W and its row south from 90°N.
  `geoTileRegion(key)` (west, north, span), `geoTileKeyAt(depth, longitude, latitude)`;
  packing, parents and children are the quadtree's own (`tileKey`, `tileParent`,
  `tileChildren`). At 58°N a cell is half as wide as it is tall, at 70°N a third.
- **Tiles** (`buildGeoReliefTile(reader, { layers, base }, key)`): the tile's nodes on
  its longitudes and latitudes, each layer read through proj4 from them (the relief
  contract unchanged: a layer still answers windows of its own grid). Its normals' X and Z
  are east and south where each node lies, from the ellipsoid's radii of curvature there;
  its error, its cells and a layer's feather are in metres. It takes no frame: the same
  tile in any scene. `geoReliefTileHeightAt(tile, longitude, latitude)` reads one back.
- **One builder** for both kinds of grid: a layer is prepared in a frame or, with none,
  in longitude and latitude (its distance to its edge in metres either way), and a grid
  has a cell along its columns and one along its rows, so a tile in a map is built as it
  was (its tests unchanged).
- **Tested** (`tests/geo-relief-tiles.test.ts`): keys, children, wrapping; a layer in UTM
  read onto a tile's longitudes and latitudes to a millimetre, its normals east and
  south, its leaf; the same ground as a tile in the map; a layer in longitude and latitude
  node for node.

### 6c: the relief drawn from geographic tiles (built 2026-10-26)

- **The switch.** `SceneryStageReliefTiles` keys its tiles by latitude and longitude (6b's
  keys, depth 19 at most: cells of 1.2 m north–south) and builds them with no frame, the
  same tiles in any scene. The globe needs the map its X/Z are in: the `Scenery` sets the
  `World`'s (`globe.setFrame`), or the stage its relief's `frame` where there is no
  `World`. Without either, no tiles are drawn.
- **Placed on the GPU by latitude and longitude** (`relief-tiles-vertex.glsl`). Per tile,
  its edges' offsets on the conformal sphere from the disc's centre
  (`Globe.sphereOffset`: Δχ, ΔΛ): the longitude linear from its west edge to its east,
  the latitude a quadratic through its north edge, middle and south edge. Neighbours
  share their edges' values exactly, so nothing cracks between them.
  `globeGeodetic(offset, height)` places a node (haversine forms, the far side included),
  `globeSphereOffset(p)` takes a point back (the coast's test and the tiles' own), and
  `globeGeodeticEast(offset)` gives true east there. The tiles' normals are east and
  south (6b), so the fragment turns them by east and up where they lie.
- **The quadtree takes a layout** (`QuadtreeLayout`, sdk `tiles/quadtree.ts`): its roots,
  each tile's square in the layout's own coordinates (here longitude east and latitude
  south, in degrees), how far it is, whether it shows, and how wide it is along the
  ground. The X/Z quadtree is unchanged without one. A geographic tile's distance is to
  its nearest point on the globe; it shows if it is within reach, in the frustum (a box
  over points of it, more for larger tiles, for the bulge) and its nearest point is not
  past the horizon. `selectPinnedTiles` takes the same layout.
- **The clip warps** (`HeightFieldClip`, `heightClipWarp`): what a column ends at is read
  from tiles that are squares in degrees, not in X/Z. The clip takes world X/Z there
  through a quadratic (`heightFieldWarp`, about the region's middle, longitude and
  latitude scaled to metres), fitted per region whenever the region or the globe changes
  (`geoWarp`, least squares over 5 x 5 points of the exact `geographic(place(x, z))`).
  What it leaves is cubic: on the ground 2.4 mm at the edge of an 8 km stage at 58°N,
  19 mm at the edge of a 16 km one (`tests/sky-relief-geo.test.ts`). Map-laid tiles pass
  `HEIGHT_FIELD_NO_WARP`.
- **Read back the same way:** the ground under the camera from the camera's latitude and
  longitude (`globe.geographic`); the column's relief samples through `geoAt` (a sampler
  tile is its square and its cells along and across, `ReliefSamplerTile`).
- **True north with a `World`, or a stage's relief frame (2026-10-27; the relief frame
  gone in 7d-1):** the `Scenery`'s
  default `north` is true north at the origin of the frame the globe lies on
  (`placeGeoFrame`), so the sun stands where it does on the Earth. Without a `World` the
  stage hands its relief `frame` to the `Scenery` (`SceneryOceanState.frame`), which sets
  the globe's frame from it as from a `World`'s. Before, the stage set the globe's frame
  itself and the `Scenery` could not see it: its north stayed grid north, and the whole sky
  stood turned by the map's convergence (0.94° at Volve, up to about 3° at a UTM zone's edge
  in the far north) — found by comparing the sky with an ephemeris (`astronomy-engine`) at
  Volve and ten places around the Earth. With true north, Venus and six bright stars agree
  at Volve to 0.02°. What is left far off is the globe's and the sky's own:
  - **the stars and planets**, up to 0.4° on the far side: up and north there are the
    conformal sphere's, matched at the field (0.03° in New York, Tokyo and at the poles;
    0.4° in Cape Town, Rio, Sydney; a model of the sphere predicts each to 0.02°);
  - **the sun**, 0.37° high everywhere at a 2.6° sun: its refraction at the observer
    (`solarPosition`) is in its one world direction;
  - **the moon**, up to 1.8° far off: its direction is the observer's (topocentric), its
    parallax not taken again elsewhere.
- **With the globe off** (`globe: false`), `geodetic` is stereographic about the disc's
  centre, as the GPU draws it then, and `geographic` its inverse.
- **Coarser over flat ground, by one step.** Over Volve's flat seabed, geographic tiles
  stop one power of two coarser than map tiles did (cells of 870 m against 512 m from
  3 km up): `minSlope` stops both, and a geographic tile's width falls between two map
  tiles'. At the same size their errors agree (a depth-8 geographic tile, 78 km: 5.6 m; a
  depth-4 map tile, 131 km: 22.6 m). Not a fault.
- **Not changed:** `applyGlobe` stays gnomonic (no component uses it). The overview past
  the far plane became geographic in 6d.
- **Checked:** in ReliefTiles, Lysefjord from 948 m and the Stavanger coast and its fjords
  from 108 km, with no cracks; in FieldColumn (`WithScenery`, `relief` on), the column built on
  the relief, seen through a see-through seabed, and nothing poking through an opaque
  one from straight above; StageDebug draws 65 tiles with no errors. Tested: the layout
  against the X/Z quadtree (`tests/tiles.test.ts`), the warp (`tests/sky-relief-geo.test.ts`
  and `tests/height-field-clip.test.ts`), the sampler (`tests/relief-sampler.test.ts`).
- **Not yet checked:** pictures against the map-laid relief and the frame's cost; a seam
  at a grazing view; a dark band seen once on the horizon with the sea off (possibly
  older); `GL_INVALID_VALUE` warnings from `glGetProgramiv` at load.

### 6d: the whole globe (built 2026-10-26)

Decided: a world relief at 10′; the overview geographic; a minimal look from space (the
night side dark, the sea lit where it lies), a physical atmosphere left for the 3D clouds.

- **A world relief:** `etopo-2022-world`, ETOPO 2022 at 60″ read every 5th value and
  averaged 2 × 2 to 10′ (2160 × 1080, 9.3 MB; `scripts/generate-relief.js`, a relief's
  `stride`), first of the demo layers, the Nordic one now faded into it over 20 km.
- **Tiles seen far off (the relief that went missing from afar):** a tile's point nearest
  the eye was its latitude and longitude clamped apart, which east or west of the tile
  lies tens of degrees from the nearest along the sphere, so the distance came out too
  long and the horizon test hid tiles in view. Now `geoTileNearest` finds it on the
  conformal sphere, where a tile is a rectangle of latitude and longitude too: on the
  eye's meridian where the tile spans it, else on its nearer side's, at the latitude
  nearest along it. The horizon test lets ground `high` up show past the sea's horizon as
  far as it can (acos(R / d) + acos(R / (R + high)); it had used the height alone, which
  hid mountains peeping over the horizon), and the frustum test pads a tile's box by the
  sphere's bulge between its points (`Globe.sphereAt`, the CPU twin of `globeGeodetic`
  from an offset). Tested by brute force (`tests/sky-relief-geo.test.ts`): eyes from
  100 m to 20 000 km, tiles of every depth, each sampled densely: any of it in the frustum
  and over the sea's sphere keeps it, and its distance is never too long. The old tests
  failed it from 10 km up, a whole root missed from 2000 km.
- **Across a coast, the cells:** a tile across sea level is split for its cells whatever
  `minSlope` says (tiles.md, `rough`): from 18 000 km 24 tiles of 78 km cells, not the two
  roots.
- **The overview, geographic:** the first layer resampled onto longitude and latitude
  (`resampleReliefGeographic`; the `sceneryRelief` generator, gone since 2026-10-29: the
  overview now reads the relief's own tiles), read where each view meets the
  globe's sea through `globeGeographic` (GLSL, the twin of `Globe.geographic`, from the
  globe's new `uGlobeLocation`): from anywhere with any far plane; made the first time
  it is needed (tiles.md, [The overview](./tiles.md#the-overview)).
- **From space** (scenery.md, [From space](./scenery.md#from-space-built-2026-10-26)): from 100 to
  1000 km up the sea and the relief are shaded by where they lie, so the night side is
  dark and the sea glints; the rim over the Earth's edge is dark over the night side; the
  stars and the sea's layer test the camera's own horizon.
- **The stage, to 3000 km:** its reach was the far plane; at 50 000 km its flat planes
  claimed the whole Earth and drew nothing of it. Past 3000 km (`STAGE_REACH`) the sky
  draws the sea.
- **The sky's view ray** is rebuilt from NDC depth 0, not the far plane: with a far plane
  of 50 000 km over a near one of 0.1 m, −(f + n) / (f − n) rounds to −1 in 32-bit floats,
  the far plane's point to infinity, and the ray flipped.
- **The light probe** keeps the last good bake over one that is not finite: a bake made as
  the page opened with the camera in space came out NaN once, and since a probe lights the
  next bake's seabed, every bake after it did too, and the relief went black. Why that
  first bake failed was found in 6e: the sea's Fresnel, looking straight down.
- **The `Earth` story** (ReliefTiles): a far plane of 50 000 km, the camera 20 000 km out,
  the real sky for the date. The procedural stars under the real ones are fainter now
  (scenery.md, Stars).
- **Seen:** the Earth from 20 000 km, lit by day, the terminator soft, the night side dark,
  the far side (Africa, Madagascar, Antarctica) whole; from 3000 km Greenland, Iceland and
  Scandinavia in the world's and the Nordic relief, the rim over the edge; the overview
  past a 200 km far plane; the field from 1 km as before.
- **Not done:** timings from space; poles and the 180th meridian close up (a world layer's
  grid edge there takes the edge's values, no wrap, so a tile's border normals there are a
  little off); the overview's grid crossing the 180th meridian unless it goes all the way
  round; the sky's gradient far round the Earth at low altitude (step 4: the field's up).

### 6e: clean-up (built 2026-10-26)

- **The light probe's NaN, found:** the sea's Fresnel raised 1 − cos θ to a power. Looking
  straight down on a flat sea, cos θ rounds a hair over 1, and `pow` of a negative number
  is NaN on D3D (ANGLE), so a bake from straight above came out NaN. Both Fresnels are
  clamped now (`oceanFresnel` in ocean-surface.glsl, the underside's in sky-ocean.glsl).
  The probe's guard (6d) stays: a probe lights every later bake.
- **The `glGetProgramiv` warnings** come only right after a shader is edited under Vite's
  hot reload: none on a clean load, a reload or a story switch.
- **One radius:** the cloud deck's sphere and the horizon's dip (`Scenery`, the debug panel)
  take the globe's radius, the conformal sphere's matched at the field, not the mean
  Earth's `SCENERY_EARTH_RADIUS`: 14.6 km apart at Volve. The deck's is refreshed with the
  camera (`SceneryMaterial.syncCamera`), so a frame set later moves it too.
- **Seen:** both poles from 3000 km whole; the 180th meridian from 600 km (Fiji) with no
  seam.
- **The stage's claim far off:** the stage takes the sea where a view meets it inside its
  rectangle, flat in the field's plane, within 3000 km. Two places broke it:
  - From 400 km at 85° N a straight black line across the sea. The camera lay just off the
    rectangle, where the stage's sunk planes do not cross every ray it claims, so the void
    showed.
  - From 2300 km over the Tasman Sea, 159° round from the field, a dark diamond with bare
    seabed in it. A point on the far side of the Earth projects back inside the rectangle,
    where the stage draws nothing.

  Now the stage claims only while the camera is on the field's half of the globe and over
  the rectangle (`SceneryMaterial`'s `claimStage`, on the CPU with the camera). Then every ray
  it claims crosses its planes, which lie over the rectangle between the camera and the
  globe. Crossing the rectangle's edge, 3000 km out, shows no change.
- **Found for step 4,** far from the field below 1000 km, where the field's up still
  counts: over Fiji, 129° round from the field, a disc about the camera's foot
    where the sea's layer leaves the sky's own sea, lit differently: its test of what is
    above the horizon mixes the field's up with the camera's through the space band, and
    looking down there the field's up says above.
  - There, at local midnight, the islands dark but the sea lit: the sea's light is the
    field's, in daylight.

---

## 12. Step 4 in detail: the sky anywhere on the globe

Decided (2026-10-26): **the world stays fixed**, and the sky's look frame follows the
camera. Only the sky's own light follows the camera's place; the scene's lights and the
bakes stay the field's, where the data is. Far from the field the waves take charts fixed
on the Earth ([4d](#4d-the-waves-far-off-built-2026-10-27)). Built 2026-10-26–27: 4a–4f,
but for the pixel A/B, dropped.

Moving the world under the camera, as §6 first had it, would change every placed thing's
matrix each frame and need the host's controls moved by a callback. The sky only needs to
know which way is up where the camera is.

### Two frames

- **Place:** the field's up, north and east (`uSkyUp`, `uSkyNorth`, `uSkyEast`). They hold
  where things lie: the stage, the void and its walls, the cutaway, the sea's and the
  void's levels, the wave plane over the field, and the cloud deck's pattern.
- **Look:** the camera's up. It is the scene's over the disc and eases to the globe's
  radial past the disc's edge, so crossing the edge does not pop (the globe's up jumps
  there by the disc's radius over the Earth's). It holds how the sky is seen: the
  gradient's elevation, the horizon, the twilight's bearing, the haze's horizon colour,
  the cloud band, the sea layer's test of what is over the horizon, the stand-in, and the
  sun's elevation for the sky's light.

Over the disc the two frames are the same, so the field is drawn exactly as before.

### Where each is used (the audit)

About 30 uses switch to the look frame; about 70 stay with the place.

| Where | Look | Place |
|--|--|--|
| `globe.glsl` | `globeHorizonFrom`'s sine, for the camera (`globeCameraHorizon`): from the look up; outside the flat cap the horizon is then the dip all round | `globeHorizon(origin, …)` for other origins, the cap, `globeUpAt`, the reach |
| `sky-gradient.glsl` | `skySurfaceSeen` (elevation, twilight's bearing), `skyHorizonColor`, `skyAirHeightFrom`, `skyOverSeaHorizon`, `skyLight`'s sun elevation | — |
| `sky.glsl` | `skyAir`'s elevation, blend and the sun over the horizon; `skySunGlare`'s side; `skyCloudBand` (elevation, bearing, level); `skyClouds`' elevation and hinge | the deck's pattern (its hit along east and north, the slope, toward the light); `skyOceanPlane`; the void (lid, rock, walls, haze); the buried camera's origin |
| `sky-ocean.glsl` | `skyOceanThroughAir` (bearing, the sky overhead); `skyOceanSurfaceLayer`'s over-horizon test; the flat `skyOceanReach` (globe off, so the same) | the cutaway (5 uses); the waves' chart (`oceanChartAt`, see 4d) and their up; `skyOceanInWater` and `skyOcean`'s seabed (in the water or dry, which is at the field); `skyOceanThroughCutaway` |
| `relief-fragment.glsl` | the air's colour over the relief, the blend | the void through the cutaway |
| `stage-fragment.glsl` | the blend, the elevation | the stage's own offset |
| `sky-stand-in-fragment.glsl` | the elevation | — |
| abyss walls, `subsurface-fragment.glsl`, `SceneryAbyssWallLayer` | — | all (under the field) |
| `sky-material.ts`, `sky-baker.ts` | — | the frame's uniforms; the bake keeps the field's |

### 4b: the sky's light at the camera's place

- The sun's elevation where the camera is, asin(sun · look up), sets the sky's light:
  daylight, twilight, moonlight and the sun's colour, and `setAirLight` with the dip as
  now. The sea's and the air's light both take it.
- The scene's lights and the bakes keep the field's (`setSun`'s elevation): data is lit
  the same wherever the camera goes. The bake sets the sky's light uniforms back to the
  field's.
- Over the disc the look up is the scene's, so the numbers are unchanged.
- From space, what lies below stays lit where it lies (`skyFromSpaceOver`).

### 4c: the look frame

- The `Globe` gets the look up for the camera, eased as above, as a uniform.
- `globeCameraHorizon` returns the horizon's sine from the look up.
- The look uses above take the look up instead of `uSkyUp`.
- 6d's special cases for space fold into it: `skyOverSeaHorizon`, the surface layer's
  over-test and the clouds' elevation then need no mix toward the camera's up. This
  also fixes the disc over Fiji (6e).
- Checked by a pixel A/B at the field.

### 4d: the waves far off (built 2026-10-27)

The wave plane was the field's level, so far round the Earth it collapsed: a quarter of the
way round (Rio) the sea is seen edge on to it, and the waves streaked toward the horizon.
And a world position 10 000 km out has about 1 m of float precision, too coarse for 10 m
waves.

Decided (2026-10-26): **fixed charts on the Earth**, so the sea is a function of the place
and the time alone, ready for waves driven by data (wind at points or on a grid). A chart
that followed the camera would have made the sea depend on the camera's path.

- **`OceanCharts`** (sdk, `projection/ocean-charts.ts`, and `ocean-charts.glsl`):
  - **the field's chart** out to 1000 km from the disc's centre
    (`OCEAN_FIELD_CHART_REACH`): stereographic about it, the wave plane over the disc
    (world X/Z there, within a centimetre 100 km out), so the field is drawn as before;
  - **fixed charts** about the 162 points of a geodesic sphere (an icosahedron, each face
    split 4 times), about 2000 km apart, fixed on the Earth by the globe's frame. Each point
    takes the nearest. Stereographic, so conformal, and within a chart stretched by under 1%;
  - **the wind:** each fixed chart's X has the compass bearing at its centre that the wave
    plane's X has at the field, so the waves keep the wind's bearing;
  - **where two meet:** the waves calm over a strip 8 km wide (`OCEAN_CHART_CALM`), down to
    the glint their slopes give, and the charts switch on its middle, where there are none
    to seam. Cross-faded instead, the waves are summed twice; the second sum cost the stage
    1.4–2 ms at the field, even where no pixel ran it (D3D), so the strip it is;
  - **precision:** the camera's coordinates in each chart are worked out on the CPU in 64
    bits (`setCamera`, from `SceneryMaterial.syncCamera`), and a pixel's from its offset from the
    camera, in terms that subtract nothing near-equal. Emulated in 32-bit floats, a point
    at the antipode lands within 0.15 m of its exact place;
  - **one chart for the frame:** while no line where two charts meet lies within the waves'
    fade (`detailFadeDistance`, 60 km) of the camera, every pixel takes the camera's chart
    (`uOceanChartOnly`) and none looks for its own. That is always so at the field.
- **The sky's sea** takes it everywhere the waves are drawn: its surface layer, a stage's
  surface, and the view from in the water (`skyOceanWave(delta, up, …)`, the normal turned
  from its chart onto the globe there). The stage's rectangle, the cutaway and the floating
  objects' contact foam keep the field's plane. With the globe off (and in the bakes), the
  field's plane.
- **Checked:** at the field, charts on and off differ by at most one level in 255 (mean
  0.001); at Rio, the antipode and Antarctica the waves look as at the field, at noon and
  sunset; straight down on a line between two charts from 300 m and 1.5 km, and across it,
  no seam. Timed (GPU ms, median, 1746 × 1088): the stage at the field 7.18 / 7.22 at 40 m
  level and 3 km 30° down, against 7.08 / 7.10 before; the background and the relief the
  same. Far off the sea is drawn by the background's surface layer: 4.1 ms at Rio, the same
  on a chart line, about what the stage's surface costs at the field.
- **Next, for data-driven waves:** a field of wind (speed and direction) by latitude and
  longitude, read where each pixel's waves are drawn, scaling the wave set's amplitudes
  (and their slope variance for the glint); the wave set itself stays the same everywhere,
  so the waves never tear where the wind turns. A CPU sampler of the sky's sea for floating
  objects far off (the Ocean's `OceanSampler` is the field's plane's) takes `OceanCharts`
  the same way.
- **Not done:** the cloud deck's pattern is still laid on the field's plane and streaks far
  off; left for the 3D clouds (step 8), which can take the same charts.

### 4e: a level horizon for a host (built 2026-10-26)

The library never changes the camera's controls unless asked. `useLevelHorizon()` (Sky)
is the asking: each frame it sets the camera's `up` to the up the sky is seen by there
(`Globe.lookUp`: the scene's over the field, the globe's far off, eased between, so
nothing turns at the disc's edge). It does so only once that up has turned 0.25° (`step`),
and not above 100 km (`below`), where the up runs along a view down at the Earth.
- With default controls that take a new up (`makeDefault`; camera-controls, drei's
  `CameraControls`), their orbit is re-based on it (`updateCameraUp`), keeping where the
  camera is and where it is heading. three's `OrbitControls` read the up only when made,
  and are not levelled by it.
- Turned off or unmounted, it puts the camera's own up back.
- Inside a `Scenery`, or a `World` holding one, or with its `globe`.
- ReliefTiles' `levelHorizon` turns it on (on in its Earth story). With it the tour below
  is level everywhere, within 0.1°; without, at Rio, the antipode and Antarctica the
  horizon stands on end or upside down, as the field's up there says.

### 4f: checks

- A pixel A/B at the field, at noon, sunset and night: dropped (2026-10-26). Steps since
  have changed the field's look on purpose.
- A low-altitude tour far from the field at noon, sunset and night: the North Sea, Rio,
  the antipode, Antarctica (done 2026-10-26, 300 m up, looking 3° down, away from the sun
  at noon and into it at sunset).
  - **Light:** right everywhere: the sun's elevation where the camera is sets the sky's
    light (4b), so each place has its own noon, sunset glow and night.
  - **Horizon, twilight's bearing:** right, by the look frame (4c).
  - **Found and fixed:** the waves' reflection was turned into the field's frame
    (`globeUnturn`), so far round the Earth part of the sea reflected the sky below the
    horizon. At Antarctica's and Rio's sunset half the sea was dark, edged hard along the
    waves' tilt. It now turns onto the look up (`globeTurnFrom`), the same over the field.
  - **The waves** streaked toward the horizon a quarter of the way round the Earth (Rio),
    where the field's plane is seen edge on: fixed in [4d](#4d-the-waves-far-off-built-2026-10-27),
    after which the tour looks the same at all four places.
- Timings (2026-10-26, ReliefTiles, 1746 × 1088 pixels, GPU ms median; the 2e numbers
  were at a smaller window, so they compare only roughly):

  | Pose | Frame | Background | Relief | Stage | Sea layer | Main thread |
  |--|--|--|--|--|--|--|
  | 40 m over Volve, level | 12.9 | 3.1 | 1.9 | 7.1 | 0.3 | 4–6 |
  | 3 km, 30° down | 14.8 | 0.5 | 6.9 | 7.1 | 0.04 | 8–10 |
  | 100 km, level | 11.5 | 4.3 | 4.2 | 2.5 | 0.3 | 9.5 |
  | 500 m over the coast | 11.7 | 3.0 | 3.7 | 4.4 | 0.3 | 7.3 |
  | 1500 m over Lysefjord | 11.4 | 3.0 | 4.2 | 3.7 | 0.3 | 2.8 |
  | 50 m down, in the water | 8.0 | 0.8 | 3.8 | 2.9 | — | 9.7 |
  | 600 m below the seabed | 4.4 | 1.0 | 0.4 | — | — | 4.2 |
  | 400 km, to the Earth's edge | 14.7 | 3.7 | 7.6 | 2.9 | 0.3 | 11.6 |
  | 2500 km over the Atlantic | 16.3 | 8.8 | 4.9 | 0.6 | 1.8 | 12.5 |
  | 2500 km, the day/night line | 15.7 | 8.9 | 5.1 | 0.06 | 1.4 | 12.5 |
  | 15 000 km, the whole Earth | 13.9 | 10.7 | 2.1 | 0.1 | 0.8 | 8.7 |

  The relief's column includes its overview past the far plane. Below the seabed, where
  the data is, the sky costs 1.4 ms in all. From space the background costs the most, 9–11 ms,
  though most of the view is black: left for a pass on what it shades there, before the 3D
  clouds add to it. The main thread's 9–12 ms from high up is to be looked at with them.
  The Lysefjord preset at 500 m now lies inside the mountain (665 m there), where nothing
  of the sea or the relief is drawn, so it is timed at 1500 m.

---

## 13. Step 7 in detail: more than one field

> **Status (2026-11-02): 7a–7f built; 7g designed.** The `World` holds where things are
> and draws nothing; the relief becomes Earth data of its own; switching from one field to
> another is a controlled switch, applied by the library in one frame and timed and covered by
> the host. The estimates below were measured in 7a ([7a and 7b, built](#7a-and-7b-built-2026-11-02)).

### Why it changed

Two designs came before this one:

- **The selected field as the `World`'s frame, switched seamlessly** (2026-10-30): re-origin
  on selection, the camera carried through a hook, the flat disc morphed. The Earth's shape,
  the coordinates and the disc changed together. The camera's move was affine (a field's
  placement carries its map's scale and `Globe.tangent`'s squeeze: 0.1–0.3%, so 5–15 m off
  5 km from its target); the morph moved the ground beyond the discs by `r² / 2R` (10–30 m);
  the waves re-phased out to 1000 km (`OceanCharts`,
  [4d](#4d-the-waves-far-off-built-2026-10-27)); and some caches would miss the switch.
- **A seamless switch on a fixed Earth** (2026-11-02, morning): the Earth in true metres,
  fitted once per `World`, a cut per stage that every field always lies on, cuts switched by
  the camera's distance. Nothing to cover, but a good deal of machinery for it, and a field at
  home 3 m bigger at 8 km.

Accepting that the switch is a discontinuity, timed by the host and covered as it likes (a
fade, say), keeps what is built: the `World`'s frame is the anchored stage's map, the Earth
fitted there and cut flat over its disc. Nothing at the switch needs to be seamless,
overlapping stages and mixed projections need nothing more, and a field at home is placed
exactly as today.

And today the scenery owns the globe (`SceneryMaterial.globe`, handed to the `World`): without
a `Scenery` a `UtmArea` is placed flat, and the geographic layers on a globe that does not
curve (`useLayerGlobe`), so toggling the scenery moves the trench field, 123 km out, by
1.2 km. Most hosts will leave the scenery off and turn it on now and then, their data being
subsurface: where things are placed must not depend on it.

### Who holds what

The `World` holds where things are, and draws nothing. What is drawn is optional, and placed
by it (decided 2026-11-02):

| Part | Holds or draws | With what |
|--|--|--|
| `World` | the anchor (its `frame`), the disc (`bounds`), the globe (its shape, curved or flat), the switch and its hooks, the place the sky is seen from | always; draws nothing |
| The relief | seabed and land from tiles; the see-through over loaded fields | the `World`'s globe; shaded plainly without a sky, by the sky with one ([The relief](#the-relief-earth-data-of-its-own)) |
| Layers | global data: geographic layers and tiles | the `World`'s globe, with or without a sky (as now) |
| `Scenery` | air and clouds, sun, moon and stars, the ocean, the void | optional; on the `World`'s globe, the observer at the `World`'s place |
| The anchored stage (`SceneryStage`) | the sea plane over the disc, the cutaway, the void's walls; its columns' bridge to the relief | the `Scenery` |
| Fields (`UtmArea`) | their data | placed by the `World` |

### The anchor: the World's frame

- **The anchor is the `World`'s `frame`:** the anchored stage's map about its origin, as step 3
  built it. World X/Z are that map's, Y up; the globe is fitted there (the conformal sphere
  matched at the disc's middle, in the map's units, step 6) and cut flat over the disc, so the
  anchored stage's fields meet the sea and the relief exactly. A field at home is placed
  exactly as today.
- **The disc is the `World`'s** (`bounds`, the anchored stage's area, as `SceneryStage`'s
  `bounds` gives it today); `SceneryStage` takes it from there by default. With no stage
  drawn the globe is still cut there, so nothing placed depends on the scenery.
- **The `World` owns the `Globe`:** the `Scenery` draws on it, and makes its own only without
  a `World`, as now. Curved or flat is the `World`'s choice, for everything (the `Scenery`'s
  `globe` switch moves to it), never a side effect of drawing the sky. Toggling the scenery
  moves nothing.
- **One counter** for everything derived from placing: `globe.version` (its frame, disc,
  level, up, radius and switch). `SceneryStageReliefTiles` (the see-through tiles, and the
  ground it hands to columns), `GeoSymbols`, `GeoTileLayer` and `geo-tile-layer.ts` keyed on
  the disc's centre and the globe's radius, and could miss a switch between two stages each
  laid about its own origin; they key on it since 7b, as the tiles' own choice and
  `geo-tile-globe.ts` did already.
- **Stage or global is no switch:** the cut stays with the anchor — `r² / 2R` of flattening,
  unseen from a regional view — and how much of the anchored stage is drawn in detail goes by
  distance, as level of detail.
- **Precision:** placed fields keep theirs (64-bit model-view per draw); only what a shader
  takes through world positions is coarser far from the anchor (3 cm at 300 km), where the
  camera is usually high.
- **Not the Earth's centre (ECEF):** hosts need Y up near their data, and a point 6 400 km out
  has steps of 0.5 m in 32-bit floats.

### Switching the anchor: a controlled switch

The host asks by changing the `World`'s `frame` and `bounds`, when it chooses; the library
applies them together and tells it (built in 7c):

```tsx
<World
  frame={anchor.frame}
  bounds={anchor.bounds}
  onFrameChange={({ from, to, matrix, carry }) => carryCamera(carry)}
  onFrameSettled={() => uncover()}
>
  …
</World>
```

- **In one frame:** the frame, the disc and the globe change together, in the `World`'s layout
  effect, synchronously after the render that changed them and before the next frame, so no
  frame is drawn half old and half new.
- **`onFrameChange`,** once, before the first frame drawn with the new frame, with two ways to
  carry what the host keeps in the scene's coordinates — its camera's position, its controls'
  target and its up, bookmarks, picks — or it sets a new view. The library never moves the
  camera ([§7](#7-decided-2026-10-26)).
  - `carry` (`globeCarry`): points by their latitude, longitude and height over the sea, from
    the globe as it lay (`Globe.clone`, taken before the change) onto the globe as it lies;
    directions by where they lead a short way on. Exact wherever the globe places things — a
    camera over the ground, the relief, the layers — at any distance.
  - `matrix` (`geoFrameChangeMatrix`): the inverse of where the new field lay, about its
    stage's middle. Exact for the new field's own content, an affine fit elsewhere: the new
    field's scale and squeeze, so a camera 500 m over a field 123 km away lands 37 m low.
- **`onFrameSettled`,** after the first frame drawn with everything placed anew: the fields'
  groups, the layers laid again, the relief's tiles placed again (they keep their keys,
  latitude and longitude); two animation frames after the change. What still loads — tiles
  for a new view, the sky's bake (250 ms after the sky is still) — reports through the progress
  reports (`Scenery.onProgress`, `ProgressStore`), which a host may wait on too, within a time
  limit.
- **The sdk helpers** (`geoFrameChangeMatrix`, `globeCarry`, `Globe.clone`) give the same for
  any two frames, so a host converts positions it keeps without the event.
- **What changes at the switch,** for the host to cover or accept: the Earth fitted again (its
  radius in the new map's units) and its flat disc moved (`r² / 2R`: 10–30 m); the waves
  (their charts are the anchored field's, 4d); the bake's light, a moment later; which of two
  overlapping fields is exact. Switched with the camera far off or high, most of it is under a
  pixel.
- **The host covers it as it likes.** The story shows a fade: a curtain over the canvas closes
  (250 ms), the story changes `frame` and `bounds` and carries its camera on `onFrameChange`,
  and the curtain opens once settled and the progress is quiet (at most 3 s). The library
  draws none: the host's pipeline and look are its own.

### Overlapping stages and mixed projections

There is one cut, the anchor's, so stages may overlap, and fields near each other may use
different projections. The anchored stage's fields are exact in their own map; any other field
is placed by one matrix fitted at its stage's middle (`placeGeoFrame`, then `Globe.tangent`).
Where they overlap, the two part by:

| Case | In the overlap |
|--|--|
| One projection and datum, other origins | nothing: only moved, exactly (step 3) |
| Neighbouring UTM zones, one datum | the maps' second order: 10 cm at 5 km and 40 cm at 10 km from the other field's middle, about 0.5–1.5 m at a large field's corner |
| The curve, vertically | for a field whose middle lies in the anchored disc, nothing (`Globe.tangent` is the identity there: it lies flat on the same plane); otherwise up to `d² / 2R` toward its edges |
| Other datums, or one datum with other shift parameters (ED50 to WGS84 by 3 or by 7) | metres, but in the data: each field is drawn where its own CRS says |

- **Unseen** unless both fields draw the same thing — a seabed, a well — which then shows
  twice: each drawn from one source.
- **A pick is exact either way:** it goes back through its own field's placement, so it
  returns that field's own coordinates. Only where two fields' data lie relative to each other
  carries the error.
- **Switching the anchor swaps which field is exact:** in the overlap the two part
  differently after it, by up to a metre or so, covered with the rest.

### Fields as groups

A field is a group placed on the globe — a `UtmArea` with its own `frame`, as step 3 built it:
its data flat in its own UTM (X east, −Z north) about its origin, the group placed by
`placeGeoFrame` and `Globe.tangent`, turned to the globe's up there, so it tilts with the
Earth while its data stays flat relative to each other. It pivots at its stage's middle, not
at its frame's origin, which may lie anywhere (its `bounds`, since 7c): the gaps below grow
with the square of the distance from the pivot. Precision is not a concern: three.js composes
each draw's model-view matrix in 64 bits, and 25 km offsets are millimetre steps in 32-bit
floats.

- **The anchored stage's fields** work as today: in the `World`'s frame, with the cutaway, the
  columns and the relief bridge, at full detail.
- **Every other loaded field** is drawn too, with its data, wherever it is: a field is not
  only seen while anchored. Which are loaded, and at what detail, is the host's choice, by
  distance (see [Data](#data)). Columns end at the relief through the bridge, the anchored
  stage's only, so a neighbour's would end unbridged: wells and surfaces are the likely set
  (to be settled with 7a).

### Field sizes and the Earth's curve

A flat field parts from the curved Earth by `d² / 2R` at `d` from its pivot. Fields as
squares (real ones are not):

| Field | Area | Side | Edge (half side) | Corner | At the edge | At the corner |
|--|--|--|--|--|--|--|
| The demo stage at Volve | 256 km² | 16 km | 8 km | 11 km | 5 m | 10 m |
| A large field | 200–300 km² | 14–17 km | 7–9 km | 10–12 km | 4–6 m | 8–12 m |
| Troll, among the largest | ~750 km² | ~27 km | ~14 km | ~19 km | ~15 m | ~29 m |

A large field is the size everything is built and tested at already: only the largest go past
it. Over the anchored stage's disc the sea is flat and the gap is absorbed there; its radius is
half the stage's diagonal, so the corner's figure is also how far its cut lies under the
sphere at its middle. A neighbour, tilted with the globe at its pivot, stands off the curved
sea and relief by these amounts toward its edges: unseen from afar, a wellhead a few metres off
the seabed close up, tens of metres for one of Troll's size.

Placed from another UTM zone, a field is off by the two maps' second order too, which grows
with the square of the distance from its pivot: measured 10 cm at 5 km and 40 cm at 10 km
(step 3), so an estimated 0.5–1.5 m at these sizes.

### The relief: Earth data of its own

The relief — seabed and land from tiles — is Earth data, as the geographic layers are, not a
part of the sky: a host shows it with the scenery off, bathymetry and topography under its
data. Until 7d-1 `SceneryStage` drew it (`SceneryStageReliefTiles`), with the sky's material
and shading: its sea, air and void (`sky.glsl`). Decided (2026-11-02): a component of its own,
`GeoRelief`, inside the `World`, drawn once whatever the stage (built in two parts:
[7d-1](#7d-1-built-2026-11-02), the sky's shading kept, and [7d-2](#7d-2-built-2026-11-02),
without a sky):

- **Placed on the `World`'s globe,** by latitude and longitude as before
  (`relief-tiles-vertex.glsl`, `globeGeodetic`), its globe the `World`'s.
- **Shaded plainly without a sky:** its looks (`SceneryReliefLooks`: colour by height,
  contours), lit by the host's lights. With a `Scenery`, by the sky as before — the sea's fog
  over the seabed, the air, the void's lid from below. Without one, nothing from below (the
  data under the seabed unobstructed), no overview past the far plane.
- **What it hands out stays,** through the `World` (`WorldReliefState`): the ground under the
  camera, the ground over the anchored stage's columns (the bridge, its `grounds`), its
  sampler, and its tiles to what lies on them (`SceneryReliefHub`).
- **The see-through over loaded fields is its own** ([below](#the-seabed-see-through-over-each-loaded-field)),
  at the sea's `seabedOpacity` with a `Scenery`, at an opacity of its own without.

Larger than the rest of step 7: a step of its own (7d), in two parts.

### The void: the seabed's underside, everywhere

Built in 7e ([7e, built](#7e-built-2026-11-02)). The void's lid is the relief's underside
already, wherever its tiles are drawn, whatever the stage. What still belonged to the field
was its shading and its levels:

- **Shading:** the void's gradient, its darkening with depth and the lid's shading were laid
  out in the field's place frame (`uSkyUp`, `uSkyNorth`, `uSkyEast`), so far from it the void
  was black ([relief.md](./relief.md)). They move to the camera's own up, which the sky already
  has (the look frame, step 4).
- **Levels:** the background's lid and the depths it darkens by were planes along `uSkyUp`
  (`skyAbyssLidStart`, `uSkyAbyssLevel`): 100 km off, that plane lies 785 m over the curved
  seabed. Far from the stage they go to the globe — the lid at the seabed's altitude, the
  darkening by depth under it, as the relief's underside already takes the camera's
  altitude — or are left to the relief's underside where its tiles are drawn.

The void's walls stay with the anchored stage, or are left out: they are the least of it.
Field data seen from the void is hidden by depth alone (`layerShownAt` is the geographic
layers' test), so a neighbour's wells show from there already.

### The seabed see-through over each loaded field

Built in 7e ([7e, built](#7e-built-2026-11-02)). The relief was see-through, at the sea's
`seabedOpacity`, only over the stage's `bounds`: an axis-aligned box in world X/Z
(`uReliefStage`, tested on `vReliefPlane` in `relief-tiles.glsl`), whose tiles are drawn a
second time, see-through, while the opaque draw leaves the box to them. Around it the relief
is opaque, so a neighbour's wells under its seabed were hidden from above. A short list of
regions, one per loaded field, makes it see-through over each:

- **Each region in its field's frame:** its inverse placement (world X/Z to the field's own, a
  2D affine) and the field's bounds, the anchored stage's being today's test. Not in latitude
  and longitude: a field's rectangle is turned from the graticule by its grid convergence
  (1–3°), up to about 0.5 km at a 16 km field's corner.
- **Counted once:** a pixel in any region is see-through once, where regions overlap too; and
  the see-through draw takes the tiles over every region.
- **Its cost** is a second draw of the tiles over each loaded field, not only a uniform; a
  fixed most (a define), the loop written with one return (see
  [The camera, once per draw](#the-camera-once-per-draw)).
- **The water over a neighbour:** the stage's sea reaches `min(camera.far, STAGE_REACH)` about
  the anchored stage; beyond it the background's sea, drawn on the far plane, hides nothing.
  With a short far plane, a neighbour farther off has no water drawn over it. Checked in 7e:
  with `STAGE_REACH` 3000 km, the water is drawn over a neighbour 123 km off, its reservoir
  seen through it and its see-through seabed.

### The cutaway

The anchored stage's, as now. It takes only the sea, the seabed and the void, so the data of
other fields within sight stays drawn through it.

### Bending a neighbour, if it shows

A neighbour laid flat on the globe's tangent at its pivot stands off the sphere by `d² / 2R`.
Lowered by that along its own up, in its own frame, before the model matrix, it lies on the
Earth: one shared vertex chunk with a uniform per field (its pivot and `R`; nothing for the
anchored stage's fields, so a switch sets uniforms and compiles nothing). Every field material
needs it — chunks and their caps, surfaces, wells, fences and cut planes — and GPU picking too.
Not `applyGlobe`: it works through world positions (3 cm steps at 300 km, against
[What to keep doing now](#5-what-to-keep-doing-now)), and the group's matrix places the field
already. The maps' second order (0.5–1.5 m) stays. Built only if 7a shows the seam; more likely
for fields of Troll's size than for a large one.

### Data

The `Store` interface (`get`, `all`, `query`) is enough as it is:

- **A `field` data set:** its id and name, its `GeoFrame` (or CRS), its outline in latitude and
  longitude (for distances and the minimap) and in its own frame, its stage, and the id of its
  seabed's relief layer. The host decides from it alone which fields are near and which stage
  to anchor, before any of their data is loaded.
- **Stages:** each its id, its frame (a map about its middle) and its bounds; the fields that
  share one name it. Anchoring one is giving the `World` its frame and bounds.
- **Data of the Earth, by global id:** the relief's layers (`relief-meta`, `relief-values`)
  — each field's seabed one of them — and overlays in latitude and longitude. None names a
  field.
- **Data of a field:** `wellbore-headers`, `position-logs`, `surface-meta` and `-values`,
  seismic, …, in the field's own CRS, with globally unique ids and a `fieldId`:
  `store.query('wellbore-headers', { fieldId })`. One store serves every field.
- **One relief, all fields' seabeds in it:** the relief's layers are one list, coarse to fine
  — ETOPO, EMODnet, …, then each field's seabed (`surfaceToRelief`, as the demo store's
  `surface:<id>`), empty outside its footprint and feathered in. Every field's seabed is in the
  relief at once, whichever stage is anchored; where surveys overlap, the later wins. The
  relief belongs to the Earth, drawn once, not to the anchored stage: a component of its own
  (7d), the stage's bounds, occupants and the ground handed to columns staying the anchored
  stage's. Up to 31 layers have looks of their own.

### Wellbores as an Earth-level layer: a step of its own

Moved out of step 7 (2026-11-02): a feature of its own, not needed for more than one field.
Besides each field's own wells in its group, the wells of a region as one layer on the Earth,
as the geographic layers are ([layers.md](./layers.md)): each trajectory node placed by
latitude, longitude and true vertical depth, as `GeoTubes` places a pipeline's nodes
(`conformalOffset` on the CPU, `globeGeodetic` on the GPU), drawn with the pieces `GeoTubes`
and `Trajectory` share (`tube-segment.glsl`, `tube-rim.glsl`, `createTubeSegmentGeometry`),
and loaded by geographic tile and distance. Its design must settle:

- **The seabed:** a geographic layer does not show through an opaque seabed, so the wells of
  fields not loaded are hidden from above except over a see-through region or from the void;
  drawn over the sea as a map far off (`drawOverSea`), say. It tests `layerShownAt` with
  `lies` at its depth.
- **One well, one source:** a field's group or the layer, never both. Over the disc the two
  differ by 3–11 cm (the sphere against the map,
  [6a](#6a-the-geographic-globe-built-2026-10-26)), enough for two tubes to flicker against
  each other.

### Order of work

| # | Step | Ends with |
|--|--|--|
| 7a | A story with two fields of realistic size (a large one, and one of Troll's size) in two UTM zones, and a third overlapping one in another projection; the scenery toggled | ✅ built (2026-11-02): the seams measured at a neighbour's edge and in the overlap, and the scenery's toggle moving data shown |
| 7b | The `World` holds the reference: the `Globe` and the disc (`bounds`) moved to it, curved or flat its choice; everything derived from placing keyed on `globe.version` | ✅ built (2026-11-02): toggling the scenery moves nothing |
| 7c | The controlled switch: `frame` and `bounds` applied in one frame; `onFrameChange` with its matrix, and `onFrameSettled`; the matrix as an sdk helper; fields pivoting at their stage's middle; the story's fade | ✅ built (2026-11-02): anchored from field to field, covered, the camera carried by where it is on the Earth (`carry`) |
| 7d | The relief as Earth data of its own: out of `SceneryStage`, on the `World`'s globe, shaded plainly without a sky and by the sky with one | ✅ built (2026-11-02): 7d-1 `GeoRelief` in the `World`, the sky's shading kept, nothing changed on screen; 7d-2 the relief with the scenery off, its tiles kept across a toggle |
| 7e | See-through regions per loaded field; the void's shading and levels far from the stage | ✅ built (2026-11-02): a neighbour's reservoir seen through its seabed, with the scenery and without; under a field 123 km off the void as under the anchored one, less the walls |
| 7f | A pick says which field it hit ([§7](#7-decided-2026-10-26)) | ✅ built (2026-11-02): one handler for three fields, each pick in its own field's frame and map, anchored to either end |
| 7g | Bending a neighbour in its own frame, picking included | only if 7a shows the seam |

The relief bridge carrying a placed field's transform is not needed while columns and the
cutaway are the anchored stage's only. Wellbores as an Earth-level layer follow, designed on
their own.

### 7a and 7b, built (2026-11-02)

**7a: the story** (`Spikes/World/Fields`, `WorldFields.spike.stories.tsx`): three fields, each
a frame, a stage and spheres — at the sea's level on its stage's middle, corners and edges, and
three at 2.5 km depth. Volve (the demo frame, 16 km, orange); Trench (UTM 32N, 123 km east, of
Troll's size, 27 km, magenta); Overlap (a transverse Mercator about a point 10 km east and 4 km
north of Volve, overlapping its stage, 16 km, cyan). Controls: the anchor, the scenery, the
relief. Measured, anchored to Volve, the sea-level spheres' height over the curved sea:

| Field | Middle | Edges | Corners |
|--|--|--|--|
| Volve, anchored | 0 m | 0 m | 0 m |
| Trench | 0 m | 14.2 m | 28.5 m |
| Overlap | 0 m | 0–16.5 m | up to 26.7 m |

As the table above had them (~15 m and ~29 m for Troll's size). The Overlap field's middle lies
in Volve's disc, so `Globe.tangent` lays it flat on Volve's plane: it stands off only where it
reaches past the disc. Before 7b, toggling the scenery moved the Trench field's middle by
1178.5 m (its `d² / 2R`, flat without a sky, on the globe with one), and anchoring another field
left the camera where it was in the scene's coordinates: anchored to Trench, Volve's middle
lands at (−123.3, −1.16, −4.0) km, turned by the zones' convergence.

**7b: the `World` holds the reference.** The `World` makes the `Globe` (on the Earth from the
start, so what is placed may ask before an effect runs) and sets its frame, its disc
(`bounds`) and its curve (`globe`, default on) in one layout effect. `useWorld()` gives
`frame`, `bounds` and `globe`; `provideGlobe` is gone. A `Scenery` inside builds its
`SceneryMaterial` on the World's globe (`new SceneryMaterial(parameters, globe)`), sets neither
its frame nor its curve (its own `globe` prop applies only without a `World`), and the sky's
curvature follows the globe as it is drawn. `SceneryStage`'s `bounds` default to the World's;
a `World` given none leaves its globe's disc to the stage, as before. The geographic layers
(`useLayerGlobe`), `UtmArea`, `SceneryAnchor`, `useLevelHorizon` and the `Minimap` take the
World's globe, now always there. Checked: in the story, the Trench field's middle stays at
(122997, −1178.5, −7000.2) with the scenery on and off, and lies flat at sea level with the
World's `globe` off; the ReliefTiles story unchanged (a `World` without `bounds`). Tested
(`tests/globe.test.ts`): a sky on a World's globe leaves its disc and its curve to the World,
and follows the curve.

### 7c, built (2026-11-02)

- **A field placed about its stage's middle:** `placeGeoFrame(frame, scene, pivot?)` measures
  the turn and the scale at `pivot` (the frame's own X/Z) and gives its place there
  (`GeoFramePlacement.pivot`); `geoFrameMatrix` sets the frame on the globe about it.
  `UtmArea`'s `bounds` (its stage's area, in its own X/Z) give it the middle. A field whose
  origin lies 8 km from its stage's middle, in the next zone, is placed to 0.11 m within 5 km
  of the middle, against 0.72 m placed about its origin. In the same map nothing changes:
  moved only, exactly.
- **The switch** ([above](#switching-the-anchor-a-controlled-switch)): `World`'s
  `onFrameChange` (`WorldFrameChange`: `from`, `to`, `matrix`, `carry`) and `onFrameSettled`;
  sdk `geoFrameChangeMatrix`, `globeCarry` (`GlobeCarry`) and `Globe.clone`. Measured
  (`tests/geo-frame-change.test.ts`), Volve to the trench field: a camera 500 m over Volve's
  middle carried by `carry` stays 500 m over the sea, 0.6 mm from over Volve's middle as now
  placed; by `matrix`, 462.6 m over it and 0.56 m aside. The new field's own content carried
  by `matrix` lands on its own coordinates (to 1e-6 m).
- **The story** (`Spikes/World/Fields`): `anchor` switched under a curtain (`fade`), the
  camera, its target and its up carried by `carry` (`carryCamera`; drei's `CameraControls`,
  `updateCameraUp` and `setLookAt`). Checked in Storybook: 3.4 km from Volve's middle, 1.5 km
  up, anchored to the trench field the view is the same — the camera 1500.000 m over the sea,
  its target 0.6 mm from Volve's middle sphere, now at (−123.3, −1.16, −4.0) km — and back to
  Volve to 1e-9 m; to the overlapping field, the target 1.1 cm from it. The curtain closed at
  20 ms, the frame switched at 297 ms, it opened at 409 ms. Neither covered nor carried, the
  camera keeps its coordinates and the view jumps, as before.

### 7d-1, built (2026-11-02)

The relief moved out of `SceneryStage` into a component of its own, the sky's shading kept:

- **`GeoRelief`** (`Layers`), anywhere inside the `World`: the stage's `relief` prop as props
  (`layers`, `depth`, `pixelError`, `cellPixels`, `transition`, `color`, `contours`,
  `layerLooks`, `visible`, `debug`, `onStats`, `onSampler`), less its `frame` (the `World`'s),
  and an `onProgress` of its own (`createReliefProgress`, `RELIEF_PROGRESS_LABELS`): the
  `Scenery`'s reports its shaders only. One per `World` (a second warns).
- **What meets through the `World`** (`WorldReliefState`, `useWorldRelief`): the relief's
  tiles (`SceneryReliefHub`, which the geographic layers and the `Scenery` drape on), the
  ground under the camera (the `Scenery`'s `oceanGround`, the void's lid), the sky
  (`provideSky`, from the `Scenery`) and the stage's part (`provideStage`: its area,
  see-through, occupants and their `onGround`). `SceneryStage` lost `relief`,
  `debug.relief` and the `'relief'` layer; the `Scenery` no longer takes its frame from a
  stage's relief.
- **Drawn while there is a sky**, as before: without a `Scenery` the relief draws nothing
  until 7d-2.
- **Compiled once.** The relief draws only once the stage knows it is there, and the stage
  turns its materials over (`curvedDepth`) in the same commit, so the sky precompiles once;
  the occupants' distance fields are made whether there is a relief or not. Drawn a frame
  apart, the stage's old materials were thrown away mid-compile ("Program object
  expected").

Checked: the ReliefTiles story pixel for pixel as before step 7 (140 tiles; mean and largest
difference 0); in `Spikes/World/Fields` the relief drawn with the scenery (168 tiles), gone
without it, back with it (162); a camera 500 m below Volve's sea floor sees the void (the
ground under it −92.2 m); toggling the relief in the FieldColumn story warns no more than
before. ⚠️ Known until 7d-2 (fixed there): the tiles stream inside the drawing that needs the
sky, so they load again when the scenery comes back.

### 7d-2, built (2026-11-02)

The relief without a sky, its tiles kept as the scenery comes and goes:

- **Drawn plainly** (`createReliefTilePlainMaterial`, `relief-plain-fragment.glsl`): its
  looks lit by the scene's lights, the seabed the sea's default (`sceneryDefaults.ocean.seabed`)
  darkening from the relief's `depth`, the `World`'s globe uniforms bound; nothing of the sea,
  the air or the void. The looks are both shaders' (`relief-look.glsl`, taken out of the
  sky's: the same arithmetic), and the tiles' vertex shader takes the sea's level from the
  globe (`globeLevel()`), not the sky.
- **Nothing from under the ground, no overview:** both are the sky's, and are not made
  without one. Under the relief, the data beneath it is seen unhindered.
- **See-through:** `GeoRelief`'s `opacity` everywhere and `fieldOpacity` over the fields
  (the `World`'s `bounds` until 7e), the lower of the two there, default 1 each. Below an
  `opacity` of 1 every tile is drawn see-through in one draw (`RELIEF_SEE_THROUGH_ALL`);
  at 1, opaque around the fields and see-through over them, its see-through copy the sky's
  own (`createSceneryReliefTileSeeThroughMaterial`, which keeps its opaque's shaders now).
  With a `Scenery`, the sea's `seabedOpacity` as before.
- **Land and seabed on or off** (`land`, `seabed`): `RELIEF_NO_LAND`, `RELIEF_NO_SEABED`, by the
  ground's height against the sea's level, on a skirt the edge it hangs from (judged by its
  own, a land tile's skirt dropping below the sea showed as a line of seabed). Without a
  `Scenery` only: with one, the sky decides. No custom material for now (decided
  2026-11-02): the plain one stays Blinn-Phong.
- **Mounted whatever the sky:** `SceneryStageReliefTiles` takes `sky` or null and the `World`'s
  `globe`, and keys nothing on the sky but its materials, so its streamer, its view and its
  sampler carry on. With a sky whose sea has no seabed it stays mounted, hidden, the ground
  under the camera not handed to the sky. The sea's depth, the tiles' base, is the last a
  `Scenery` gave, so its going loads nothing again.
- **Through a Suspense:** `GeoRelief` is mounted whenever it has layers in a `World` and drawn
  once the `World` knows it is there. A `Suspense` tears down layout effects while what
  suspended loads, the `World`'s knowing it among them, which unmounted it before: every tile
  made again.

Checked in `Spikes/World/Fields` (`reliefOpacity`, `reliefFieldOpacity`, `reliefShowLand`,
`reliefShowSeabed` added): the scenery turned off, the plain relief draws all 147 tiles from
its first frame, from the same textures; back on, the same (before, a load from nothing). The
Norwegian coast, the trench's edge and the contours lie where the sky draws them (the water
off). With the decorator's own `Suspense` taken out again, the story suspended for 17 frames
as the HDR loaded, and the relief came back with its 147 tiles from the same textures. At
`fieldOpacity` 0.5 the reservoir spheres show through Volve's stage (13 tiles see-through, 94
around); at `opacity` 0.6 one draw of all 94, every reservoir sphere through it, and with
`fieldOpacity` 0.2 Volve's stage clearer than around it. With the seabed off only the land is
drawn, and with the land off only the seabed, the coast cut clean. 700 m under the seabed
nothing of the relief is drawn and every sphere shows; with the scenery back, the lid is drawn
there and the sky has the ground (−81.2 m). ReliefTiles and FieldColumn draw as before,
without a warning.

- **The stories' lights** (`Canvas3dDecorator`): the HDR environment the decorator adds where
  a story does not light itself loads in a `Suspense` of its own, so the story is not hidden
  while it loads.
- **"Program object expected", traced and fixed.** Chrome warns once per program disposed
  while it still links (`KHR_parallel_shader_compile`), from its own GPU process: 12 of 12
  disposed mid-link warned, 0 of 12 once linked. In FieldColumn a column rebuild reset the
  story's rim, so the `Scenery`, mounted only with a seabed height, was made again: its 26–27
  programs thrown away, some mid-link (the batch of 12), and compiled anew. Fixed three ways:
  the story keeps its rim, stale, until the new column's comes; `releaseMaterial`
  (`rendering/precompile.ts`) lets a material go only once its programs have linked and the
  compiles queued before it have started, so a replacement takes its programs over — used by
  the sky, its layers, the baker, the stage, the relief, the chunks and the stack's sea; and
  the chunks' and the sea's linger 5 s (`CHUNK_MATERIAL_LINGER`), as a rebuild lets the old
  chunk go before the new one comes in. Programs made and thrown away per `maxError` rebuild:
  27 before, 0 after (20 rebuilds, none warned, from loading on).

### 7e, built (2026-11-02)

The seabed see-through over each loaded field, and the void the same under any field:

- **The fields loaded** (`world-fields.ts`): a `UtmArea` with `bounds` in a `World` registers
  itself (`{object, bounds}`, `WorldFieldsContext`, `useWorldFields`), so the `World` knows
  every field drawn, anchored or not.
- **A region per field** (`setReliefRegions`, `reliefTileInRegion` in `relief-tiles.glsl`): the
  anchored stage's box, then each field's bounds in its own frame — world to the area's own
  through its group's whole placement (a `Matrix4`: turned by its grid convergence, tilted on
  the globe), each frame. At most eight (`SKY_RELIEF_MAX_REGIONS`, `RELIEF_MAX_REGIONS`), the
  eight nearest the camera past that; a pixel in any is counted once, overlaps included, the
  loop with one break on the count. `uReliefRegionCount`, `uReliefRegions` and
  `uReliefRegionBounds` replace `uReliefStage`. The see-through draw takes the tiles over every
  region's square (`geoSquareOver`); with a sky, the regions are see-through whenever the sea's
  `seabedOpacity` is below 1, with or without a stage. Without a sky, `fieldOpacity` applies
  over the same regions.
- **The void far off:** its gradient, its depths' rock, the background's lid and the plain lid
  from below (the stage's seabed, the relief's underside, raked about the ground's own up) are
  laid out by the camera's look up (`globeCameraLook`), so over the disc nothing changes and
  far off the lid lies level over the camera, as deep as it is under the seabed on the globe.
  The walls stay with the anchored stage: how much of them the camera sees
  (`uSkyAbyssWallNear`, `skyAbyssWallNear`, each frame with their cut) is all of it in their
  hollow and near it, none three `rimFade`s beyond their rim (where their light is gone), eased
  between: their fill, lid and faces are mixed into the plain void's, and with none left their
  mesh is hidden and nothing leaves pixels to their fill.

Checked in `Spikes/World/Fields`, anchored to Volve. With the scenery off and `fieldOpacity`
0.4, four regions (Volve's stage, and the fields Volve, Overlap — turned, the union counted
once — and Trench 123 km east), Trench's reservoir spheres through its seabed; with the scenery on and the water off, the same at
`seabedOpacity` 0.4. With the water on, the stage's sea is drawn over Trench too. 1.5 km below
the sea, under Trench the void was black (the walls' rock round the hollow, faded out) and is
now the plain void, its lid rippled and fading into the horizon; under Volve the walls and the
sand's lid are as before (`near` 1). Swept east from Volve, the lid's mean colour goes 59, 52,
40, 31 at 40 km, then 36, 42, 47 and holds at 48 from 76 km on (`near` 0.003 there, 0 from
78 km, where the mesh hides and the relief draws its own lid): no step anywhere. From above
Trench through its see-through seabed, the void's grey depths instead of black. Anchored to
Trench, the walls are under Trench. Without walls, with them, FieldColumn and the anchor's
switch: no shader warning.

### 7f, built (2026-11-02)

A pick says which field it hit, and the `EventEmitter` knows nothing of fields:

- **`UtmArea`'s `id`**, the host's name for the field, in its context (`UtmAreaContext.id`), so
  what is drawn inside can tell which field it is in; and `worldToArea`, a world point (a
  pick's `position`) in the area's own X/Y/Z through its whole transform, as `worldToUtm` is.
- **Which field, by the listener's `ref`:** the generic reference a listener is registered
  with, and handed back on each of its events. A component drawn in a field registers with
  what it knows of where it is (the field's area, from its `UtmAreaContext`); a library
  component's `ref` stays its own (a wellbore's id), and the host's handler for it knows its
  field by where it was made: one handler per field, made inside it. Not by walking up the
  scene graph from what was hit.
- Considered and not taken: the `EventEmitter` stamping the area on each listener as it is
  registered (`useEventEmitter` reading `UtmAreaContext`), which would tie it to `UtmArea`.

Checked in `Spikes/World/Fields` (an `EventEmitter` added, the spheres of each field one
listener, its area its `ref`, one click handler for all three, the hit shown over the view):
anchored to Volve, a reservoir sphere (250 m, its middle 2500 m deep) clicked from straight
above in each field reads 2251 m deep, within 12 m of its middle across (the 2° tilt), in
that field's own frame — Trench 123 km east in UTM 32N, Overlap in its transverse Mercator,
Volve in 31N; anchored to Trench, Volve's, 119 km west now, reads the same within 5 m.

### Considered, not chosen

- **The selected field as the `World`'s frame, switched seamlessly** (2026-10-30), and **a
  seamless switch on a fixed Earth** (2026-11-02, morning): see
  [Why it changed](#why-it-changed). The second stays a possible refinement, should covering a
  switch prove not enough.
- **A fade drawn by the library:** the host's pipeline and look are its own; the stories show
  one.
- **The `World` drawing the Earth** — the sky, the ocean, the relief, each switched on or off:
  it holds where things are, and the host adds what is drawn.
- **The Earth's centre as the origin (ECEF):** hosts need Y up near their data, and a point
  6 400 km out has steps of 0.5 m in 32-bit floats.
- **All data bent onto the globe, no stages:** every material and every CPU path (picking,
  annotations, cut planes, the bridge) would bend, and what is flat (horizontal cuts, the sea
  plane) would curve. The bend stays an option for a neighbour.
- **Several cuts at once** (a list of discs in `globe.glsl`): every sea, relief and sky shader
  checks every disc, and discs must not overlap, for what the anchored stage alone needs.
- **A floating origin following the camera:** the anchor changes on the host's request. Fields
  already have its precision (64-bit model-view per draw); only shaders that work through world
  positions gain, at continent scale.
- **Projecting a field's data into the camera's frame each frame:** a field's place on the
  globe does not depend on the camera; only its composition with the camera's does, which
  three.js already does per draw.
