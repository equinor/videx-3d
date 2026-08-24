# Cutting, water and immersion

Opening the block to look inside, the sea on top of it, and what happens when the
camera goes in.

- [Two ways to cut](#two-ways-to-cut)
- [The section plane](#the-section-plane)
- [The cut face](#the-cut-face)
- [Keeping a unit whole](#keeping-a-unit-whole)
- [Restoring what the collapse dropped](#restoring-what-the-collapse-dropped)
- [The fence](#the-fence)
- [The sea](#the-sea)
- [Immersion fog](#immersion-fog)

---

## Two ways to cut

```tsx
<ChunkStack section={{ cameraDistance: 2000, lockToTarget: true }}>
<ChunkStack fence={{ wellbore: selectedId, side: 'auto', margin: 30 }}>
```

| | `section` | `fence` |
|---|-----------|---------|
| Shape | one plane | a vertical surface swept along a wellbore path |
| Driven by | a `Plane`, or the camera | a wellbore id |
| Shader input | `vec4(normal, constant)` | a signed field texture + segment index |
| Changing it | free (a uniform write) | free (a texture swap) |
| Cut face | swept per prism cell | a ribbon along the curve |

They are **mutually exclusive** — both cut, and two cuts at once say less than one.
If both are enabled the fence wins, and `ChunkStack` warns.

Two things they share:

> ⚠️⚠️ **The cut lives in `ChunkMaterial`'s shader, not in the renderer.** It cuts
> the chunks and, optionally, the sea — and *nothing else*. Wellbores, vessels,
> facilities, pipelines, annotations and host meshes all keep drawing whole. That
> is deliberate (a renderer-wide clip would slice the well you are trying to look
> at), but it means an object resting on the sea bed stays put while the ground
> under it is cut away.

> ⚠️ **Presence is a build input; `enabled` is not.** The cut face is built from
> channels the *build* has to emit (`SurfaceChunkSpec.section`), so adding or
> removing the prop rebuilds every chunk. Toggling `enabled` is free.

---

## The section plane

```ts
type ChunkSection = {
  plane?: Plane;              // object space; points where distanceToPoint > 0 are removed
  cameraDistance?: number;    // lock the plane in front of the camera
  lockToTarget?: boolean;     // …or on the orbit pivot
  vertical?: boolean;         // keep it upright (default true)
  enabled?: boolean;          // default true
  offset?: number;            // default DEFAULT_SECTION_OFFSET = -0.05
  water?: boolean;            // cut the sea too. Default FALSE
  carrier?: boolean;          // cut the floor too. Default FALSE
  debug?: boolean;            // draw where the plane is
};
```

### Object space, not world

The plane is tested against the **raw vertex position** in the stack's own frame.
A stack may carry a vertical exaggeration (`scale={[1, k, 1]}`), and a world-space
test would disagree with the object-space geometry the cut face is built from.
A camera-locked plane is therefore built in world space and then transformed into
the stack's frame through `stackFrame.matrixWorld.invert()`.

### Camera locking

> ⭐ Moving the camera *is* the interaction. It needs no gizmo, no pointer
> handling and no widget to hit.

- `cameraDistance` puts the plane that many metres in front of the eye, facing it,
  so everything nearer is cut away and **dollying drives the cut through the
  block**.
- `lockToTarget` anchors it on the camera **target** instead, so orbiting swings
  the cut about the pivot and dollying does *not* move it — you can zoom right into
  the cut face to read it without the cut running away. Flying to a point puts the
  cut on that point.
  ⚠️ The target comes from `state.controls`, so this needs controls with
  `makeDefault` that expose one (`CameraControls`, `OrbitControls`). Without them it
  falls back to `cameraDistance`, silently.
- `vertical` (default **true**) takes the camera's heading but never its dip. A
  section is conventionally drawn on a vertical plane, and a cut that tilts with the
  camera makes the block appear to shear as you orbit — the geology stops being
  readable, which is the whole point of the view.
  ⚠️ Looking straight down leaves no heading in the view direction, so the code
  falls back to what is "up" on screen; otherwise the plane snaps as the view passes
  through vertical.

### How it reaches the shader

`ChunkStack` writes one shared `IUniform<Vector4>` once per frame in `useFrame`,
registered on the stack so it runs **after** any child's own `useFrame` (child
effects subscribe first) — a caller animating the plane from inside the stack is
therefore read in the same frame it wrote.

> ⭐ Every `ChunkMaterial` of every chunk is handed the **same uniform object**, and
> a `ShaderMaterial`'s OIT variants share their `uniforms` by reference. One write
> per frame reaches every material in all four passes, with no React render and no
> material rebuild. `Plane` with a zero normal and `w = -1` is the disabled state.

Mutating `section.plane` directly therefore animates the section at no render cost.

### The offset sign

`DEFAULT_SECTION_OFFSET` is **−0.05**: the face sits slightly **proud** of the cut.

> ⚠️⚠️ The obvious sign is wrong, and the symptom is subtle. The block survives
> right up to the plane (`if (dist > 0.0) discard`), so a face nudged into the
> **kept** half leaves a five-centimetre slab of block standing *in front* of the
> face that is meant to close it — slivers of near-horizontal caps seen edge-on,
> the brightest thing in the view, appearing as bright specks along the top of every
> band and getting worse as you tilt down or zoom in.
>
> Proud of it, the faces tile the whole cross-section nearer than anything they
> close, and nothing can show through. Adjacent intervals' faces meet exactly, so
> their union is complete.
>
> `polygonOffset` is **not** the tool here (and log depth forbids it anyway): this
> is a knife edge — two surfaces meeting along a line — not two coplanar ones.

### Why the sea and the floor are not cut by default

> ⭐ The sea and the base plate **frame** the block. An intact water surface over an
> opened column reads immediately as *a field seen in section*; a sea cut in half
> alongside it mostly reads as *missing*. Same for the floor: an intact base plate
> is what stops the cut reading as a hole.

Turn `water: true` on when the water column itself is the subject. ⚠️ It rebuilds
the two ocean materials (the cut is a define).

---

## The cut face

Without a filled face, a cut block is a hollow shell. `useChunkSection` builds
**one face per filled interval**, every frame, from the channels the build emitted.

```ts
type StackSectionSource = {
  positionsXZ: Float32Array;
  indices: Uint32Array;
  heights: Float32Array[];
  intervals: Uint8Array[];     // per interval: bit-packed triangle membership
  inferred?: Float32Array[];
  layers?: number[];           // build interval → caller's layer
};
```

> ⭐ **Section the CHANNELS, not the drawn meshes.** An interval is a stack of
> triangular **prisms** — a triangle of the tessellation, its top heights and its
> bottom heights. Cutting a prism with a plane is a small, exact operation, and the
> faces of adjacent intervals meet exactly because they share the same triangles
> and the same heights.

```
       plane
         │
   ▁▁▁▁▁▁│▁▁▁▁▁     top layer heights
  ╱      │     ╲
 │   ██████     │   ← the polygon this prism contributes to the face
  ╲______│_____╱
         │           bottom layer heights
```

Per prism: intersect the triangular top, the triangular bottom and the three
vertical sides, then sort the intersections by angle in the plane.

`sectionStackInterval(source, interval, plane, target, options)` writes into a
**preallocated target** and returns how many vertices were needed; the geometry's
draw range is what moves. Allocating a `BufferGeometry` per frame would make a
rotating plane a garbage generator. Capacity grows by doubling.

### Making it affordable

The naive version rebuilt every frame and walked **every triangle** of the TIN per
interval — measured at 33 × 1.08 M = 35.6 M prism tests per frame, on the main
thread. Two fixes:

1. **A dirty check.** The last normal, constant, enabled flag, offset **and the
   `faces` array identity** are cached; an unchanged plane recomputes nothing.
   ⚠️ The identity check matters: without it a rebuilt chunk never draws.
2. **`buildStackSectionIndex`** — a uniform XZ grid with CSR buckets by triangle
   **centroid** (one cell per triangle, box grown), plus a per-interval per-cell Y
   range.
   ⭐ Cell rejection is the AABB/plane test `|d| ≤ r`, which is
   orientation-independent, so a tilted plane needs no second structure; and the
   per-cell **Y range** is what makes a near-horizontal cut cheap.
   ⭐ **One index serves every interval** — they share topology and XZ, and only the
   heights differ.

Measured: an animated section went from 250.3 ms/frame to 31.1 ms, and a still
section costs the same as no section at all.

The face is drawn with the **interval's own fill material**, so per-layer opacity,
detail and a caller's own `Material` all carry onto the section — with the cut
switched off in that material (see
[appearance.md](./appearance.md#which-mesh-gets-which-material)).

---

## Keeping a unit whole

`ChunkLayer.section: false` leaves a unit **uncut** while everything around it is
cut away — a slab standing proud of the section. That is how you single out a
reservoir, a seal or the sea bed.

> ⭐ It keeps the whole **unit**, not one surface: the layer's cap, the volume
> below it, **and the cap that floors that volume**. The floor is *inferred* — a cap
> is left uncut whenever the unit above **or** below it is kept:
>
> ```ts
> const keptUnit = (i) => layers[i]?.section === false;
> const cutWall  = (i) => !keptUnit(i);
> const cutCap   = (i) => !keptUnit(i) && !keptUnit(i - 1);
> ```
>
> A unit whose top survives the cut but whose base does not is not a slab — it is a
> lid over open space, which is the hollow shell the section exists to avoid.

Consequences: keeping two adjacent units shares the cap between them, once; keeping
the **last** unit keeps the column's floor with it; and no cut face is drawn for a
kept unit, because there is nothing to close and a face there would sit inside
solid material.

---

## Restoring what the collapse dropped

The collapse drops a cap's triangles where the layer **above** covered them (welded
duplicates, truncation). That justification only holds while the covering layer is
**actually drawn** — and both a **peel** and a **section** can take it away.

So a `peelable` build also emits, per cap, the fragments it gave up
(`SurfaceChunkMesh.patchIndex`). `ChunkMeshes` turns each into a small geometry
that **shares the cap's attribute buffers** and carries only those indices, so a
patch costs one small object and adds no overdraw where the cap already draws.

Two ways the cover can go, so two materials:

| Mode | When | Material |
|------|------|----------|
| `'open'` | this is the first surviving layer of a peel — the cover is gone everywhere | drawn unconditionally |
| `'cut'` | this cap survives the section but the one above it does not | drawn with `sectionUniformInverse` |

> ⭐ The inverse uniform is the exact **complement** of the section plane, so the
> patch and the covering layer are mutually exclusive **by construction**, with no
> tolerance to tune. And negating the disabled value `(0,0,0,-1)` gives `(0,0,0,1)`,
> which draws nothing — exactly right when nothing has been cut away.

⚠️ A caller-supplied `Material` cannot be given the inverse uniform, so such a
layer keeps its holes.

---

## The fence

A **fence** is a vertical surface swept along a wellbore's path in plan, run out
past both ends so it reaches clear of the block.

```ts
type ChunkFence = {
  wellbore?: string;
  side?: 1 | -1 | 'auto';
  autoDeadband?: number;      // default max(margin, 50)
  autoSettle?: number;        // default 0.2 s
  margin?: number;            // clearance between trajectory and cut. Default 0
  extension?: FenceExtensionMode;  // default 'straight'
  enabled?: boolean;
  offset?: number;            // default 0
  resolution?: number;        // face spacing, default 10 m
  water?: boolean;            // default false
  carrier?: boolean;          // default false
  debug?: boolean;            // draw the ribbon as a magenta wireframe
};
```

> ⭐⭐ **Why it is cheap enough to drive from a selection.** A fence is *vertical*,
> so what it removes depends on **XZ alone**. That is one number per vertex, which
> the shader reads as a varying and the CPU contours to build the face. No rebuild,
> no worker, and nothing per frame once it has settled.

### What `useStackFence` builds

From the position log (placed into the scene frame exactly as the outline pipeline
does) → a spline → `buildWellboreFence(curve, { rings, margin, extension })`, which
produces **both sides** up front:

- a **sign field** as a `DataTexture` (Red, Float) — negative in the removed half,
  positive in the kept half;
- a **segment index** (cells + segments textures) for the *exact* boundary lookup;
- the resampled **curve** the cut face follows.

> ⚠️ `NearestFilter` + `FloatType` everywhere. The field is a **sign**, and the
> index and segment textures are **data** — interpolating any of them is exactly
> the mistake the segment lookup exists to correct.

> ⭐ Building both sides up front means a side flip is a **texture swap and a curve
> swap**: no rebuild, no refetch, and no window in which the shader cuts last side's
> field with this side's test.

> ⭐ The curve is published **on the stack**, not derived per chunk — otherwise
> every chunk repeats the most expensive step of the feature with identical inputs.

In dev builds, `assertFenceInvariants(report)` warns about a malformed fence.
(⚠️ `import.meta.env.DEV`, not `process.env.NODE_ENV` — this is browser code and
Vite is what strips the block.)

### `side: 'auto'`

> ⭐⭐ The camera must be in the half that was **removed** — from the other one the
> block is in the way and there is no cut face to read. Orbit past the fence and the
> block changes sides so the section stays readable.

`fenceAutoSide` tests the camera (brought into the stack's frame) against the
removed half's boundary, with two guards:

- **`autoDeadband`** — an orbit crosses the fence exactly where the two halves are
  equally good, and a plan view looks straight down it, so a little slack stops a
  jitter there toggling the whole block.
- **`autoSettle`** — *time*, not distance, is what keeps a fly-through from flipping
  the block twice on its way past; the deadband alone is crossed at speed.

### `margin`

Metres of clearance kept between the trajectory and the cut. Default 0, which puts
the face through the well itself. Raise it to leave room for what is drawn **in**
the hole — casings, completion, logs — which a cut through the trajectory would
slice in half.

⚠️ It is baked into the curve, so changing it rebuilds the fence (not the chunks).
It also sets how smooth the curve has to be: an offset folds wherever the curve
turns tighter than the offset itself.

### The fence face

`useChunkFenceFace` builds a **ribbon** along the curve at `resolution` metres,
independent of the tessellation — so that one number alone sets its smoothness. A
corridor gives an interval **two** faces, which is why `ChunkSectionFace` carries a
`wall` index: keying only on the interval would collide and React would drop one.

`ChunkFence.offset` should normally stay at **0** — a fence's face is drawn with a
material that is not cut, so it needs no nudge to escape its own test. A small
negative value pushes it proud if a seam ever shows.

`ChunkStack.onFence` reports each finished `WellboreFence` (and `null` when there
is none), which is what a host needs to **frame** the cut: the curve, its extent and
which half each side removes are all there, so a camera move can be built from the
fence that was actually generated rather than from a re-derived guess (see
`fenceViewPose` and [../fence-curves.md](../fence-curves.md)).

---

## The sea

```tsx
<ChunkStack outline={fieldPolygon} water={{ depth: 0, windSpeed: 8, opacity: 0.9 }}>
```

> ⭐ **The sea belongs to the COLUMN, not to a chunk.** A lid covers its whole
> footprint by design, so two chunks each drawing part of it would leave two
> coplanar lids wherever their footprints overlap. The stack draws it once.

`StackWater` is `OceanWaterProps & OceanBodyProps & ChunkWaterTint` plus `depth`,
`opacity` and `resolution`.

### How it is built

The `stackWater` generator builds the sea as a stack of exactly **two boundaries**
— `[level, bed]` — over the stack outline:

- the **bed** is the column's shallowest surface, pulled from `getStackContext`
  (a cache **hit**, using the same key the chunks derive), so the water body meets
  the bed the chunks draw rather than a second opinion about where it is;
- `caps: [true, false]` — the bed is drawn by whichever chunk it is the lid of;
- the level layer contributes **no refinement candidates** (a plane is exact
  everywhere) and the bed reuses the column's candidates.

It returns `{ lid, body, section? }` — the lid, the water body's walls (the rim and
the shoreline), and the channels a cut face needs.

> ⚠️ The lid and the chunks are still **two different tessellations**, so they agree
> only within `maxError`.

### Resolution

`StackWater.resolution` is the lid's target triangle edge length. **Omit it** for
the fewest triangles that fill the outline — all a flat surface needs, since its
waves are shaded per pixel.

Only worth setting when vertex `displacement` is on, and then no finer than the
swells being displaced need: it applies over the whole footprint, so the triangle
count grows with the **square** of the field size. `DEFAULT_WATER_RESOLUTION` is
100 m, used automatically when displacement is on and no resolution is given.

### Two opacities

> ⚠️⚠️ `water.waterOpacity` (default **0.7**) is the water's **own** opacity and
> only a base — the shader computes `alpha = mix(uOpacity, 1, fresnel) *
> uMasterOpacity`, so the surface is see-through from above and mirror-like at a
> grazing angle whatever it says. `StackWater.opacity` is the master multiplier.
> Water that looks "too transparent at opacity 1" is usually carrying
> `waterOpacity`'s default.

### Floating objects come free

`useStackWater` also creates the wave **sampler** (`createOceanSampler(surface,
-depth)`) and an `OceanContactRegistry`, and `ChunkStack` provides them as
`OceanSamplerContext` / `OceanContactContext`. A floating child — a vessel, a buoy —
heaves with the swell and spreads foam exactly as it would inside an `<Ocean>`,
with nothing extra wired. Heights come back **absolute** in the stack's frame, so
no sea-level parent group is needed.

> ⚠️ A uniform holding "cos/sin of an angle" names no convention either end can
> check. Contact foam was mirrored about the forward axis for a long time because
> `setContacts` uploaded `(cos, sin)` while the shader treated it as a direction
> (a +Y rotation gives `(cos, −sin)` in XZ). **Hold the direction vector.**

See [../ocean.md](../ocean.md).

---

## Immersion fog

```tsx
<ChunkStack immersion={{ water: true, sediment: true, visibility: 400 }}>
```

> ⭐ Both the sea and the block are made of **surfaces**, not of a medium. From
> outside, every sightline crosses one and picks up its attenuation; from inside,
> there is nothing in the path at all and the view is impossibly clear. Scene fog
> supplies what is missing: attenuation by distance **from the camera** — which also
> reaches host geometry (vessels, facilities, pipelines) that no material of this
> library could.

`StackImmersionFog` decides the medium each frame by sampling the surface at the
camera's XZ, testing the camera against the section plane in object space, and
testing it against the fence **index** (the exact boundary lookup, not the field —
the field alone would answer a fraction of a cell out, which is metres, enough for
the fog to switch on before the cut visually reaches you).

`StackImmersion` options: `water`, `sediment`, `color`, `visibility` (default 400),
`background` (default true), `transition` (default 5 m), `settle` (default 0.12 s).

> ⚠️ **It is off unless declared, and it has to be.** Installing `scene.fog` at all
> changes every material's program cache key, so there is no free "disabled" state.
> Absent, nothing subscribes to the frame loop and no shader differs.

> ⚠️ Three's `FogExp2` is `exp(−(d / visibility)²)`, so it saturates
> **quadratically**: ~63% fogged at `visibility` and ~98% at twice it. There is no
> way to bound it short of patching the fog chunk in every shader.

> ⚠️ `settle` is needed at all because a medium's own boundaries ramp smoothly but
> leaving one **sideways** — past the edge of the drawn footprint, or through a
> section plane — has no distance to ramp over. Keep it short: this is a positional
> *cue*, and a slow one reads as a bug.

The block's base is **derived**, not sampled: a carrier floor is deliberately not
sampleable (see [sampling-and-perf.md](./sampling-and-perf.md)).
