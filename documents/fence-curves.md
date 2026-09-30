# Wellbore fence

A **fence** slices a chunk stack in two along a wellbore, so the well can be viewed
from either half. It is a vertical surface, so what it removes depends on map
position alone — one scalar per XZ point, which the shader reads per fragment while
the CPU sweeps the same curve into the cut face.

Two features in this repo sweep a vertical surface along a plan trace:

| | seismic section | column fence |
| --- | --- | --- |
| component | `WellboreSeismicSection` | `ChunkFence` on `ChunkStack` |
| purpose | draw a SHEET | make a CUT |
| curve from | `getProjectedTrajectory` (`sdk/utils/trajectory.ts`) | `buildWellboreFence` (`sdk/geometries/wellbore-fence.ts`) |
| sides | none | two, built together |

They share no code. The seismic path is unchanged by this document.

## The shape of the problem

A wellbore's plan trace is a poor curve to sweep. Its shallow section is
near-vertical, so tens of metres of survey scatter stand in for kilometres of hole:
a near-vertical well moves centimetres in plan over hundreds of metres of hole, and
that projection is not so much a curve as noise. The deviated section *is* the well
and must be followed closely, at a fixed clearance, without ever crossing it.

⭐⭐ **THE ONE RULE, which everything else follows from: the trajectory inside a fold is
DEGENERATE, and no measurement may be taken from it.** Where the trace loops, hooks or
doubles back, `fenceObstacles` frames the fold in a convex hull. The points within the
margin of that hull are its **zone**, tested by distance to the hull, and the zone — not the
trace — dictates the route past the obstacle. Each side rounds its own side of the zone with
a stiff rod, and that rod *is* the cut there. Nearly every bug this feature has had came
from measuring the trace where the zone should have stood in for it.

## Pipeline

```
Curve3D (spline through the position log)
  │
  ├─ sampleTrajectoryPlan   sample by MD; planSpeed = sin(inclination);
  │                         refine where the plan turns sharply
  ├─ prepareFenceTrace      the plan path, deduped and simplified — AS DRILLED.
  │                         It is NOT straightened; folds are routed around, not removed
  ├─ fenceObstacles         convex hulls framing each fold; the zone is the points within
  │                         `margin` of a hull. Hulls whose zones touch, or whose rods
  │                         would crowd, are merged into one
  │
  ├─ oneSidedOffset  ×2     each side's CORE: the one-sided offset of the trace, its runs
  │                         joined across each zone by a stiff rod
  │                         (`sdk/utils/one-sided-offset.ts`)
  ├─ buildFenceCut          the SHARED run-out arms, decided from both cores together
  │                         (`sdk/utils/fence-run-out.ts`); takes the `near-vertical`
  │                         branch for a well with no plan shape
  ├─ simplify by deviation  once, per piece — see "One curve" below
  │
  ├─ createFenceField    ×2 flood-fill SIGN over the footprint
  └─ buildFenceSegmentIndex ×2 the curve itself, bucketed for exact lookup
```

The result is a `WellboreFence`: a curve, a sign field and a segment index per side,
plus a `FenceReport`.

⭐ **Both cores are built before either arm.** The two sides share their run-out arms,
so a side cannot succeed on its own — it is both sides or neither.

## Only the stretch through the block

`buildWellboreFence` first trims the trajectory to where it passes through the BLOCK —
inside the footprint rings and inside `verticalRange` — and builds everything from that
stretch alone (`report.block`):

- **Nothing inside** → `null`: no fence is published and a fly-to has nothing to frame.
- **An end leaving through the footprint** is walked on until the trace is `2 × margin`
  clear of it, and gets **no run-out arm**. The core already leaves the block there; an arm
  off an outside end is a straight slit through the block with no well in it.
- **An end leaving through the top or bottom** (above the column, below its floor) is cut
  exactly at that depth and keeps its arm — the cut still has to reach the footprint. A head
  cut there is planned as a wellhead (opposite-TD, routed round its wrap onto the guide).
