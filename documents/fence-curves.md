# Fence curves

Two features in this library sweep a **vertical surface along a wellbore's plan
trace**, and they solve overlapping problems with almost no shared code:

| | `WellboreSeismicSection` | `ChunkFence` (column) |
| --- | --- | --- |
| what it is | a standalone **sheet** carrying a seismic image | a **cut** through a chunk stack |
| curve from | `getProjectedTrajectory` (`sdk/utils/trajectory.ts`) | `createFencePolyline` + `extendFencePolyline` (`sdk/geometries/wellbore-fence.ts`) |
| geometry | `createFenceGeometry` (`sdk/geometries/fence.ts`) | `fenceContour` + `buildFenceRibbons` |
| run-out length | fixed metres (`extension`, `minSize`) | ray-cast out of the outline, plus `margin` |
| run-out direction | end tangent, with an azimuth fallback | chosen by how much block each side is left with |
| sides | one sheet, viewed from either face | a cut, so a **kept** side and a **removed** side |
| horizontal coordinate | `uv.x` = arc length **normalised 0..1** | `along` in **metres** |

This note records what the column fence work taught us about these curves, which
of it transfers to the seismic fence, and what a seismic drape on the column fence
would need.

## What a fence curve has to satisfy

Working through the Volve data turned up three requirements, in increasing order of
how long it took to find them.

### 1. It must not cross itself

A vertical sweep along a self-crossing plan trace produces a sheet that passes
through itself. For a **cut** that renders as a fan of triangles splayed from the
crossing and a face that is inside-out beyond it. For an **image** it is arguably
worse: the same seismic interval is drawn twice, mirrored, and the section reads as
a fold that is not in the data.

⚠️⚠️ The crossing has to be looked for in the right place. Measured on the demo
data, the extended **polylines** self-crossed zero times at the default settings
while their **contours** crossed up to 965 times. Two implementations were built
and reverted on the strength of the polyline number before anyone measured the
contour. Whatever the geometry is finally swept along is the thing to check.

`removeChainLoops` (`sdk/geometries/wellbore-fence.ts`) is the repair: find a
self-crossing, replace the loop between the pair with the crossing point. It is
grid-bucketed, so a clean chain — nearly all of them — costs one linear pass rather
than a quadratic one.

⭐ It is applied in **two** places for the column fence, and both are load-bearing:

- to the extended polyline, **before the field is rasterised**. A curve that
  crosses itself encloses a pocket, and the flood fill that signs the distance
  field hands that pocket the far side's sign — so the block gains or loses a
  closed island that no face describes.
- to each contour chain, **after** it is extracted, because an offset curve
  self-intersects on the inside of any bend tighter than the offset.

### 2. Its run-outs must be aimed, not sampled

Both curves currently aim their run-outs with the **end tangent**: the direction of
the first (or last) non-degenerate step of the plan trace. That is the direction of
a few metres of hole, measured where a well is at its most vertical and its plan
trace at its least meaningful.

On a well that arcs through its shallow section the tangent ends up pointing back
along the corridor the well later occupies. Measured on the Volve data, the angle
between the head run-out and the nearest part of the trace was **0°** for four of
twenty-three wellbores.

⚠️⚠️ There is a specific bug shared by both code paths. Each has a guard meant to
stop the two run-outs pointing the same way, written as:

```ts
if (Math.abs(dotVec2(end, start)) > 0.95) start = [-end[0], -end[1]];
```

Both directions point **outward**, so "the same way" is `dot` near **+1**; near −1
is the ordinary, wanted case. Testing `abs(dot)` conflates the two — and a
fold-back well has a head tangent nearly *parallel* to its tail tangent, so the
guard fires on precisely the wells that need help and substitutes the antipode of
the tail direction, which aims the run-out straight back down the arm the well
returns along.

`extendFencePolyline` has been fixed. **`getProjectedTrajectory` has not**, so the
seismic fence still carries it (`sdk/utils/trajectory.ts`, in the extension block).

### 3. For a cut, both sides must be worth looking at

This one is specific to the column fence, and it is the requirement that replaced
several failed proxies.

