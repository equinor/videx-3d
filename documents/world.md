# World: where on Earth, and more than one field

> **Status (2026-10-25): design, for review; not built.** How the scene places itself on
> the Earth today, what more than one field needs, and a plan that can be built when a
> host needs it. Until then, [What to keep doing now](#5-what-to-keep-doing-now) is what
> matters: small habits that keep the later step cheap.

- [1. Today](#1-today)
- [2. What more than one field needs](#2-what-more-than-one-field-needs)
- [3. The proposal](#3-the-proposal)
- [4. What changes, part by part](#4-what-changes-part-by-part)
- [5. What to keep doing now](#5-what-to-keep-doing-now)
- [6. Order of work](#6-order-of-work)
- [7. Open questions](#7-open-questions)
- [8. Costs and risks](#8-costs-and-risks)

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

Above the surface the sky fakes the Earth's curve: the sea is flat over a disc about the
scene (`uSkyFlat`, the stage's `bounds`), and falls away beyond it by `½ κ d²`, measured
along each view's level line. Far off, the disc moves under the camera
(`SkyMaterial.followFlatSea`: from 100 km up, or 5 to 40 km past the disc's edge while
the relief is drawn from tiles), and what is drawn flat is placed on the curve rigidly
with a `SkyAnchor` (see [tiles.md](./tiles.md#the-earths-curve-and-what-lies-on-it-built-2026-10-25)).

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

The sky, the sea, the relief and the clouds belong to the Earth, not to any field. They
are drawn about the camera: a sphere of radius `R` whose top is under the camera. Today's
`½ κ d²` is close in height (under 1% off at 1000 km); what it fakes is where it is
measured from — a disc, along each view — which is why the ground can rise and sink as
the view turns. The relief's tiles are read in a frame of their own (a projection chosen
for the region, as `ReliefFrame` is now) and placed on that sphere. The sun and the stars
need the camera's latitude and longitude, which the Earth layer knows.

### Fields

A field keeps a flat frame of its own (a projection and an origin, as `UtmArea` has now),
and all its data stays in it: chunks, wells, surfaces, annotations, picking. The frame is
placed on the Earth by a rigid transform: its origin on the sphere, its up along the
sphere's normal there, its north along the projection's grid north. Inside the field the
plane and the sphere part by `d² / 2R` (5 m at 8 km, 20 m at 16 km), as with a `SkyAnchor`
today. Where that matters, the sea stays flat over the field, as the disc keeps it now.

### The view's origin

What is drawn is drawn relative to an origin near the camera, so 32-bit floats are
precise where it looks. The origin is the chosen field's origin, or, between fields, a
point under the camera that moves in steps (every 10 km or so). Moving it changes
transforms only: each field's geometry stays in its own frame, the relief's tiles keep
their keys, nothing is rebuilt. The transform from each frame to the view's origin is
composed on the CPU in 64-bit floats, and only the result reaches the GPU.

### Where on Earth, in one place

One value says where a frame is: a projection and an origin. `UtmArea`'s CRS, the
relief's `ReliefFrame` and the sky's observer are all derived from it — the observer's
latitude and longitude being the origin's, or the camera's once it travels.

---

## 4. What changes, part by part

| Part | Today | With the proposal |
|--|--|--|
| `UtmArea` | the scene's frame, at the world origin | one field's frame, a group placed by its transform; nested `UtmPosition`, picking and annotations unchanged |
| Chunks, wells, surfaces | in `UtmArea` | unchanged, inside their field's `UtmArea` |
| `SkyAnchor` | lowers and tilts flat content onto the faked curve | becomes the field's placement on the Earth |
| Sky curve | flat disc + `½ κ d²`, disc under the camera far off | exact sphere about the camera; flat over the chosen field |
| Sky observer | given by the host | derived from the camera's place on the Earth, the date still given |
| Relief | read in the stage's `frame`, the scene's | read in a relief frame of its own, placed on the sphere; independent of the chosen field |
| Relief tiles | keyed in the frame's X/Z, roots of 2097 km about its origin | unchanged within a region; a much larger area needs a tiling by latitude and longitude (see [Open questions](#7-open-questions)) |
| `SkyBoxStage` | one stage, one occupant, at the scene's frame | one stage per field: its `bounds` in the field's frame, its seabed and cut on the field's transform |
| Bridge (relief → chunk) | relief and column in the same frame | the column samples the relief in its field's frame: a transform between the two frames, which `reliefSource` carries |

---

## 5. What to keep doing now

Nothing above is needed for one field. What keeps it cheap to add later:

- **Ask "where" in one place.** New code that needs a latitude, a projection or an origin
  derives it from the field's CRS (`crsOriginLocation`, `reliefFrameFromCrs`; see
  [Order of work](#6-order-of-work), step 1), not from a prop of its own.
- **Measure from the camera or from a frame given, never from world 0.** Everything above
  the surface already does (the sky, the relief's curve, the tiles' selection).
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
| 2 | **The sky on a sphere:** the exact curve about the camera, flat over a given disc; `followFlatSea` and `followAway` go | the same pictures at one field; no wobble anywhere |
| 3 | **Fields placed on the Earth:** a field's transform from its frame; `SkyAnchor` becomes it | one field, through the new path |
| 4 | **The view's origin:** re-based in steps; transforms composed in 64 bits | a camera 1000 km out with a field's data as precise as at home |
| 5 | **The relief in its own frame:** drawn on the sphere, read by each field's column through the bridge with a transform | the relief independent of the chosen field |
| 6 | **Two fields:** a story with two fields in two UTM zones, the camera flying between them, either chosen | the goal |

Steps 2 to 6 wait for a host that needs more than one field.

---

## 7. Open questions

- **Names:** the shared value (`GeoFrame`? `EarthFrame`?) and the component that provides
  it, if it is a component.
- **Tiling a larger area:** the tile roots are 2097 km squares of one frame. A projection
  for a region (a UTM zone stretched, or a Lambert conformal) holds about 2000 km well;
  beyond that, tiles by latitude and longitude (as Cesium's and most globes' are), with the
  relief contract unchanged — a tile then asks each layer for a window of its own grid,
  as now.
- **The chosen field's sea:** flat over the field (exact where the column meets it), or
  curved everywhere (exact Earth, the column's top 5 m off at 8 km)?
- **Picking and annotations across fields:** each field's `UtmArea` keeps its own
  context; a pick returns the field it hit.
- **The date:** stays the host's, as the observer's is.

---

## 8. Costs and risks

- **Rebasing:** each step of the view's origin touches every field's transform and the
  sky's uniforms — a handful of matrices, once in 10 km.
- **The exact curve per pixel:** a sphere's intersection costs a square root, as today's
  curve does; no change.
- **Two frames meeting:** where two fields' frames overlap, their data disagree by the
  projections' difference; each field is drawn in its own, and the sea and relief in the
  Earth's.
- **Data far from any frame:** the relief already lives far from the field (hundreds of km);
  with the view's origin near the camera it gets more precise, not less.