- **The cores run on past an open end, and past a TD cut by the bottom** once the block is past
  its kickoff: `runOutMargin` (500 m) further along the well (`fenceRunOn`, `fenceCoreTrace`,
  option `coreReach`, `report.coreReach`), then are cut back to the block (`trimFenceCore`) —
  never through a rod, which is kept whole past the cut. A rod near the block's edge then settles
  on the real well instead of a straight stand-in, so it comes out the same wherever the block
  ends (F-11 B cropped at margin 4.7 laid only 6.5 of the 26.3 atoms its rule wanted). The well,
  its field and the burial check stay on the block's stretch. Measured against the field build
  over 120 cropped builds, head left out: 107 unchanged, 7 closer (F-11 T2 cropped 3.4 → 0.1 m),
  6 further — where the head's own rod reaches the open end (F-11 B: a 480 m head ring), whose
  shape follows the crop's head bearing.
  - An armed head never runs on: the cores follow its planned guide. ⛔ Arming a cut head like
    the TD instead (along the well's own bearing, no plan) broke 16 of 207 builds at 808/1500 m
    tops — the cut sits 70–200 m MD below the kickoff, in the build-up curve the plan absorbs.
  - A TD cut still in the vertical column does not run on: it crossed the kickoff and failed at
    a fold (F-14 cut at 2000 m, kickoff at MD 2136).
  - ⭐ Only what ships is built and judged. The offset is handed the block's ends
    (`OneSidedOffsetOptions.keep`): a rod lying wholly past them is never laid, and the curve is
    cut back before the fold repair and the gates — so a failure out there no longer rejects the
    fence; one touching the kept stretch still does. It rejected F-1 C cut at 1900 m at 7 of 200
    margins (a rod past the TD failing at 7.7–8.1, an unrepairable fold at 2 and 2.2) and laid a
    discarded rod at 55 more. Over 1720 builds: 1 fixed, none broken, no worst turn moved > 1°.
  - A block cut short at an open head reads its TD bearing on the run-on in front of it
    (`FenceArmsOptions.bearingWell`). X13 enters a 1.5 km crop for its last 10 m: an end spanning
    9.99 m, under the 10 m degenerate span, fell back to +X against a well heading −X, and the TD
    arm turned 88–90° (19 SR in a 0.8 km crop: 162°). Only blocks shorter than the 50 m tangent
    arc can change: over both crops, 424 of 430 builds identical, 4 fixed, 2 within 0.1°.
  - A run-on that ends inside the zone over the block's TD — the well hooks back below the cut
    and never leaves the hull — is planned like a real TD in a hull (`planTdArm`): the cores
    round it onto a guide along the well's bearing before the hull, with nothing cut back. It
    used to stop at the zone short of the TD, and the TD arm crossed the well (F-11 A at 1900 m).
    A core landed on a TD guide (this plan or a degenerate one) leaves along the arm, as at the
    head: joined off its own end, still converging by 1–8°, the two sides' 300–780 m joins
    crossed each other by up to 7 m (35 ends over the census below; now none).
  - A degenerate head plan owns its TD guide, so its trace is not run on past it — appended
    after the guide's apex, the trace doubled back and the rod failed (F-11 A/B/T2 at 2000 m and
    below). Measured over bottom cuts 1500–2500 m and crops 1.5/0.8 km, every well and extra at
    margins 0.5/2/4: 44 of 609 builds fixed, none broken.
  - ⭐ The one fallback: if the cores fail with the run-on past an open head — it can reach the
    well's near-vertical top, which only a planned head is offset around — that end stops at
    the block, as before.
- A well kept whole runs on the original curve, so its fence is bit-identical.

`ChunkStack` derives `verticalRange` from its chunks: each publishes the depth range of the
units it lets a cut take (every layer but `section: false`), from the first cut layer's
surface `min` to the `max` of the surface flooring the last one (or the carrier). A fence
that cuts the sea (`water`) keeps the top at sea level.

⚠️ A head trimmed below the kickoff is already deviating. It is framed as a margin-sized
obstacle at the apex so the head arm keeps the opposite-TD rule, rather than falling into
the near-vertical branch. Its arm then often leaves 90–165° off the well's heading (an L or a
U), which the sideways approach shift could not open: the shift scales with the head ring, here
a margin frame (F-15 D cut at 1500 m: 0.29 m at margin 0.1, a 136° fold the repair could not
turn).

⭐ **A head arm more than `maxRelativeTurn` (45°) off the well's heading gets its turn LAID**
(`planHeadArm`, option `headTurnout`, default 100 m): an arc leaves the head ring's front along
the well's own heading and turns onto the bearing, its chord `headTurnout` long, and the guide
starts where it ends. Its radius is never less than the head ring's diameter: at margins 7.6–20 a
100 m chord laid R ≈ 52 m off 111–276 m rings and the rods failed (F-12, F-15 D). Its vertices
turn at most `acos(1 − tol / (2·margin))` (≤ 3°, `tol` = `DEFAULT_OFFSET_TOLERANCE`), so the
inner offset loses at most half the prune's slack at a vertex. ⛔ At a flat 3° the inner side lost
`margin·(1 − cos 3°)` — over the 0.01 m slack above margin ~7.3 — and was pruned whole (2 of 55
points left at 9.4): the rod bridging it seeded its end clamp inside the margin (F-15 A/B at
9.2–9.5 "still dips") or buried the well (19 A/B/BT2, F-15 B at 10–20). Over the 19 wells of the
F-1, F-11, F-15, 19 families and F-4, margins 0.1–19.9: 17 → 0 throws, none broken. It is part of
the virtual well — the cores follow it like any bend — never
folded into the hull (an exit advanced along the bearing and folded in was a spike both cores
rounded). Measured over the 108 L/U heads at field, 808 m and 1500 m tops × margins 0.1/0.5/2:
the head turn's median effective radius went from 1.7 m to ~40 m (≈ 0.4 × `headTurnout` at any
margin); over 1935 builds (those tops and bottom cuts/crops × 0.1–2) 1 fixed, none broken, the
worst turn better on 326 and worse on 25 (at most 4.4 → 12.9°, F-12 cut at 2500 m). Nothing
but the outline limits the room for it — the arc leaves away from the well — so the cap IS the
rule. Neither sideways shift applies to a laid head: the laid axis starts a turnout away from any
limb that crowded the old one. `headTurnout: 0` restores the shift (bit-identical builds).
⚠️ On a head cut from above, the arc starts along the well above the cut and crosses it in plan
(41 of 75 top-cut L/U heads). That well lies above the block, so the cut never meets it.

