# Carving solids out of the column

_Status: proposal. Nothing here is implemented._

A **carve** removes a closed solid from a chunk stack and fills the exposed wall with
the boundary of that same solid. The motivating case is the wellbore itself: cut the
actual hole — stepped by hole size — out of the block, so a section or a fence face
shows the borehole in cross section with the casing string sitting in it.

## The pattern this generalises

The stack already has two cuts, and both are the same construction:

| cut | GPU test | fill geometry |
| --- | --- | --- |
| section | `dot(plane, p) > 0` → discard | ribbon swept from the plane |
| fence | signed distance to a carried polyline | that same polyline, swept vertically |

The load-bearing property in both is **the fill mesh is the exact zero set of the
discard test**. That is why the fence deleted its marching squares, its Newton snap
and its CPU↔GLSL parity test: face and cut stopped being two reconstructions of one
boundary and became one object (see `fence-curves.md`).

A carve is the same contract with the halfspace/prism replaced by another solid.

## What "any geometry" can mean

Not an arbitrary `BufferGeometry` handed in by the host. A carve needs an **implicit
inside test** that is cheap and exact in the fragment shader, and a mesh generator
that emits precisely that solid's boundary. Arbitrary triangle-soup CSG on the GPU
was already rejected for the fence and is rejected again here for the same reasons.

What is viable is a small, closed family of parametric solids, composed by union:

- halfspace (the section — already have it)
- vertical prism over a polyline (the fence — already have it)
- **chain of cone frusta** (a tube with a stepped radius — the subject of this note)
- box, sphere/ellipsoid, if a use case turns up

## The tube case

The solid is the union over segments of

$$\{\,p : \lVert p - \mathrm{proj}_{ab}(p)\rVert < r(t)\,\}$$

with $r$ linear in $t$ along each segment — a cone frustum with flat, axis-perpendicular
caps. A hole-size step is two segments meeting at a point where $r$ jumps, and the
union then has an annular ledge exactly there.

`createTubeGeometry` (`sdk/geometries/curve/tube-geometry.ts`) already emits that
boundary: its `radiusModifier` produces the stepped profile, and it inserts the extra
ring pair at each transition so the ledge is real geometry with its own normals.
`Casings` builds its strings this way already (`components/Wellbores/Casings/casing-geometry.ts`).

So the fill is not a new mesh — it is the casing, drawn where the rock used to be.

### Bias, not tolerance

Carve at radius $r$, draw the tube at $r + \varepsilon$. The tube is then embedded in
the rock rather than coincident with the hole wall, and no grazing-angle sliver can
open up between them. Same move as baking the fence's clearance into the curve: the
agreement is structural, not a tuned epsilon.

### Self-intersection at bends

Where the trajectory turns, consecutive frusta overlap, so parts of the tube mesh lie
inside the solid. Apply the carve test to the tube's own fragments and those parts
discard. The test is exact, so this costs one extra evaluation and needs no tolerance.

## Cost and structure

1. **The index must bucket in 3D.** The fence buckets in XZ, which works because a
   fence is vertical. A near-vertical well would drop its whole string into one XZ
   cell and blow the bounded loop. A 3D grid flattened into a 2D atlas is the shape
   of the answer; the row/column texel arithmetic in `fence-field.glsl` extends
   directly.
2. **Two more samplers**, on a material that already carries the fence sign map, the
   fence cells and segments, the contact maps and the bathymetry map. Samplers are
   the scarce resource here, not bytes.
3. **The test runs on every fragment of every chunk** while rejecting only near a
   well. It needs the coarse near-mask early-out the CPU builder already uses, plus a
   per-chunk bounds test so chunks with no well in them never compile the define.
4. **Two implementations.** The section discard exists both in `chunk-frag.glsl` and
   in the string-injected `inference-material.ts`. A carve would need both.
5. **Picking still ignores it.** `PickingMaterial` is an override material with its
   own fragment shader, so the carve — like the fence and the section — is not
   applied during a pick. Same known limit, same fix.

## Open question, worth settling first

With `ChunkFence.margin > 0` the cut is deliberately offset so the well stays inside
the kept block. The hole is then a sealed void and nothing is visible. A carve reads
as "the wellbore is drilled through the rock" only:

- at `margin ≈ 0`, where the exposed face gets a half-round groove,
- on a section plane crossing a well, where it gets a circular hole,
- where a well penetrates the top cap or a horizon that is drawn.

That is worth checking with a throwaway spike — one well, one section plane, no
bucketing — before any of the machinery above is built.
