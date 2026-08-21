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
following it produces folds, hairpins and a cut that pinches to a blade at the
wellhead. Meanwhile the deviated section *is* the well and must be followed closely.

The design answers that with one idea: **straighten the trace inside a tolerance
corridor that is derived from how vertical the well is.** Wide where there is
nothing to follow, tight where there is.

## Pipeline

```
Curve3D (spline through the position log)
  │
  ├─ sampleTrajectoryPlan   sample by MD; planSpeed = sin(inclination);
  │                         refine where the plan turns sharply
  ├─ fenceKickoff           deepest point above which the well is still vertical
  ├─ fenceTolerance         corridor half width per sample, from planSpeed
  ├─ fenceBaseCurve         relax inside the corridor to a fixed point;
  │                         give the head up only if that is not enough
  ├─ fenceExtensions        ONE run-out pair, shared by both sides
  │
  ├─ buildFenceSideCurve ×2 offset by the margin, attach run-outs, repair
  ├─ createFenceField    ×2 flood-fill SIGN over the footprint
  └─ buildFenceSegmentIndex ×2 the curve itself, bucketed for exact lookup
```

The result is a `WellboreFence`: a curve, a sign field and a segment index per side,
plus a `FenceReport`.

### Why the boundary is carried, not rasterised

⭐⭐ **A rasterised signed distance cannot reproduce a polyline.** Bilinear
interpolation is exact for distance to a straight *line* — which is why a straight
fence cuts straight — but at every vertex the true field has a crease that the
interpolant rounds off. The cut face is swept from the exact polyline while the block
would be removed at the interpolant's zero set, so the two are different curves.

Measured on the demo wells, that gap was **up to 0.6 of a cell, ~2 m RMS**, and it
read as gaps and a wavy edge along the seam. It does not go away with a finer raster
at any useful rate: the error's scaling exponent measured 0.36–1.30, nowhere near the
2.0 that clean curvature error would give, because the vertex spacing is comparable to
the cell and the creases dominate.

So the curve is **carried**. `buildFenceSegmentIndex` buckets the segments into a
coarse grid, duplicating each into every cell that could need it, and the shader reads
one cell record then evaluates exact point-segment distance against a handful of
segments. The boundary is the polyline itself, to float precision — **measured 2e-5
m**, five orders of magnitude better.

The rasterised field survives only as the **sign**, which is the one thing it is good
at: a flood fill knows the global topology, which no local segment test can. The
hand-over is safe because a cell lists every segment within `reach` of its box, so a
point inside that box finds every segment within `reach` of itself; beyond that the
point is more than a cell from the curve and the nearest field node is closer than
that again.

⚠️ `FenceField.values` therefore has an exact SIGN everywhere and a meaningful
MAGNITUDE only near the curve.

### Why the two sides differ, and only locally

`side` names the half being **removed**. Both sides share the base curve and the
run-out directions; what differs is per-side repair, and every one of those is driven
by a SIGNED quantity so it only fires on the side that actually has the problem:

| quantity | asks for | fires on |
| --- | --- | --- |
| `FenceBase.deviation` | room where the smoothing left the well behind | the side whose KEPT half holds the well |
| `FenceBase.roundness` | carving round a corner too tight to follow | the side left holding the sharp wedge |
| `repairPolylineWaists` | routing round a hairpin pocket | the side where the pocket is a thin blade |

⭐⭐ Treating any of these as an unsigned magnitude over-compensates one side and
under-compensates the other — measured as a 300 m bulge on one view and a razor crack
on the other, from the same curve.

### Why the cut is relaxed, not offset

The side curve is built by **constrained relaxation** against the well: alternate a
smoothing pass with a push back out to the required clearance, to a fixed point.

⚠️⚠️ An offset cannot do this job. Offsetting inward at a tight bend folds the curve;
de-looping the fold leaves a CORNER, and a corner in the curve is a near-degenerate
quad in the swept face — which tears the cut. Clamping the offset short of the fold
avoids the corner but then never opens far enough to free the well. Smooth or
sufficient, never both. The relaxation gives both: the smoothing removes the corner,
the push restores the clearance, and neither undoes the other.

⭐ A smooth curve is not cosmetic here. Sharp corners in the fence curve were the
direct cause of clipping artefacts along the seam.

### Why the clearance is baked into the curve

`ChunkFence.margin` is metres of clearance between the trajectory and the cut —
room for whatever is drawn *in* the hole (casings, completion, logs), which a cut
through the trajectory would slice in half.

It is applied by **offsetting the curve on the CPU**, not by thresholding the field
in the shader. The field is then a plain signed distance to the finished curve, the
shader's test is `< 0`, and the cut face is that same curve swept vertically. The
drawn face and the removed block are one object.

The alternative — a live width uniform — makes them two independent evaluations of
one implicit surface that have to be reconciled numerically. That is what the
previous implementation did, and it needed marching squares, a Newton solve to pull
face vertices onto the sampled isocontour, and a CPU↔GLSL parity test. All of that
is gone.

The price is that changing `margin` rebuilds the fence (~300 ms). It does **not**
rebuild the chunks.