**`headBearing: 'free'`** (default `'opposite-td'`) sends the head arm THROUGH the head instead:
from where the well enters the head hull, through the hull's area centroid, turned only as far as
it takes to stay `headMinTdAngle` (default 90°) off the TD arm; a degenerate well keeps its hull
axis. The laid turn and the shifts then apply to whatever angle is left.
- ⭐ The hull is read as the straight-through axis frames it — grown over the fold that axis runs
  into. Read before growing, F-15 D's head was its kickoff alone, the bearing came out NNE into the
  hook (a 131° turn onto the arm, 705 m laid); grown, the well enters it from the hook and the arm
  leaves SSW (198°, a 14° turn, nothing laid).
- ⛔ Not the well's own heading into the head — that is the naive tangent the first version used.
- Over F-15 D, F-12, X08 and 19 B on the full field at 0.1–19.9 (268 builds per mode): 0 throws in
  either mode, worst turn at most 32.5° in both.

## Which side is which

⚠️⚠️ **`leftNormal2D` points to the visual RIGHT.** It is the quarter turn in +XZ, and
every plan view maps +X to screen-right and +Z to screen-**down**, so that turn is
clockwise on screen. This mirrored the whole feature once.

`side` names the half being **removed**, for the cut walking the well HEAD→TD in a plan
view from above. One helper owns the conversion — `fenceSideSign` (`sideNormalSign`),
where `'left'` is **−1** — and the hand is never re-derived at a call site. `'left'` /
`'right'` is the only vocabulary: options, results, reports and story controls all use it.

⚠️ `one-sided-offset.ts` walks TD→head internally, because near the head the XZ
projection is degenerate and anchors formed there manufacture loops and folds. The hand
therefore flips inside that file; `computeOffsetRuns` encodes that once.

## Obstacles are zones, measured as a distance

⭐⭐ An obstacle is its convex hull and the margin: its **zone** is the points closer to the
hull than `margin`. Every question asked of it — is this offset point clear, where does this
run reach it, how far apart are two obstacles — is a distance to a convex polygon, exact and
continuous in the margin (`sdk/utils/margin-zone.ts`: `convexSignedDistance`,
`segmentConvexNearest`, `convexPolygonDistance`, `hullsWithin`, `marginCrossings`).

One polygon is left: `zoneRing`, the hull grown by the margin with no corner turning more than
`maxRelativeTurn / 2` — outside the zone everywhere, and within 2% of the margin of it. It is
the outline the story draws, the path the rod is seeded along, and the zone's extent (the rod's
atom). Whether a point is IN the zone is never read from it.

- **Runs.** `computeOffsetRuns` drops an offset candidate within `margin + tolerance` of a hull.
  ⛔ It also drops every candidate whose SOURCE well vertex is on or inside a hull, wherever its
  miter puts it: a corner candidate stands up to `miterLimit · margin` off its vertex, past the
  rounded zone, and one kept strung a run round X12's TD hook at margin 4 (a 60° reversal).
- **Run ends** are the exact point where the run enters the zone (`marginCrossings`), so they
  move continuously with the margin.
- **The reliable well** — the stretches the rod is held off — runs right up to the zone
  crossing. Stopped at the last vertex outside, it left a gap that X07's rod slipped through at
  margin 1.
- **Merges.** Two obstacles are one when their hulls are within `2 · margin` (their zones touch),
  or when the well between the two zones is too short for both rods (`rodsCrowd`: 4 atoms of run
  each, measured by `freeRunBetween`). A rod whose anchor still runs onto the next zone throws
  `RodOverlapError`, and the pair is fused and the cores re-planned. The head wrap and the TD plan
  use the same distance and `zoneRing`.

## The transition: a stiff rod