A fence exists to take away whatever stands between the viewer and the well, so
what matters is that the side being removed is a **usable piece of the block**.
Measured as the share of the footprint each side holds, the healthy wells split
43-58% while the broken ones left one side **0-17%** — and a 0% side is a cut that
either shows nothing or removes everything.

⚠️ Angular clearance from the trace does **not** imply this. `NO 15/9-F-11 A` has
68° of clearance and still kept only 17%. The proxy was measured, believed, and
wrong.

`splitShares` rasterises candidate curves coarsely and flood fills them exactly as
`createFenceField` does, and the run-out pair is chosen to maximise the removed
share, capped at `reveal` so that once the cut is usable it stops being pushed
wider.

⭐ The pair is **shared between the two sides** unless one of them would fall below
a floor. On the demo data all 24 wellbores share, so the two sides are exact
flip-sides of one section — which is what makes them comparable. The per-side path
exists for the well that eventually needs it.

## What transfers to the standalone seismic fence

| improvement | transfers? | why |
| --- | --- | --- |
| `removeChainLoops` | ⭐⭐ **yes, directly** | a folded sheet draws the same seismic twice, mirrored |
| the `abs(dot)` guard fix | ⭐⭐ **yes, directly** | same bug, same consequence: the sheet doubles back over the well |
| aiming run-outs by clearance | partly | the seismic sheet removes nothing, so there is no "side"; but a run-out that lies along the trace still folds the sheet |
| run-outs by **removed share** | ❌ no | nothing is removed; the quantity is undefined |
| the depth **taper** (`headWidth`) | ❌ no | see below — a taper and a seismic image are mutually exclusive |
| ray-cast run-out length | ❌ not needed | the sheet has no outline to escape; `extension`/`minSize` is the right control for an image |

The cheap, high-value change is the first two rows: run `removeChainLoops` on the
projected trace before `createFenceGeometry`, and fix the guard. Neither changes
the component's API.

⚠️ `simplifyCurve2D` cannot substitute. It removes near-collinear points and has no
notion of a crossing.

## What a seismic drape on the column fence would need

The column fence's ribbon already carries `uv.x` as **arc length in metres**, so
the hard part is not the geometry.

⭐ **`width` must be 0.** At any other width the cut face is an *offset* of the
trace, and the `along` it carries is the arc length of the **nearest point** on the
curve — which is discontinuous across the medial axis of a bend and stationary
where the offset outruns the curve. A seismic image sampled by it would be smeared
at exactly the bends. The same argument rules out the depth taper, which is a
variable-width offset by construction.

⭐⭐ **The curve must become an input to the slice request.** Today
`generateWellboreSeismicSection` takes a wellbore id plus step/extension arguments
and re-derives the trace internally. The column fence's curve is chosen by the
outline, the `reveal` target and (potentially) the side, so it cannot be
re-derived — the two would silently sample different sections. A drape needs the
generator to accept the plan curve it must sample along.

⭐ **One slice serves both sides**, given the shared-run-out rule above: the two
sides use the same curve and differ only in which way the face is turned. Only a
wellbore that falls below the share floor and takes per-side run-outs would need
two slices, and that case can be detected up front by comparing the two curves.

⚠️ **The normalised `uv.x` is a trap.** `createFenceGeometry` divides by the total
curve length, so the image stretches or compresses with the extension length. Two
fences over the same well with different extensions do not agree on where a
reflector sits. Metres, as the column fence uses, is the coordinate a seismic
volume should be addressed by; the normalisation belongs in the material, against a
uniform that also knows the slice's own extent.

## Suggested order of work

1. `removeChainLoops` on the projected trace in
   `generateWellboreSeismicSection`, and the `abs(dot)` fix in
   `getProjectedTrajectory`. Small, self-contained, fixes a real defect in a
   shipped component.
2. Decide whether `getProjectedTrajectory` and `extendFencePolyline` should
   converge. They are two extension policies for one idea; the differences that
   are *real* are the run-out length (metres vs ray-cast) and whether a side
   exists. The rest is duplication.
3. Only then look at draping seismic on the column fence, which is mostly a
   question of getting the curve into the slice request rather than a geometry
   problem.

⚠️ Every number quoted here came from sweeping the whole demo dataset across
parameters and both sides. Spot-checking at default settings hid all three of the
defects above at one point or another during the work.