### Why both sides are built up front

`side` names the half being **removed**, relative to the curve's left normal walking
the well from head to terminal depth. Both sides are built together, so flipping is
a texture swap and a curve swap.

Two sides are needed at all because the offset goes in opposite directions: whichever
bend is convex for one side is concave for the other, and it is the concave one that
folds. Everything else is shared — in particular the run-out directions, so the two
views remain two views of one section. With `margin: 0` and no junction needing
repair the two curves are identical, which `FenceReport.shared` reports.

### Run-outs

The trace has to leave the block at both ends or it does not separate anything.
Candidate directions per end are the end tangent, the overall trend of the curve, and
the midpoint of each wide gap in the bearings the trace occupies. Pairs are scored on
how evenly they split the **footprint polygon**, subject to a clearance constraint:
a run-out folded back alongside the well still splits the block evenly, so share
alone will happily pick a cut that closes to nothing at the wellhead.

## Traps this design exists to avoid

- **A curve that stops inside the raster.** Every raster pads itself by two cells,
  and a coarse raster over a large field pads further than a run-out reaches. The
  flood fill then walks around the end of the curve and calls the whole grid one
  side — a 0/100 split on geometry that is perfectly good. `rasterizeCurve` extends
  both end segments past the grid, so this cannot happen whatever the resolution.
- **A global minimum turning radius.** A genuine dogleg in the reservoir turns
  tighter than any sane target and its corridor is only a few metres wide, so the
  target can never be met. Only the **shallow** section is judged by radius.
- **A degenerate final vertex.** A resampler that appends the true endpoint after a
  sample a millimetre away leaves the end of the curve with no direction, and every
  angle measured there is numerical noise. Directions are measured over a real arc
  length, never one segment.
- **Sign from an arbitrary corner.** Signing the field by which half contains the
  grid's min corner makes `side` mean different things for different wells, and it
  can swap when an unrelated parameter moves. The fill is seeded on the removed side.

## Diagnostics

`buildWellboreFence` returns a `FenceReport` covering sampling, kickoff, relaxation,
head trimming, run-out choice and per-side outcome, plus per-stage timings.
`assertFenceInvariants(report)` turns it into a list of readable problems and is the
single definition of "broken" — the tests, the debug overlay and the development
warning all read it.

- **Numeric sweep:** `FENCE_REPORT=1 npx vitest run tests/fence-report.test.ts
  --disable-console-intercept` prints a table over every wellbore and margin. Set
  `FENCE_REPORT` to a name fragment for the full report of one well. Skipped by
  default, so it costs nothing in the normal suite.
- **Visual:** the `Debug/Chunk fence` story draws the raw trace, the straightened
  base curve, both side curves and the run-outs in **plan**, next to a HUD of the
  report. Plan view is where a fold or a razor wedge is obvious; the 3D view is not.
  Driveable from the URL like the OIT harness.
- **Headless:** that story publishes `window.__videxFence` with the report, the
  curves and a field sampler, so numbers can be read without a screenshot.
- `fenceResidual(side, points)` measures `|fenceSideAt|` at the cut face's own
  vertices. It is the invariant that replaced the parity test: the face is the curve
  and the cut reads that same curve back, so it is bounded by float precision.

## Consumers of the cut

Anything that has to agree with the cut reads the same lookup:

- the **fragment discard**, through `fenceSide` in `sdk/materials/shaderLib/fence-field.glsl`;
- the **sea**, whose two materials read that same chunk through `OCEAN_FENCE`, so the
  water ends on the curve rather than a fraction of a cell either side of it;
- the **immersion fog**, which asks whether the camera is standing in the half that
  was taken away — exactly, so the fog switches at the cut rather than metres before
  it;
- the **cut face**, which is the curve itself.

What the fence removes is opt-out per medium, the same way `ChunkSection`'s is, and
both default **off** — the sea and the base plate FRAME the block. An intact water
surface over an opened column reads immediately as a field seen in section, while a
sea cut in half alongside it mostly reads as missing.

- `ChunkFence.water` hands the fence's shared uniforms to `OceanMaterial` and
  `OceanVolumeMaterial`, and the water body is then CLOSED by a face of its own
  (below).
- `ChunkFence.carrier` cuts the column's floor with the rest.

⚠️ Both are DEFINES, so toggling either rebuilds the materials concerned. The curve
itself moves through the uniforms, and rebuilds nothing.

⚠️ Turning the water on does not just remove the sea — it changes what the camera is
standing IN. A cut that opens the geology without draining the water above it leaves
the camera inside the sea where there is no longer any rock, so the fog reports water
there and suppresses only the sediment medium.

### The sea's cut face

The sea is built by `buildSurfaceStack` as a stack of exactly two boundaries — the
level and the bed — so it can emit a `StackSectionSource` like any other stack.
`StackWaterSpec.section` asks for it, and with it in hand the water's cut face is the
same two builders the chunks use: `buildFenceRibbons` for a fence, `sectionStackInterval`
for a plane. One filled interval, so at most one face.