Each gap between two runs is joined by one construction, whatever its size: a **stiff rod**.
`seedStiffRod` (`sdk/utils/stiff-rod.ts`) lays the seed — the `zoneRing` path between the two
run ends in the walk direction, plus an anchored stretch of each run, resampled at the rod's
atom `max(0.25, margin / 2, D / 8)`. The anchor rule and its measurements are in that file's
header. `settleRodConstrained` (`sdk/utils/stiff-rod-constrained.ts`) settles it.

- **Fixed vertices.** Tension plus bending, both clamps fixed in position and tangent, over the
  seed's vertices. Nothing is inserted, so no contact can make a short chord.
- **Separating lines.** Each chord is held `margin` from every convex piece near it — each hull
  and each reliable well segment — by the line through their closest points: both chord ends at
  least `margin` beyond it. That is the chord's exact clearance, with no sagitta and no lifted ring.
- **Contacts only where the rod presses.** Each round is a quadratic programme solved exactly by
  a dual active set, so a line is held only while its multiplier is positive. The lines are
  re-read after every round, within a trust radius of 0.5–8 seed spacings, so the rod never jumps
  across an obstacle.
- ⚠️ **Carried lines.** A line held last round and not re-read this round is carried into the
  next; without that, rods alternated between two solutions forever. Carrying every line piled up
  copies instead (F-5 at margin 20 held 335 lines on 167 vertices).
- **Stiffness floor.** The bending length is never below the rod's own 8 atoms. Margin-20 joins
  across a 0.4 m gap had a 0.8 m bending length on 10 m chords, a taut string with its whole turn
  on one vertex (F-1, F-1 A, F-1 B, F-12: 57–95°).
- **Run ends that meet.** When the path between E and S is shorter than an atom, each clamp's
  turn φ is read over one atom of the ring round from its run end. The E→S chord reverses when S
  passes E: F-5 at margin 19.2 mirrored φ from 37°/112° to 143°/68° and anchor A from 50 to 244 m.
  And S less than an atom BEHIND E gets no path at all — read as a lap round the ring, the same
  F-5 rod took 36 ring vertices and turned 179°.

MEASURED against the pin-and-release settle it replaced, full census (43 wells × 15 margins):
7 → 0 builds throwing; on 104 rods, 223 → 128 contacts and worst rod turn 180° → 25°. With the
zones moved to distance as well: 0 builds throwing, worst turn better on 296 builds and worse on 38.

## Why the clearance is baked into the curve

`ChunkFence.margin` is metres of clearance between the trajectory and the cut — room
for whatever is drawn *in* the hole (casings, completion, logs), which a cut through the
trajectory would slice in half. It must be greater than zero.

It is applied by **offsetting the curve on the CPU**, not by thresholding the field in
the shader. The field is then a plain signed distance to the finished curve, the shader's
test is `< 0`, and the cut face is that same curve swept vertically. The drawn face and
the removed block are one object.

The alternative — a live width uniform — makes them two independent evaluations of one
implicit surface that have to be reconciled numerically. That is what a previous
implementation did, and it needed marching squares, a Newton solve to pull face vertices
onto the sampled isocontour, and a CPU↔GLSL parity test. All of that is gone.

The price is that changing `margin` rebuilds the fence. It does **not** rebuild the chunks.

### Clearance is a SEGMENT measure, never a vertex one

⭐⭐ This is the single most repeated mistake in the feature. A path whose **vertices** all
sit at exactly `margin` still dips inside between them by the chord's sagitta. Two
mechanisms exist for it, and both are load-bearing:

- **Push onto the tangent polygon, not the margin circle.** Anything that projects a
  vertex out to the clearance distance lifts it by `1 / cos(θ/2)` instead, with `θ` the
  angle its own chords subtend. `relaxStiffPolyline2D` and `oneSidedOffset`'s
  `liftOntoTangent` both do this. Skipping it in the flank relax left vertices reading
  5.0000 m either side of chords dipping to 4.9841 m.
- **`holdPolylineChords2D`** (`polyline-2d.ts`) inserts and lifts a midpoint wherever a
  segment's *true* clearance is short, iterating until nothing dips. ⚠️ Its tolerance must
  be greater than zero: an inserted midpoint lands exactly on the margin, so its own two
  half-chords dip again and a zero tolerance never terminates.
  ⚠️ It throws only when a dipping chord ENDS inside the margin (a vertex no midpoint can move),
  or at a 64-round safety cap. A fixed 8 rounds was too few once the holds aimed at 1 mm (F-15 D:
  a 22 m rod chord needed 9), and "the worst dip must shrink every round" is false — a half-chord
  can come nearer another part of the well than its parent did (it failed 10 F-12 / 19 B builds).
