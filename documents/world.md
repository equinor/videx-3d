# World: where on Earth, and more than one field

> **Status (2026-10-26): design, decisions taken; steps 1 and
> [2](#9-step-2-in-detail-the-sky-on-a-fixed-globe) built.** How the scene places
> itself on the Earth today, what more than one field needs, and a plan for it. The open
> questions are settled ([Decided](#7-decided-2026-10-26)): the Earth is a fixed globe.
> Step 2 comes before the overlays ([tiles.md](./tiles.md) step 8); the rest waits for a
> host that needs it. Until then, [What to keep doing now](#5-what-to-keep-doing-now) is
> what matters: small habits that keep the later steps cheap.

- [1. Today](#1-today)
- [2. What more than one field needs](#2-what-more-than-one-field-needs)
- [3. The proposal](#3-the-proposal)
- [4. What changes, part by part](#4-what-changes-part-by-part)
- [5. What to keep doing now](#5-what-to-keep-doing-now)
- [6. Order of work](#6-order-of-work)
- [7. Decided (2026-10-26)](#7-decided-2026-10-26)
- [8. Costs and risks](#8-costs-and-risks)
- [9. Step 2 in detail: the sky on a fixed globe](#9-step-2-in-detail-the-sky-on-a-fixed-globe)

---

## 1. Today

The scene is ONE flat frame in metres: scene X east, Y up, Z south, its origin at one
point of one projection. Three things each say where that point is, and stories keep
them in step by hand:

| Who | What it is told | What it uses it for |
|--|--|--|
| `UtmArea` | a UTM zone (or a `CRS`) and an origin | placing the data: chunks, wells, surfaces, annotations |
| `Sky` `observer` | latitude, longitude and a date | the sun, moon, planets and stars |
| `SkyBoxStage` `relief.frame` | a projection and an origin (`ReliefFrame`) | reading the reliefs onto the scene's X/Z |

Above the surface the sky draws the Earth as a fixed globe (step 2, built 2026-10-26): a
sphere whose centre lies fixed below the scene and whose cap over a disc about it (the
stage's `bounds`) is cut flat, so the scene meets the sea level and nothing rises or sinks
as the camera moves ([Step 2 in detail](#9-step-2-in-detail-the-sky-on-a-fixed-globe)).
Before it the sky faked the curve: flat over the disc and falling away by `½ κ d²` beyond,
measured along each view, with the disc moved under a camera far off. The data stays flat:
what is drawn flat beyond the disc — `UtmPosition` and `Wgs84Position` included — goes onto
the globe with a `SkyAnchor` or `applyGlobe` ([For a host](#for-a-host)).

Precision: the GPU works in 32-bit floats, a step of about 6 cm at 1000 km from the
origin and 0.5 m at 8000 km. A field's data, to the centimetre near the origin, is fine;
anything far from the origin is not, and nothing today needs it to be.

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
own up from the scene's. The relief's tiles are read in a frame of their own (a projection
chosen for the region, as `ReliefFrame` is now; for the whole globe, tiles by latitude and
longitude) and placed on the globe. The sun and the stars need the camera's latitude and
longitude, which the Earth layer knows.

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
CRS, the relief's `ReliefFrame` and the sky's observer are all derived from it — the
observer's latitude and longitude being the origin's, or the camera's once it travels.

---

## 4. What changes, part by part

| Part | Today | With the proposal |
|--|--|--|
| `UtmArea` | the scene's frame, at the world origin; `UtmPosition` and `Wgs84Position` flat ([For a host](#for-a-host)) | one field's frame, a group placed by its transform; takes a `GeoFrame`; nested `UtmPosition`, picking and annotations unchanged |
| Chunks, wells, surfaces | in `UtmArea` | unchanged, inside their field's `UtmArea` |
| `SkyAnchor` | places flat content on the globe, where it is (step 2) | becomes the field's placement on the Earth |
| Sky curve | a fixed globe, its cap over the chosen field cut flat (step 2) | the same, the globe placed from the chosen field's `GeoFrame` |
| Sky observer | given by the host | derived from the camera's place on the Earth, the date still given |
| Relief | read in the stage's `frame`, the scene's | read in a relief frame of its own, placed on the globe; independent of the chosen field |
| Relief tiles | keyed in the frame's X/Z, roots of 2097 km about its origin | keyed by latitude and longitude for the whole globe (step 6); until then as now, within one region |
| `SkyBoxStage` | one stage, one occupant, at the scene's frame | one stage per field: its `bounds` in the field's frame, its seabed and cut on the field's transform |
| Bridge (relief → chunk) | relief and column in the same frame | the column samples the relief in its field's frame: a transform between the two frames, which `reliefSource` carries |

---

## 5. What to keep doing now

Nothing above is needed for one field. What keeps it cheap to add later:

- **Ask "where" in one place.** New code that needs a latitude, a projection or an origin
  derives it from the field's CRS (`crsOriginLocation`, `reliefFrameFromCrs`; see
  [Order of work](#6-order-of-work), step 1), not from a prop of its own.
- **Measure from a frame given, never from world 0.** Everything above the surface
  already does (the sky, the relief's curve, the tiles' selection); after step 2 the
  globe's centre is one such frame, and nothing measures the curve from the camera.
- **Keep a field's content under one group.** The anchor is that group today; tomorrow it
  is the field's transform.
- **Keep the relief's frame apart from the field's.** The tiles are built in the relief's
  frame; the column reads the relief through the bridge, which may then carry a transform.
- **No scene-wide constants for a place.** Not in shaders (a uniform per frame instead),
  not in stories (one place per story).

---

## 6. Order of work

| # | Step | Ends with |
|--|--|--|
| 1 | **One place for where:** sdk helpers that derive the relief's frame (`reliefFrameFromCrs`) and the sky's observer place (`crsOriginLocation`) from the CRS a `UtmArea` is given; the sky stories take all three from one CRS (`demoCrs`) | ✅ built (2026-10-25) |
| 2 | **The sky on a fixed globe** ([in detail](#9-step-2-in-detail-the-sky-on-a-fixed-globe)): the sea, the horizon, the air and the clouds on a sphere fixed below the chosen field, flat over its disc; the relief and anchored content placed on it with no camera in the sum; `followFlatSea` and `followAway` go | ✅ built (2026-10-26): the same pictures at one field, nothing moving anywhere, at 0–1 ms a frame over the sea (2e) |
| 3 | **Fields placed on the Earth:** a field's transform from its frame; `SkyAnchor` becomes it. `GeoFrame`: `ReliefFrame` becomes it, `UtmArea` takes one, a `CRS` is built from one | one field, through the new path |
| 4 | **The view's origin:** re-based in steps; transforms composed in 64 bits. The world moves under the camera, never the camera's controls: at each step the view's frame becomes the one under the camera, its up away from the globe's centre, and the host is told (a callback with the step's transform) to set its controls' position and target to the moved ones, which any controls can. Ready-made for drei's `CameraControls`, which the stories use; a host that does not take it keeps the scene's up, and the horizon tilts far off | a camera 1000 km out with a field's data as precise as at home, and a level horizon |
| 5 | **The relief in its own frame:** drawn on the globe, read by each field's column through the bridge with a transform | the relief independent of the chosen field |
| 6 | **Tiles on the globe:** tile keys by latitude and longitude, the relief contract unchanged (a tile asks each layer for a window of its own grid, as now); the overlays' tiles move with them, sharing the core | a view of the whole globe |
| 7 | **Two fields:** a story with two fields in two UTM zones, the camera flying between them, either chosen | the goal |

Step 2 comes first. Steps 3 to 5 and 7 wait for a host that needs more than one field;
step 6 for one that needs to see beyond one region (about 2000 km).

---

## 7. Decided (2026-10-26)

- **The Earth is a fixed globe** (see [The Earth](#the-earth)), not a sphere touching the
  Earth just below the camera: that one rolls the Earth under a moving camera, where a far
  point lies depending on where the camera is, and cannot hold tiles by latitude and
  longitude in fixed places.
- **Names:** `GeoFrame` for where a flat frame lies on the Earth: a projection and an
  origin, plain data, so a worker can read it. `ReliefFrame` becomes it, a `CRS` can be
  built from one, and `UtmArea` takes one (step 3). The globe's shape and its placement
  are an sdk piece of their own, `Globe` (step 2), which the sky owns and anything else
  can take. A component for the Earth layer comes only with the view's origin (step 4).
- **The whole globe:** tiles by latitude and longitude, as Cesium's and most globes' are,
  with the relief contract unchanged — a tile asks each layer for a window of its own
  grid, as now (step 6). Until then, one regional frame: a projection for a region (a UTM
  zone stretched, or a Lambert conformal) holds about 2000 km well, the Norwegian shelf
  from the North Sea to the Barents Sea at 1–2% scale error at its far edges.
- **The chosen field's sea is flat over it,** where the column meets it exactly; beyond,
  the sea is the globe. Curved everywhere would put the column's top 5 m off the sea at
  8 km.
- **Picking and annotations across fields:** each field's `UtmArea` keeps its own
  context; a pick says which field it hit.
- **The date** stays the host's, as the sky observer's is.
- **`UtmPosition` and `Wgs84Position` stay flat** for now: they place at the area's
  Y = `altitude`, as before, and far from the field what they place stands off the curved
  sea; the behaviour is documented ([For a host](#for-a-host)) rather than changed. To
  revisit with step 3, where `UtmArea` becomes a field's transform.

- **The camera's controls are never changed by the library,** as a host may use any.
  Step 2 leaves the camera to them, in scene units with the scene's up; step 4 moves the
  world under the camera and hands the host the step's transform for its controls'
  position and target (see [Order of work](#6-order-of-work)). Until then a helper places
  a camera over the ground at a point ([For a host](#for-a-host)).

---

## 8. Costs and risks

- **Rebasing:** each step of the view's origin touches every field's transform and the
  sky's uniforms — a handful of matrices, once in 10 km.
- **The exact curve per pixel:** a sphere's intersection costs a square root, as today's
  curve does; no change. The sea's normals become exact (from the centre), which drops
  the tilt today's curve adds.
- **Precision of a centre 6371 km away:** in 32-bit floats a distance from the centre is
  good to half a metre. Written about the disc's centre instead, in forms that subtract
  no near-equal numbers, it is good to a millimetre near the field (see
  [Step 2 in detail](#the-globe-in-32-bit-floats)).
- **Two frames meeting:** where two fields' frames overlap, their data disagree by the
  projections' difference; each field is drawn in its own, and the sea and relief in the
  Earth's.
- **Data far from any frame:** the relief already lives far from the field (hundreds of km);
  with the view's origin near the camera it gets more precise, not less.

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
`Globe` and setting its disc; until step 3 there is no component for it. Without a globe,
nothing curves: see [With and without a sky](#with-and-without-a-sky).

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
  a view across the direction to the field shows the horizon rolled by 1.8°. Step 4
  levels it without touching the controls (see [Order of work](#6-order-of-work)).
- **Content beyond the disc drawn flat** still needs a `SkyAnchor` or `applyGlobe`, as
  before, but it no longer moves as the camera does.
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

Either way the data stays flat in its field's frame. A `GeoFrame` (step 3; a `CRS` until
then) converts what arrives in another projection — a pipeline in latitude and longitude,
a facility in another UTM zone — into that frame, and that is all it does. The globe is a
way of drawing, applied on top.

- **Without a sky** there is usually no globe, and nothing curves. The frame is consistent
  with itself: a pipeline, a facility and a seabed surface agree wherever they are, and a
  route 200 km to shore is drawn flat, as on a map. Distortion shows only against
  something curved — the sea's horizon, a regional relief — and without a sky neither is
  drawn. A host that wants it curved anyway makes a `Globe` (above).
- **With a sky** the sea and the relief are on its globe. What is Earth-referenced and
  lies beyond the disc goes onto the same globe (`applyGlobe` per vertex, `SkyAnchor`
  rigidly), or it floats over the sea far off (3 km at 200 km).
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
