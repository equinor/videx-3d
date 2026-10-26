# World: where on Earth, and more than one field

> **Status (2026-10-26): design, decisions taken; steps 1,
> [2](#9-step-2-in-detail-the-sky-on-a-fixed-globe) and
> [3](#10-step-3-in-detail-fields-placed-on-the-earth) built.** How the scene places
> itself on the Earth, what more than one field needs, and a plan for it. The open
> questions are settled ([Decided](#7-decided-2026-10-26)): the Earth is a fixed globe, and
> a `World` says once where the scene lies on it. Step 3 found the view's origin (step 4)
> mostly unneeded and the relief's own frame (step 5) better left to step 6
> ([Order of work](#6-order-of-work)); [What to keep doing now](#5-what-to-keep-doing-now)
> keeps the later steps cheap.

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

---

## 1. Today

The scene is one flat frame in metres: scene X east, Y up, Z south, its origin at one
point of one projection. A `World` says where that point is, once, as a `GeoFrame` (a
projection and an origin; step 3, built 2026-10-26), and what needs it takes it from there:

| Who | What it takes from the `World` | What it uses it for |
|--|--|--|
| `UtmArea` | the scene's frame, to place itself in: not moved in the world's own map, placed (turned, scaled, on the globe) in another | placing the data: chunks, wells, surfaces, annotations |
| `Sky` `observer` | the origin's latitude and longitude, when it gives only a date | the sun, moon, planets and stars |
| `SkyBoxStage` `relief.frame` | the frame itself, when it gives none | reading the reliefs onto the scene's X/Z |

Without a `World` each still takes its own, as before: a `UtmArea` is then the scene's
frame, the observer gives its place and the relief its `frame`.

Above the surface the sky draws the Earth as a fixed globe (step 2, built 2026-10-26): a
sphere whose centre lies fixed below the scene and whose cap over a disc about it (the
stage's `bounds`) is cut flat, so the scene meets the sea level and nothing rises or sinks
as the camera moves ([Step 2 in detail](#9-step-2-in-detail-the-sky-on-a-fixed-globe)).
Before it the sky faked the curve: flat over the disc and falling away by `½ κ d²` beyond,
measured along each view, with the disc moved under a camera far off. The data stays flat:
a field in a frame of its own is placed on the globe by its `UtmArea`
([Step 3 in detail](#10-step-3-in-detail-fields-placed-on-the-earth)); other content drawn
flat beyond the disc — `UtmPosition` and `Wgs84Position` included — goes onto it with a
`SkyAnchor` or `applyGlobe` ([For a host](#for-a-host)).

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
plane and the sphere part by `d² / 2R` (5 m at 8 km, 20 m at 16 km), as with a `SkyAnchor`
today. The chosen field's sea is flat over it (its cut cap, above); another field's own
water, flat, parts from the Earth's sea by as much toward its edge, seen from far off.

### The view's origin

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
| `SkyAnchor` | places flat content on the globe, where it is, rigidly (step 2) | ✅ places as the globe places the ground there (`Globe.tangent`), as a placed `UtmArea` is; for content without a frame of its own; takes the `World`'s globe outside the `Sky` |
| Sky curve | a fixed globe, its cap over the chosen field cut flat (step 2) | the same; its disc from the chosen field's stage |
| Sky observer | given by the host | ✅ its place from the `World`'s origin when it gives only a date; the date the host's |
| Relief | read in the stage's `frame`, the scene's | ✅ the `World`'s frame by default, the chosen field's, where its column meets it exactly; its own frame waits for step 6 |
| Relief tiles | keyed in the frame's X/Z, roots of 2097 km about its origin | keyed by latitude and longitude for the whole globe (step 6); until then as now, within one region |
| `SkyBoxStage` | one stage, one occupant, at the scene's frame | as before, at the chosen field; a stage per field is step 7's |
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
| 4 | **The view's origin** — reduced by step 3. Its precision comes free: three.js composes each draw's model-view matrix in 64 bits, so a placed field is as precise 300 km out as at home. Left: a level horizon far off (1.8° rolled at 200 km), which needs the world turned under the camera — every sky shader takes one `up` (`uSkyUp`) and the stage an axis-aligned box — with the host's controls moved by a callback, any controls can take. A host can level it today by setting its camera's up to the globe's there (`Globe.upAt`) | ⏸ deferred until a host flies far from its fields |
| 5 | **The relief in its own frame** — folded into step 6. In a frame of its own the relief would part from the chosen field's UTM by the two maps' scale (UTM's 0.9996 against 1: 3 m at 8 km), right where its column meets it; laid in the chosen field's frame it meets it exactly, and a placed field's to its placement's precision | → step 6 |
| 6 | **Tiles on the globe** ([in detail](#11-step-6-in-detail-tiles-on-the-globe)): tile keys by latitude and longitude, the relief contract unchanged (a tile asks each layer for a window of its own grid, as now); the overlays' tiles move with them, sharing the core. Everything placed by latitude and longitude on one sphere, the ellipsoid's conformal sphere matched at the chosen field; each field's column samples the relief through its transform | ✅ built (2026-10-26) in four parts: 6a the geographic globe, 6b geographic tiles, 6c the relief drawn from them, 6d the whole globe — the Earth from 20 000 km, the far side included |
| 7 | **Two fields:** a story with two fields in two UTM zones, the camera flying between them, either chosen: the `World`'s frame switched, a stage per field | the goal; step 3 placed the second field |

Steps 1 to 3 and 6 are built. Step 7's stage per field waits for a host with two fields'
columns at once.

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
  context; a pick says which field it hit.
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
  Step 2 leaves the camera to them, in scene units with the scene's up; step 4 moves the
  world under the camera and hands the host the step's transform for its controls'
  position and target (see [Order of work](#6-order-of-work)). Until then a helper places
  a camera over the ground at a point ([For a host](#for-a-host)).

---

## 8. Costs and risks

- **Rebasing** (step 4, deferred): each step of the view's origin would touch every
  field's transform and the sky's uniforms — a handful of matrices, once in 10 km.
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
reference so nothing is copied per frame. In step 2 the `Sky` owns one: `setFlatSea` sets
its disc, its `globe` prop turns it on or off (off, it is a flat plane), and the sky's
shaders bind its uniforms. What else is placed on the globe — the relief, a route,
an anchored field — takes a `Globe`, not a `SkyMaterial`.

So a host can place Earth-referenced data on the globe without a `Sky`, by making a
`Globe` and setting its disc. Without a globe, nothing curves: see
[With and without a sky](#with-and-without-a-sky). Since step 3 a `Sky` in a `World` hands
the world its globe, and what the world places is set on it.

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
(`SkyMaterial.onBeforeDraw`, and the stage's `setStageView`), with the camera drawing it, so
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
| `SkyMaterial` | `setFlatSea`; `followFlatSea` moves the disc each frame (`followAway`, `FLAT_SEA_FOLLOW`, `FLAT_SEA_AWAY`); `curveDrop(point, eye)` | owns a `Globe` (`globe`): `setFlatSea` sets its disc, once; the rest goes; its shaders bind the globe's uniforms |
| `sky-gradient.glsl` | `skyFlatRun`; the horizon and the lowest height a view passes from `½ κ d²` along the view | the horizon from the camera's altitude and up; the lowest height from the ray's closest approach to the centre; the air's heights over the globe |
| `sky-ocean.glsl` | `skyOceanReach` (flat, then `½ κ (c t − run)²`); `skyOceanTilt` tips the normal by the fall | the reach on the globe; the waves' normal turned onto up at the hit, and `skyOceanTilt` goes |
| `sky.glsl` | the clouds' deck on a sphere centred under the camera; the band's sink and squash from `½ κ d²`; the stage's sky over the curved horizon | the deck about `C`; the band from the camera's altitude; the horizon from the globe |
| Stage (`stage-fragment.glsl`) | the reach and the water's path below the surface beyond the disc | the same, through the globe's reach; the seabed facing up there; the planes sunk under a camera far off ([below](#the-stage-far-off)) |
| Relief tiles (`relief-tiles-vertex.glsl`) | each vertex lowered by `skyCurveDrop`, its height along the scene's up | placed by the ground at its X/Z, its height and skirt along up there; `vReliefFlat` (the occupant's cut) stays flat |
| Relief fragment, overview | the sea through `skyOceanReach` | the same, through the globe's reach |
| `applySkyCurve` | per vertex, the drop as the camera sees it, from a `SkyMaterial` | per vertex, the ground at its X/Z and its height along up: the same from every camera. Takes a `Globe`; renamed `applyGlobe`, as nothing in it is the sky's |
| `SkyAnchor`, the stage's `anchor` (`placeOnSkyCurve`) | lowered and tilted each frame, from the camera, while `followAway` | placed on the globe at `at`, when the globe or `at` changes: nothing over the disc, so the chosen field is never moved. `SkyAnchor` takes the enclosing sky's globe, or a `globe` of its own |
| `SkyBoxStage` | sets `followAway` while tiled | does not |
| `Sky` | `followFlatSea` each frame; the camera's height along up for its zones and the air's light | the camera's altitude over the globe |
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
  a view across the direction to the field shows the horizon rolled by 1.8°. A host can
  level it by setting its camera's up to the globe's there (`globe.upAt`); step 4 would
  level it without touching the controls, deferred (see [Order of work](#6-order-of-work)).
- **A field with a map of its own** (another UTM zone, a field far off) goes in a
  `UtmArea` of its own inside the `World`, which places it on the globe
  ([Step 3 in detail](#10-step-3-in-detail-fields-placed-on-the-earth)).
- **Other content beyond the disc drawn flat** still needs a `SkyAnchor` or `applyGlobe`,
  as before, but it no longer moves as the camera does.
- **`UtmPosition` and `Wgs84Position` are flat** (decided, [above](#7-decided-2026-10-26)):
  `altitude` is the area's Y. Over the disc that is exact. Beyond it what they place stands
  off the sea by `(d² − r²) / 2R` at `d` from the disc's middle — for a disc of 10 km about
  25 m at 20 km, 270 m at 60 km, 780 m at 100 km, 3.1 km at 200 km — upright in the scene
  rather than on the globe's up (`d / R`: 1.8° at 200 km), and, against the relief and the
  sea, which the globe pulls in a little, about 100 m farther out at 200 km (12 m at
  100 km). The flat conversions back (`areaToUtm`, `worldToUtm`, `areaToWgs84`,
  `worldToWgs84`) read the same in reverse: a point on the sea 200 km out reads an
  altitude of −3.1 km and a map position 100 m nearer the field. Wrapped in a `SkyAnchor`
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
  drawn. A host that wants it curved anyway makes a `Globe` (above).
- **With a sky** the sea and the relief are on its globe. What is Earth-referenced and
  lies beyond the disc goes onto the same globe (a field's `UtmArea` in a `World`,
  `SkyAnchor` about a point, `applyGlobe` per vertex), or it floats over the sea far off
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
  (StageDebug, FieldColumn WithSky, Baseline, ReliefTiles over Volve).
- **Nothing moving:** at 40 and 215 km, orbiting a fixed target, the coast holds its place
  against the sea, where today it rises and sinks.
- **Timings:** [tiles.md's poses](./tiles.md#timed-again-the-rest-of-the-relief-2026-10-25)
  again (the far ones placed with `globe.place`), within noise of today's: the sphere's
  root replaces today's quadratic.

### Order of work

| # | Step | Ends with |
|--|--|--|
| 2a | **The globe on the CPU:** `Globe` in the sdk (the centre from its disc; `altitude`, `up`, `place`, `reach`); the `Sky` owns one, `setFlatSea` setting its disc; tests | ✅ built (2026-10-26); nothing drawn changes. `SkyMaterial.globe`, kept in step by `setFlatSea`, `oceanLevel`, `globeEnabled` and `setFrame`; `tests/globe.test.ts` |
| 2b | **Everything drawn, at once,** so the ground and the sea always agree: `globe.glsl` for `sky-curve.glsl`; the sea, horizon, air and clouds; the stage; the relief's tiles and overview; `applyGlobe`; the anchors placed once; `followFlatSea`, `followAway` and their constants gone | ✅ built (2026-10-26), with 2c. Against step 2a, clouds off, rows averaged: at the field and out to the coast within 4 levels, the waves' own noise (30 levels at 2 m); the horizon from 100 km 10 levels apart, the sphere now exact. Low on the horizon the clouds' band is brighter, its flat-sea sink gone. Far off the stage's planes sink under the camera ([The stage far off](#the-stage-far-off)) |
| 2c | **Far off:** the tiles' selection and culling on the globe, the farthest seen, the ground under the camera | ✅ built with 2b: the ground under the camera at its foot (`Globe.foot`), the farthest seen from its altitude, boxes from corners placed on the globe. By eye at the coast and Lysefjord; the orbit and the timings in 2d |
| 2d | **For a host:** `globe.place` in the stories and `videx3d.globe`, their far poses; sky.md (the curve, `SkyAnchor`, the globe), tiles.md's curve section, relief.md; the timings | ✅ built (2026-10-26): `videx3d.globe` (`place`, `foot`, `altitude`, `up`, `orbit` about a point on the globe), shared with the debug panel; ReliefTiles' `facility`, a stand-in 123 km out, anchored or flat; `UtmPosition` and `Wgs84Position` documented ([For a host](#for-a-host)); the documents. Nothing moving: orbiting the coast 215 km out at 20 and 40 km, the globe's uniforms are the same from every pose and the coast holds. ⚠️ **Timed** A/B/A against 2a in ReliefTiles (GPU ms, frame and the background's draws): 40 m over Volve 12.1 → 14.9–16.7 (2.6 → 3.9–6.4), 100 km 14.5 → 17.3 (2.9 → 5.5), the coast 12.9 → 17.3–22.9 (2.5 → 4.1–5.2), Lysefjord 10.7 → 14.6 (3.8 → 6.0); the relief +0.5–2 ms, the stage +0.6–1.2; in the water and below the seabed the same or less. With the globe off the two match within noise, so it is the globe's own arithmetic per pixel: the camera's altitude and horizon about 20 times a pixel in the sky, each with a square root, and the relief's up and map point per pixel. Not within noise, as expected: taken back in 2e |
| 2e | **The globe's cost:** the camera's values per draw, not per pixel ([The camera, once per draw](#the-camera-once-per-draw)); the relief's up per vertex; the horizon, the lowest point a view passes and where it meets the sea each taken once per pixel | ✅ built (2026-10-26). The same pictures as 2d within a level (the air's rise, now to second order). Timed A/B/A against 2a in ReliefTiles, at a smaller window than 2d's (GPU ms, frame; the background, the relief and the stage): 40 m over Volve 8.4 → 9.1–9.2 (the background 1.9 → 2.3, the relief and the stage the same); 2 km, 30° down, the same; 100 km 8.8 → 9.5 (background +0.6, relief +0.3, stage +0.1); the coast 8.7 → 9.8 (+0.65, +0.3, +0.1); Lysefjord 8.8 → 8.2–8.8; in the water and below the seabed the same. So 0–1 ms over the sea, down from 2–4, and none of it below: what is left is the sphere's own per pixel, mostly in the background |

---

## 10. Step 3 in detail: fields placed on the Earth

> Built (2026-10-26).

### Where the scene lies, once

```tsx
<World frame={geoFrameFromCrs(crs)}>
  <Sky observer={{ date }} ocean>
    <SkyBoxStage bounds={bounds} relief={{ layers }} />
  </Sky>
  <UtmArea crsInstance={crs} origin={crs.originUtm}>{field}</UtmArea>
  <UtmArea frame={{ projection: utm32, origin: [e, n] }}>{other}</UtmArea>
</World>
```

- **`GeoFrame`** (`sdk/projection/geo-frame.ts`, free of three.js): `{ projection, origin,
  offset? }`, what `ReliefFrame` was. `geoFrameAt(longitude, latitude)` (a transverse
  Mercator map about a point), `geoFrameFromCrs(crs)`, `crsFromGeoFrame(frame)`,
  `geoFrameLocation(frame)` (its origin's latitude and longitude), `geoFrameSameMap`.
- **`World`** holds the scene's frame: world X/Z are its map's about its origin. It renders
  nothing; `useWorld()` reads it. A `Sky` inside hands it its globe (`provideGlobe`), so
  what the world places outside the `Sky` is set on the same globe.
- **The `Sky`'s `observer`** may give only a date: its place is the world's origin's.
- **A stage's `relief.frame`** defaults to the world's. `reliefSource` still takes one:
  give it the world's.

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
  as `SkyAnchor` made before, would part from the relief by 10 m 5 km around at 300 km;
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
- **`SkyAnchor`** and the stage's occupant `anchor` place the same way now, about a point,
  for content without a frame of its own; `SkyAnchor` takes the world's globe outside the
  `Sky`.

### Not in this step

- **A column in a placed field** samples the relief in its own frame, which the bridge
  does not yet carry: the chosen field's column only (step 6).
- **A stage per field,** and switching the chosen one (the world's frame) with a camera
  flying between them: step 7. Switching moves what is placed, not the camera, and the
  relief's tiles are laid out again in the new frame.
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
  true north. Without a frame, nothing changes; since 6c the `World` or the stage's relief
  sets one.
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

- **The switch.** `SkyBoxStageReliefTiles` keys its tiles by latitude and longitude (6b's
  keys, depth 19 at most: cells of 1.2 m north–south) and builds them with no frame, the
  same tiles in any scene. The globe needs the map its X/Z are in: the `Sky` sets the
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
- **True north with a `World`:** the `Sky`'s default `north` is true north at the
  `World`'s frame (`placeGeoFrame`), so the sun stands where it does on the Earth. Without
  a `World` the stage gives the globe its frame, but the `Sky` cannot see it, and its
  north stays grid north.
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
  from 108 km, with no cracks; in FieldColumn (`WithSky`, `relief` on), the column built on
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
  (`resampleReliefGeographic`; the `skyRelief` generator), read where each view meets the
  globe's sea through `globeGeographic` (GLSL, the twin of `Globe.geographic`, from the
  globe's new `uGlobeLocation`): from anywhere with any far plane; made the first time
  it is needed (tiles.md, [The overview](./tiles.md#the-overview)).
- **From space** (sky.md, [From space](./sky.md#from-space-built-2026-10-26)): from 100 to
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
  first bake fails is not found; flying up from the field never does.
- **The `Earth` story** (ReliefTiles): a far plane of 50 000 km, the camera 20 000 km out,
  the real sky for the date. The procedural stars under the real ones are fainter now
  (sky.md, Stars).
- **Seen:** the Earth from 20 000 km, lit by day, the terminator soft, the night side dark,
  the far side (Africa, Madagascar, Antarctica) whole; from 3000 km Greenland, Iceland and
  Scandinavia in the world's and the Nordic relief, the rim over the edge; the overview
  past a 200 km far plane; the field from 1 km as before.
- **Not done:** timings from space; poles and the 180th meridian close up (a world layer's
  grid edge there takes the edge's values, no wrap, so a tile's border normals there are a
  little off); the overview's grid crossing the 180th meridian unless it goes all the way
  round; the sky's gradient far round the Earth at low altitude (step 4: the field's up).