- ⭐⭐ **Construction holds the FULL margin; `tolerance` is the gates' slack only.** The offset's
  chord holds use the hold's own convergence tolerance (1 mm), the ring walk and fold-repair lifts
  raise anything under `margin`, and a stiff rod's free vertices are lifted back onto the margin
  after the settle (it holds linearised lines and left some 1.4–7.3 mm inside, which a hold that
  only inserts midpoints can never fix). Built to `margin − tolerance`, every build sat on the
  gate's own line and anything after the hold could tip it over. Over 1273 builds of the F-1,
  F-11, F-15, 19 families and F-4 at margins 0.1–19.9: no outcome changed, one worst turn moved
  (19 A at 7: 7.6° → 12.6°).
- ⛔ **A chord hold never lifts into a zone** (`holdPolylineChords2D` option `blocked`): where the
  cut passes between the well and a ring, lifting a midpoint off the well pushed its two new chords
  into the ring — X08 with a free head at 1.9–2.1, 2 cm inside, once the hold aimed at the full
  margin. Such a chord is left pinched for the gates to judge.

⚠️ Guard the exact test with the bound `midpoint distance − half the segment length` — no
point of a chord is nearer than that, so most segments are proved clear by one lookup.
⚠️ The closest approach of a chord to a curving well is generally **not** at its midpoint,
so a midpoint distance decides nothing on its own.

### What the cut is allowed to give up

The cut is built **strict**, then thinned once by deviation (below).
`tests/wellbore-fence.test.ts` judges the finished field against two named allowances: the
thin itself, and a **construction residual** that scales with the margin because it is a
sagitta against a margin-radius circle. The worst measured is 0.034 m at margin 5, on the
chord where the TD run-out leaves the core; the same geometry gives about 0.003 m across
the 0.1–1 production range.

⛔ Forcing that chord out was tried and is worse: it traded the dip for eight new 48–87°
corners against the 45° steep gate, taking margins 0.5/1/5 from 26/26/26 wells built to
25/24/24. **A shallow dip beats a kinked cut.**

## No arcs — corners are mitered

⭐⭐ Round joins force dense tessellation and read as an abrupt straight-to-curve break in a
fence. Every corner is a **miter chain** instead: one vertex at `radius / cos(θ/2)`, split
into equal miters only when that would stand out past `miterLimit · radius`. Every vertex
lies on a tangent polygon *outside* the clearance circle, so subdividing blunts a spike and
can never relax the clearance.

⚠️ A bevel chord between two offset walls would dip *inside* the margin. Never use one.

## One curve: the face, the field and the index

⭐⭐ The sign field, the segment index and the drawn cut face are built from **one**
polyline. They used to be built from two — the face was simplified while the field and
index carried the raw construction — which meant the boundary the shader tested and the
face that was swept were different curves.

The cut is thinned **by deviation**, once, per piece:

- **By deviation, never by spacing.** A spacing thin drops the midpoints that hold the
  margin on the chords; doing that once buried the well by 13–27 mm on every well sampled.
- **Per piece**, so every seam stays a vertex and the index ranges a defect is attributed
  with survive.
- Bounded by `min(tolerance, margin × THIN_MARGIN_FRACTION)`, so what is given up is capped
  both by the caller's seam budget and by a fraction of the clearance itself.

The construction leaves about **75% of its vertices within 0.1 mm of collinear** — chord-hold
midpoints on straight runs, fillet chains, resampling. Carrying them was expensive: measured
over the field, index cell lists reached **191** segments against a cap of 64, and a
margin-0.5 sweep held 187k points where the thinned curve holds 15k.

### Why the boundary is carried, not rasterised

⭐⭐ **A rasterised signed distance cannot reproduce a polyline.** Bilinear interpolation is
exact for distance to a straight *line* — which is why a straight fence cuts straight — but
at every vertex the true field has a crease that the interpolant rounds off. The cut face is
swept from the exact polyline while the block would be removed at the interpolant's zero set,
so the two are different curves.

Measured on the demo wells, that gap was **up to 0.6 of a cell, ~2 m RMS**, and it read as
gaps and a wavy edge along the seam. It does not go away with a finer raster at any useful
rate: the error's scaling exponent measured 0.36–1.30, nowhere near the 2.0 that clean
curvature error would give.

So the curve is **carried**. `buildFenceSegmentIndex` buckets the segments into a grid,
duplicating each into every cell that could need it, and the shader reads one cell record
then evaluates exact point-segment distance against a handful of segments. The boundary is
the polyline itself, to float precision — **measured 2e-5 m**.

The rasterised field survives only as the **sign**, which is the one thing it is good at: a
flood fill knows the global topology, which no local segment test can.

⚠️ `FenceField.values` therefore has an exact SIGN everywhere and a meaningful MAGNITUDE only
near the curve. Any metre threshold compared against it beyond the index's reach is meaningless.

### The index is two-level, and it scales with hole length

A dense grid fine enough to keep the lists short is 96–99.8% empty, and its cost grows with
the field's **area** while the data in it grows only with the hole's **length** — 168 MB per
side at the resolution needed, and gigabytes on a production field. A **page table over
tiles**, allocated only where the curve passes, costs about a megabyte instead.