⭐ Why it lines up: the face is swept over the sea's own channels, whose bed IS the
column's shallowest surface, along the same curve the block's face follows. There is
no second opinion about where the sea bed is to leave a gap along the seam.

⭐ It is drawn with a THIRD `OceanVolumeMaterial` carrying no cut of its own. The face
lies exactly on the curve, so testing it against the thing it exists to close punches
holes along its length — the same reason `ChunkMeshes` builds the block's faces with
both cut gates off. The builders write `wallV`, which is what `wallAttribute: true`
already reads, so the depth-fog tint and the swell-displaced top edge come out right
with no shader change.

⚠️ The channels are requested by the PRESENCE of a cut on the stack, never by
`enabled` — they are a build output, so keying them on the toggle would rebuild the
sea every time the cut is switched on or off.

⚠️ **Picking does not yet.** `PickingMaterial` is an override material with its own
fragment shader, so neither the fence nor `ChunkSection` is applied during a pick —
you can pick block that was visually cut away. Closing it needs a fragment-shader hook
on `CustomPickingMaterial` and should cover the section case at the same time.

## Which half to remove, and where to stand

A cut face can only be read from the half that was **removed** — from the other one
the block itself is in the way. So the side is not a preference to be set: it is a
function of where the camera is, and the two have to be decided together.

`ChunkFence.side: 'auto'` makes the stack decide it every frame. The camera's world
position is brought into the stack's own frame and handed to `fenceAutoSide`, which
is one `fenceSideAt` query against the **plus** side — that field partitions the whole
plan, so there is no third answer to ask the minus side for. Orbit past the fence and
the block changes sides, and the section stays readable.

Two thresholds keep that from becoming a flicker, and both are needed:

- `autoDeadband` (metres) — an orbit crosses the fence exactly where the two halves
  are equally good, and a plan view looks straight down it. At zero the side would
  toggle every frame in both cases. It is never allowed below `margin`: with a
  clearance baked in, the corridor between the two sides' curves belongs to *neither*
  removed half.
- `autoSettle` (seconds) — the deadband alone is crossed in a frame or two at speed,
  so a fly-through would flip the block twice on its way past.

`fenceViewPose(fence, { top, bottom, from?, side?, guard? })` answers the other half
of the question: a camera pose that looks square-on at the cut.

- It is built from the **trace** (`FenceBase.points`), not from a finished side
  curve. The side curves carry run-outs that leave the footprint, so their spread is
  the field's rather than the well's — take their principal axis and a short well in
  a wide field gets framed by its run-outs.
- The heading starts at the trace's principal axis turned a quarter turn, so the view
  is across the section rather than down it.
- ⭐⭐ **That heading is then checked against the fence, not trusted.** A well that
  bends enough puts the point square-on to its own average *back inside the block* —
  measured 300 m inside on one of the demo wells, which is a cut face with rock in
  front of it. `fenceSideAt` is right there, so the headings the cut can be seen from
  are scanned in 10° steps across ±90°, and the pose reports whether it found any
  (`open`). Verified over every demo well, both sides, in `tests/fence-view.test.ts`
  (`FENCE_VIEW=all` for the sweep).
- ⭐⭐ **It takes the middle of that opening, not the first heading in it.** A well
  angled across the field is open only near its run-outs, and an opening ENDS exactly
  where `fenceAutoSide` flips — so stopping at the first heading that works parks the
  camera a nudge away from swapping the half it has just removed. The ends are
  bisected to a degree and `guard` (default 25°) of clearance is kept from them. ⚠️
  Spent only when it must be: square-on is kept wherever the opening has room for
  `guard` either side of it, so a straight fence is framed exactly as before.
- With `side` left free, `from` breaks the tie on **travel**: both sides are equally
  readable, so taking the one the view is already coming from turns a fly-to into a
  short swing instead of a trip round the back.

The box it returns is the trace's plan extent through the block's depth range, which
`CameraManager.frame`/`flyTo` turn into a distance from the camera's own fov. See
[camera.md](./camera.md) for the flight that uses it.

## Known limits

- ⚠️ **Wellhead burial on one side.** Measured worst case: 34 m at the head, 88 m
  anywhere. The run-outs are attached, and the loop and waist repairs run, AFTER the
  trace has been relaxed clear of the well — so any of them can put the cut back
  across it. `FENCE_REPORT=buried` reports burial at the head separately, because a
  whole-trajectory figure hides the one place a viewer always looks.
  ⚠️ A naive guard pass over the whole assembled curve was tried and made things
  worse (it distorted the run-outs and cost 25 points of even split); the fix needs to
  cover the junction region only.
- **Multi-lobe footprints.** A stack whose outline is several disjoint regions —
  which happens when a column's chunks derive their outlines from the wellbores —
  cannot generally be split evenly by one well. The report flags it
  (`removes only N% of the block`) rather than failing silently. Handling it properly
  is future work.
- A plan trace that genuinely crosses itself cannot be swept into a manifold vertical
  surface. Loops are removed from the offset curve, which means the fence stops
  following the well across the excursion.