- `BAND_SCALE` (the hand-over radius, in field cells) is **separate** from the fine cell size
  (`BAND_CELLS`). They used to be one number and that is what made the index unaffordable.
- A cell keeps only the segments that could be *nearest* to some point in it. The bound is
  exact, not a heuristic: distance is 1-Lipschitz, so a segment can only win somewhere in the
  cell if `d(centre, S) ≤ d(centre) + 2 × the cell's half-diagonal`.
- ⚠️ Lists are sorted by distance **before** the cap, so a cell that still overflows keeps the
  nearest segments. Truncating in insertion order dropped the winning segment and put ~40% of
  well vertices on the wrong side, inverting four sides outright.
- ⭐ An overflow is only reported (`assertFenceInvariants`) when it FLIPS a side: each truncated
  cell is sampled on an 8×8 grid against its full list (`FenceSegmentIndex.flips`). The cap alone
  only costs distance precision, which no consumer reads — every shader tests the sign. MEASURED
  on F-1, F-1 A, F-1 B at margin 0.1 (67 truncated cells, 14k samples): 0 flips, |d| off ≤ 7 mm.
- ⚠️⚠️ `FENCE_MAX_SEGMENTS` is duplicated in `shaderLib/fence-field.glsl`, which cannot import
  it. `tests/fence-segments.test.ts` fails if they drift — they were once 48 here and 32 there,
  and every cell holding 33–48 had its tail silently ignored by the shader.

⭐ The cap **is** the shader's per-fragment loop count, so it is a performance number as much
as a safety one. ⛔ Refining the cells is **not** a way to shorten the lists: measured,
`BAND_CELLS` 4→16 moved the worst list only 132→92 while costing 5→42 MB per side, because the
cut folds back on itself at the head and those segments are genuinely equidistant. Thin the
curve instead.

## Gates — what throws, as opposed to what is reported

⚠️ Do not assume a metric is enforced; check the code.

| gate | where | limit |
| --- | --- | --- |
| clearance | `oneSidedOffset` | `margin − tolerance`, against the RELIABLE well only |
| loops | `oneSidedOffset` | 0 |
| worst relative turn | `oneSidedOffset`, `buildFenceArms` | 45° |
| crosses / self-crosses | `buildFenceArms` | 0 |
| `buries` | `buildFenceArms` | assembled core vs the INPUT core |

`minRadius`, `maxTurn` and `sharp` are **reported metrics only**. That is why a 162° spike
once shipped unnoticed.

⚠️ `polylineMaxTurn` accumulates heading change over an arc window — it is a **curvature**
measure, not a corner measure, and reported 283.6° on a curve whose sharpest corner was 177.5°.
The corner question is `polylineWorstTurn`.

⚠️ The `buries` gate is judged against the input core, **not** against `margin`: the assembled
core is a sub-stretch of the input, so with nothing dropped its clearance can only be equal or
greater. That keeps it correct on wells where part of the trace is legitimately inside an
obstacle frame, where the absolute distance is rightly below the margin.

## Diagnostics

`buildWellboreFence` returns a `FenceReport` covering sampling, kickoff, the arms and per-side
outcome, plus per-stage timings. `assertFenceInvariants(report)` turns it into a list of readable
problems and is the single definition of "broken" — the tests, the debug overlay and the
development warning all read it.

- `FenceSideCurve.pieces` gives the curve as index ranges (`run-out`, `lead`, `ring-walk`,
  `core`, `join`). ⭐ This is the only honest way to attribute a defect: "at vertex 1200" says
  nothing, "in the `ring-walk`, not the `core`" says which builder to look at.
- `fenceResidual(side, points)` measures `|fenceSideAt|` at the cut face's own vertices. It is
  the invariant that replaced the CPU↔GPU parity test: the face is the curve and the cut reads
  that same curve back, so it is bounded by float precision.
- `tests/fence-uniforms.test.ts` guards the shared uniforms, which are hand-copied in four
  places with nothing typechecking them.
- **Visual:** the offset-cut prototype story draws the trace, both cores, the rings, the arms
  and the pieces in **plan**, with a HUD. Plan view is where a fold or a razor wedge is obvious;
  the 3D view is not.

⚠️⚠️ **Metrics are blind to abandonment.** Head and TD shape metrics all *improve* when the cut
walks away from the well. For any question about the shape of an end, the screenshot is the
authority, not the number.

## Consumers of the cut

Anything that has to agree with the cut reads the same lookup:

- the **fragment discard**, through `fenceSide` in `sdk/materials/shaderLib/fence-field.glsl`;
- the **sea**, whose two materials read that same chunk through `OCEAN_FENCE`, so the water ends
  on the curve rather than a fraction of a cell either side of it;
- the **immersion fog**, which asks whether the camera is standing in the half that was taken
  away — exactly, so the fog switches at the cut rather than metres before it;
- the **cut face**, which is the curve itself.

What the fence removes is opt-out per medium, the same way `ChunkSection`'s is, and both default
**off** — the sea and the base plate FRAME the block. An intact water surface over an opened
column reads immediately as a field seen in section, while a sea cut in half alongside it mostly
reads as missing.

- `ChunkFence.water` hands the fence's shared uniforms to `OceanMaterial` and
  `OceanVolumeMaterial`, and the water body is then CLOSED by a face of its own. Left off, the
  sea bed cap is kept whole as the sea's floor instead, as for any kept unit.
- `ChunkFence.carrier` cuts the column's floor with the rest.

⚠️ Both are DEFINES, so toggling either rebuilds the materials concerned. The curve itself moves
through the uniforms, and rebuilds nothing.

⚠️ Turning the water on does not just remove the sea — it changes what the camera is standing IN.
A cut that opens the geology without draining the water above it leaves the camera inside the sea
where there is no longer any rock.

### The shared uniforms

One set per stack, handed to every material it draws with, so a new wellbore is a handful of
writes rather than a rebuild. `createFenceUniforms` builds them and `applyFenceSide` copies a
side in; that copy **is** the side swap.

⚠️⚠️ Every field has to be copied. `pages` was once declared, typed and assigned in three places
but missed by the copy, so it kept its neutral value, the shader's page-bounds test failed for
every fragment, and the whole cut silently fell back to the coarse flood fill.

⭐⭐ The diagnostic that found it, and it is general: **the jagged edge scaled with ZOOM, not with
pixels.** Screen-space quantisation is aliasing; world-space quantisation is a raster whose cell
is in metres. Ask which one an artefact scales with *first*.

⚠️ A CPU simulation of a shader proves the **arithmetic**, never the **binding**. A probe that
transcribed the GLSL exactly passed 34,307 samples with zero differences, because it read the
value from the source object rather than through the uniform that was never written.

### The sea's cut face

The sea is built by `buildSurfaceStack` as a stack of exactly two boundaries — the level and the
bed — so it can emit a `StackSectionSource` like any other stack. With `StackWaterSpec.section` in
hand, the water's cut face uses the same builders the chunks use: `buildFenceRibbons` for a fence,
`sectionStackInterval` for a plane.

⭐ Why it lines up: the face is swept over the sea's own channels, whose bed IS the column's
shallowest surface, along the same curve the block's face follows. There is no second opinion
about where the sea bed is to leave a gap along the seam.

⭐ It is drawn with a third `OceanVolumeMaterial` carrying no cut of its own. The face lies exactly
on the curve, so testing it against the thing it exists to close punches holes along its length —
the same reason `ChunkMeshes` builds the block's faces with both cut gates off.

## Which half to remove, and where to stand

A cut face can only be read from the half that was **removed** — from the other one the block
itself is in the way. So the side is not a preference to be set: it is a function of where the
camera is, and the two have to be decided together.

`ChunkFence.side: 'auto'` makes the stack decide every frame, from one `fenceSideAt` query against
the left side's field — that field partitions the whole plan, so there is no third answer to ask
the other side for. Two thresholds keep that from flickering, and both are needed:

- `autoDeadband` (metres) — an orbit crosses the fence exactly where the two halves are equally
  good, and a plan view looks straight down it. It is never allowed below `margin`: with a
  clearance baked in, the corridor between the two sides' curves belongs to *neither* removed half.
- `autoSettle` (seconds) — the deadband alone is crossed in a frame or two at speed, so a
  fly-through would flip the block twice on its way past.

`fenceViewPose(fence, { top, bottom, from?, side?, guard? })` answers the other half: a camera pose
looking square-on at the cut.

- ⭐ The view axis is the fence's own line across the field, `unit(td.tip − head.tip)`, falling back
  to the trace's principal direction when the fence genuinely bends and has no axis.
- ⭐⭐ **That heading is checked against the fence, not trusted.** A well that bends enough puts the
  square-on point *back inside the block* — measured 300 m inside on one demo well, which is a cut
  face with rock in front of it. Headings are scanned in 10° steps across ±90° and the pose reports
  whether it found any (`open`).
- ⭐⭐ **It takes the middle of that opening, not the first heading in it**, because an opening ends
  exactly where `fenceAutoSide` flips — so stopping at the first heading that works parks the camera
  a nudge away from swapping the half it has just removed. `guard` (default 25°) is kept from the
  ends, and spent only when it must be.
- ⚠️ The removed half is at `−fenceSideSign(side) × leftNormal` — the same direction the field's fill
  is seeded along. Using `+` there is the bearing of the KEPT half and starts the camera on the
  wrong side.
- With `side` left free, `from` breaks the tie on **travel**, turning a fly-to into a short swing
  instead of a trip round the back.

See [camera.md](./camera.md) for the flight that uses it.

## Known limits

- **Near-vertical wells** take a separate `near-vertical` branch: there is no plan axis, so the
  whole trace is wrapped as one blob and the arms run along the hull's own axis. ⛔ Nothing in that
  branch is filleted or relaxed — a wrap that small cannot be rounded, and
  the first attempt flattened both sides onto one straight line 4 mm apart. ⚠️ The blob's axis is
  measured on the **hull**, never on the inflated ring: inflation is isotropic, so it rounds a hull
  out and the fence's direction would become a function of the clearance setting.
- **Multi-lobe footprints.** A stack whose outline is several disjoint regions — which happens when
  a column's chunks derive their outlines from the wellbores — cannot generally be split evenly by
  one well. The report flags it (`removes only N% of the block`) rather than failing silently.
- A plan trace that genuinely crosses itself cannot be swept into a manifold vertical surface.
- ⚠️ **Picking does not follow the cut.** `PickingMaterial` is an override material with its own
  fragment shader, so neither the fence nor `ChunkSection` is applied during a pick — you can pick
  block that was visually cut away. Closing it needs a fragment-shader hook on
  `CustomPickingMaterial` and should cover the section case at the same time.
- **Practical margin ceiling is about 20 m.** Beyond it the field's own geometry runs out: a fold
  narrower than twice the margin cannot be threaded, and a well whose whole footprint is under
  `2 × margin` has no axis at all. The core itself has no fixed length scale left — the old flow
  radius (a 40 m cap on the fold repair's turn) was removed after it changed no build at margins
  14–40 (2086 core sides bit-identical).
- ⚠️ **The head and TD planners were tuned on the old mitred ring.** Their approach shift, crowding
  and guide extents were measured against a ring up to 11 m wider at margin 20 than `zoneRing`
  (F-5's head shift 38.6 → 27.5 m). They have not been re-measured.
- **Turn regressions from moving the zones to distance**, against the constrained settle on the
  old zones: F-15 B at margin 8 10.4° → 21.6°, F-15 A at 10 5.7° → 16.7°, 19 A at 8 6.4° → 15.3°,
  19 SR at 8 and 10 about 5° → 11°, X11 at 20 3.3° → 10.1°. The run ends and anchors moved with
  the rounded zone; all of them build.
- A run end S more than an atom behind E still walks the whole ring. Whether that is ever right
  has not been measured.

## Design decisions that are settled

⛔ These have each been tried and rejected with measurements. Do not re-propose them without new
evidence.

- **One curve offset ±margin for the two sides.** Where the trace is erratic the two sides need
  different *routes*: whichever lobe of an excursion one side skirts, the other must pass inside of.
  A single curve satisfying both is impossible, not merely awkward.
- **A global one-sided geodesic** over the whole curve: it bridges every concavity on the removed
  side, so an alternating well flattens to a straight line (measured 98%/79% bridged). Local only.
- **Deriving the ring-walk direction by searching or measuring.** It is derived: walking TD→head, a
  `left` cut lies on the right of the walk, so the ring interior stays on its left — `left` walks
  CCW and `right` CW.
- **Dropping ring vertices that graze the well.** They are pushed out instead; filtering them once
  deleted 9 of 10 and left a chord straight through the obstacle, which passed every gate because
  the well inside the hull is (correctly) ignored.
- **A margin-scaled fold detector.** It makes detection non-monotone — measured, the obstacle
  vanishes exactly when the margin gets big enough to need it.
- **An obstacle as a polygon grown by the margin.** There were three — a miter-2 zone for the prune,
  merges and the final check, the walk ring, and a ring lifted by a sagitta to hold the rod off its
  own hull — and they disagreed by up to a margin at every sharp hull corner. A miter-2 corner stands
  up to a whole margin outside the true zone and switches from one vertex to two as the corner
  crosses 120°: X13's head tip did that between margins 1.1 and 1.2, and the cut snapped to a 118°
  turn. Lowering only the rod ring's miter measured much worse (24 failed sides per well). The
  distance to the hull is exact and continuous; see "Obstacles are zones".
- **The pin-and-release rod settle.** It inserted or snapped a vertex at each violation, walked
  contacts from corner to corner and released them by an edge-normal test. It needs ring corners to
  pin, and its inserted vertices made short chords that needed hand pins, dip splits and a
  short-chord guard. Replaced by the constrained settle: 7 → 0 builds throwing, 223 → 128 contacts.
- **Walking the ring from the nearest vertex** rather than from where each run end *foots* on it.
  Once the margin grows past where the run pierces the ring, the nearest vertex lies behind the
  foot, and emitting it first made the cut double back on itself by 176.8°.
