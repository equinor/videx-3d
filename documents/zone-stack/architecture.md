# Architecture

The component tree, what each context carries, and the rule that decides whether a
change repaints or rebuilds.

- [The three reactive layers](#the-three-reactive-layers)
- [Component tree](#component-tree)
- [What ZoneStack provides](#what-zonestack-provides)
- [Stable identities and content keys](#stable-identities-and-content-keys)
- [What rebuilds what](#what-rebuilds-what)
- [Ownership and disposal](#ownership-and-disposal)

---

## The three reactive layers

This is the load-bearing decision of the whole feature. Three concerns are kept
strictly apart so that cheap changes stay cheap:

```mermaid
flowchart TD
  L1["<b>1. BOUNDARY</b><br/>which footprint to clip to<br/><i>polygon, or resolved from wellbores</i>"]
  L2["<b>2. GEOMETRY</b><br/>the shared tessellation, caps, walls, cut channels<br/><i>worker-backed, expensive</i>"]
  L3["<b>3. APPEARANCE</b><br/>materials, opacity, detail, wireframe, peel, marking<br/><i>reactive, never rebuilds geometry</i>"]
  L1 --> L2 --> L3
```

| Layer | Lives in | Changes when | Cost |
|-------|----------|--------------|------|
| 1. Boundary | `Zone` (`source`, `wellboreOutline`) | the boundary prop, the cut source, the wellbore data, or the depth window changes | one async resolve; for a wellbore source a `wellboreOutline` generator call |
| 2. Geometry | the `surfaceZone` generator, in a worker | surfaces, fills, boundary, `resolve`, `rimSpacing`, `maxError`, seams, `prepareCuts`, or (with `prepareCuts` off) the *presence* of a section/fence/peel changes | seconds at field scale |
| 3. Appearance | `ZoneMeshes` | materials, colours, opacity, `detail`, `wireframe`, `peel` value, `inferredStyle`, contacts, water tint | material rebuild only |

The consequences show up all over the API and are worth stating explicitly:

- **Materials never reach the build spec.** `buildSurfaceZoneSpec` deliberately
  drops `material`, `fill`'s colour, `detail` and `opacity`. Colour used to be a
  build parameter baked into geometry, and recolouring rebuilt the block.
- **Toggles are free, presence may not be.** `section.enabled`, `fence.enabled` and
  the *value* of `peel` are appearance. The payload they need (cut channels, peel
  indices) is built up front by default (`ZoneStackProps.prepareCuts`), so a
  section, fence or peel can also come and go without a rebuild. With `prepareCuts`
  off, their **presence** asks the build for that payload, and adding or removing
  the prop *does* rebuild. Zones read it as the primitive `stack.prepareCuts`,
  never as the section/fence state objects, which come and go with the cut.
- **Anything driven per frame bypasses React entirely.** The section plane, the
  fence field and the sea's uniforms are shared mutable objects written once per
  frame from `useFrame`. Moving a section plane costs no render and no material
  rebuild.

---

## Component tree

```mermaid
flowchart TD
  UA["&lt;UtmArea&gt;"] --> CS["&lt;ZoneStack&gt;"]
  CS -.provides.-> CTX["ZoneStackContext<br/>SurfaceSamplerContext + Registry<br/>OceanSamplerContext<br/>OceanContactContext"]
  CS --> FOG["&lt;StackImmersionFog&gt;<br/><i>only if immersion declared</i>"]
  CS --> SEA["sea lid + body + cut face<br/><i>only if water declared</i>"]
  CS --> DBG["&lt;ZoneSectionDebug&gt;<br/><i>only if section.debug</i>"]
  CS --> CH1["&lt;Zone&gt;"]
  CS --> CH2["&lt;Zone&gt;"]
  CS --> HOST["host children<br/><i>vessels, facilities, wellbores…</i>"]
  CH1 --> CM["&lt;ZoneMeshes&gt;<br/>caps · walls · cut faces · overlays"]
  CH1 --> KIDS["zone children<br/><i>outside the pick group</i>"]
```

Everything renders inside one identity-transform `<group ref={stackFrame}>`. It
exists so that anything driven from the **camera** — the locked section plane, the
immersion test, the fence's auto side — has a frame to be brought into. It is the
one place where world space and the stack's own space differ, because a stack may
carry a vertical exaggeration (`scale={[1, k, 1]}`).

### Responsibilities

**`ZoneStack`** owns everything that cannot belong to one zone:

- the column and its envelope
- the carrier plane
- the sea (a lid covers its whole footprint by design, so two zones each drawing
  part of it would leave two coplanar lids wherever their footprints overlap)
- the cut — one plane or one fence for the whole block
- the registries: which zone claims which surface, which zone draws a shared
  horizon, each zone's build state and wellbore margin
- release of the cached column on unmount

**`Zone`** owns one block:

- resolving its boundary (layer 1)
- assembling a serialisable spec and driving the generator (layer 2)
- registering claims, publishing its boundary, reading back seams
- disposing the geometry it built, and registering it for sampling
- pointer events over its own meshes

**`ZoneMeshes`** owns nothing but materials:

- resolves each layer's cap/fill/ceiling/carrier/face material
- builds the inference overlays
- builds the cut faces per frame from the zone's channels
- lays out the meshes, tagging each with `userData.layer` and `userData.kind`

---

## What ZoneStack provides

`ZoneStackContextValue` (`ZoneContext.ts`) carries three quite different kinds of
thing, and the distinction is deliberate:

### Build inputs — changing these rebuilds zones

`boundary`, `cutSource`, `surfaces`, `column`, `envelope`, `carrier`, `resolve`,
`rimSpacing`, `maxError`, `boundaries`, `seams`, `margins`.

### Appearance — reaches `ZoneMeshes` without joining a spec

`carrierMaterial`, `contacts`, `water`, `bathymetry`.

`carrierMaterial` is published **separately** from `carrier` for exactly this
reason: the carrier's identity is keyed on *where the plane is*, so recolouring the
floor cannot rebuild the geometry.

### Live, per-frame state — read outside React

`section` (`ZoneSectionState`), `sectionUniform`, `sectionUniformInverse`,
`sectionCarrier`, `fence` (`ZoneFenceState`), `fenceUniforms`,
`fenceUniformsInverse`, `fenceCarrier`.

`ZoneSectionState` and `ZoneFenceState` are **stable objects the stack mutates**.
The caller naturally writes `section={{ plane, enabled }}`, which is a new object
every render, and this context's identity is what every zone's build spec derives
from — so publishing the prop itself would rebuild every zone on any parent
render. Nothing in them is read during React rendering.

> ⭐ `sectionUniform` is one `IUniform<Vector4>` handed to **every** material of
> every zone, the sea and the overlays. A `ShaderMaterial`'s OIT variants share
> their `uniforms` object by reference, so a single write per frame reaches every
> material in all four OIT passes.
>
> `sectionUniformInverse` is its exact complement, for geometry that must appear
> *only* where the section took something away (the peel patch — see
> [cutting-and-water.md](./cutting-and-water.md#restoring-what-the-collapse-dropped)).
> Negating the disabled value `(0,0,0,-1)` yields `(0,0,0,1)`, which draws nothing
> — exactly right when nothing has been cut away.

### Callbacks

`registerZone`, `releaseZone`, `publishBoundary`, `publishMargin`,
`reportBuildState`. See [coordination.md](./coordination.md).

### The two sampler contexts

Deliberately **separate** from `ZoneStackContext`:

| Context | Direction | Why separate |
|---------|-----------|--------------|
| `SurfaceSamplerRegistryContext` | zones **publish** their built geometry | a sibling finishing its geometry must not disturb the value every zone's build spec is derived from |
| `SurfaceSamplerContext` | consumers **read** the sampler | a new identity is the signal to re-sample |

`OceanSamplerContext` and `OceanContactContext` are provided too, so a floating
child heaves with the swell and spreads foam exactly as it would inside an
`<Ocean>` — with nothing extra wired.

---

## Stable identities and content keys

`layers={[...]}` is the natural JSX idiom and makes a **new array every render**.
The build must not key on that identity. Every such input is therefore reduced to a
**content key** and re-memoised:

```ts
// Zone.tsx — the BUILD key: surfaces and which intervals are filled
type ZoneLayerKeyRole = {
  build?: (l: ZoneLayer) => string;       // keys the GEOMETRY (rebuilds the zone)
  appearance?: (l: ZoneLayer) => string;  // keys the MATERIALS (re-runs ZoneMeshes)
};

// One role per ZoneLayer field, in ONE place. `fill` has both: its presence is
// geometry, its colour is appearance. `relief` is serialised whole (a union of
// shapes; a field-by-field list goes stale the moment the union grows).
const ZONE_LAYER_KEY = {
  surface: { build: l => l.surface?.id ?? '' },
  depth: { build: l => `${l.depth ?? ''}` },
  offset: { build: l => `${l.offset ?? ''}` },
  relief: { build: l => (l.relief ? JSON.stringify(l.relief) : '') },
  fill: { build: l => (zoneLayerFill(l) ? '1' : '0'), appearance: l => appearanceId(l.fill) },
  material: { appearance: l => appearanceId(l.material) },
  detail: { appearance: l => zoneDetailKey(l.detail) },
  opacity: { appearance: l => `${l.opacity ?? ''}` },
  section: { appearance: l => (l.section === false ? '0' : '1') },
  contacts: { appearance: l => (l.contacts === false ? 'none' : (l.contacts?.join('+') ?? '')) },
} satisfies Record<keyof ZoneLayer, ZoneLayerKeyRole>;

const layersKey = zoneLayersBuildKey(layers);          // → stableLayers
const appearanceKey = zoneLayersAppearanceKey(layers); // → appearanceLayers
```

> ⭐ **The keys are DERIVED from one classification.** `satisfies Record<keyof
> ZoneLayer, …>` makes TypeScript error the moment a field is added without a
> `build` / `appearance` role — so "forget to key it" becomes a **compile** error
> rather than the silent runtime bug it shipped as twice (most recently `contacts`,
> which was in neither key). Forget a build role and toggling the field does
> nothing; forget an appearance role and its value freezes at the last build.

The same idiom appears on `ZoneStack` for `carrier`, `water`, `resolve` and
`contacts`. Two of them are worth calling out:

- **`water` has two keys.** `waterKey` (the whole object) drives the *materials*;
  `waterBuildKey` (`depth` / `resolution` / `displacement` only) drives the
  *geometry spec*. Everything else on `StackWater` is sea state, and keying the
  spec on the whole object made every wind/foam/opacity tick rebuild the lid in the
  worker.
- **`contacts` keys the surface by `id` only.** A grid cannot change under a stable
  id.

`resolve` deserves a note of its own: those options **are** part of the shared
column's cache key. The cache keeps four columns, least recently used evicted
(`MAX_CACHED_COLUMNS`), so a zone (or the sea) asking with a different identity
builds a whole column of its own and can push out one still in use. Declare
`resolve` on the **stack**, memoised, and let zones inherit it.

---

## What rebuilds what

| Change | Boundary | Geometry | Materials | Per-frame only |
|--------|:-------:|:--------:|:---------:|:--------------:|
| `layers` array identity, same content | — | — | — | — |
| add/remove a surface, or flip a `fill` | — | ● | ● | — |
| `material` / `fill` colour / `opacity` / `detail` | — | — | ● | — |
| `wireframe`, `showSurfaces`, `showWalls` | — | — | ●¹ | — |
| `peel` **value** | — | — | — | ● |
| `peel` **prop added or removed** | — | ●⁵ | ● | — |
| `inferredStyle` | — | — | overlays only | — |
| `boundary` / `cutSource` / wellbore options | ● | ● | ● | — |
| `resolve` object identity | — | ● (whole column) | ● | — |
| `section.plane` mutated, `section.enabled` | — | — | — | ● |
| `section` prop added or removed | — | ●⁵ | ● | — |
| `fence.wellbore`, `fence.side` | — | — | —² | ● |
| `fence` prop added or removed | — | ●⁵ | ● | — |
| `ZoneStack.prepareCuts` | — | ● (and the sea) | ● | — |
| `fence.debug` | — | — | ● | — |
| `ZoneStack.contacts` | — | — | ● | — |
| `ZoneStack.water` sea state | — | — | ●³ | — |
| `ZoneStack.drawWater` | — | — | — | ● |
| `ZoneStack.relief` (its `key`) | — | ● (whole column, and the sea) | ● | — |
| `ZoneStack.clip` (a clip coming, going or changing) | — | — | — | ● |
| `ZoneStack.water.depth` / `.resolution` / `.displacement` | — | sea only | ● | — |
| a sibling zone's boundary settling | — | ●⁴ | ● | — |

¹ `wireframe` is a material property here, so it rebuilds materials, not geometry.
² a `side` flip swaps a texture and a curve; both sides are built up front.
³ ocean uniforms are updated per frame; the *materials* are keyed on `waterKey`.
⁴ only if it changes a seam decision this zone takes part in.
⁵ only with `ZoneStack.prepareCuts` off; by default the payload is built up front.

### React-specific notes

- **A rebuilt zone forces one extra render.** React double-buffers its fibers, and
  the `alternate` retains the previous render's hook state — here an entire
  replaced zone, hundreds of MB, disposed and unreachable but pinned for the life
  of the component. `Zone` bumps a dummy state after a build lands so the
  alternate holds the *current* zone instead. Nothing is rebuilt: geometry and
  materials are memoised.
- **The inference overlay builders are module-scope functions.** V8 gives a
  function scope one `Context` holding every variable captured by any closure
  inside it, so closures defined in the component body pinned that render's whole
  `zone` until the appearance happened to change. Passing the inputs as arguments
  keeps the captured scope to exactly those parameters.
- **Frame callbacks go through `useReleasedFrame`.** R3F's store keeps its
  *initial* state, whose `internal.subscribers` array is the live one until the
  first unsubscribe and is never touched again after. A `useFrame` callback
  registered before then stays referenced for the life of the canvas, and its
  scope with it: in `ZoneMeshes` that was a whole replaced zone (~500 MB on a
  34-layer field), in production builds too. The hook hands R3F a relay that
  closes over a holder only, and empties the holder on unmount.

---

## Ownership and disposal

| Thing | Created by | Disposed by |
|-------|-----------|-------------|
| zone geometries (caps, walls) | the generator, unpacked in `Zone` | `Zone`, in a `[zone]` cleanup effect |
| patch geometries (peel/section) | `ZoneMeshes` | `ZoneMeshes` — ⚠️ they share the cap's attribute buffers |
| cut-face geometries | `useZoneSection` / `useZoneFenceFace` | the same hooks |
| zone materials (caps, walls, faces) | `ZoneMeshes` | `ZoneMeshes` (`materials.owned`) |
| inference overlays | `ZoneMeshes` | `ZoneMeshes` (`overlays.built`) |
| sea lid / body geometry | `ZoneStack` | `ZoneStack` |
| ocean materials | `useStackWater` | `useStackWater` |
| contact textures | `useZoneContacts` | the same hook |
| bathymetry texture (the bed tint) | `ZoneStack`, from the `stackWater` response | `ZoneStack`, when the bed changes or on unmount |
| **the cached column** | the generator scope | `releaseStackResources`, called by `ZoneStack` on unmount |

Two traps worth remembering:

> ⚠️ **The shared buffers.** `buildStackGeometries` shares one `xz`
> `BufferAttribute` (the plan positions) AND one index `BufferAttribute` across the
> layers — duplicating either would cost more than all the per-layer height data.
> So a stack's layers must be disposed **together**, and the worker transfer list
> must be deduped (`packSurfaceZone` returns the same `ArrayBuffer` several times).

> ⚠️ **Never attach the same property by two mechanisms.** Walls always use the
> `material` **prop** (single or array), never a `<primitive attach="material">`
> child. React reuses a `<mesh>` of the same type and key across a branch switch, so
> removing the prop makes R3F reset it to a fresh `Mesh`'s default — a white
> `MeshBasicMaterial`, which OIT then faithfully draws as opaque white. Caps use the
> keyed `<primitive attach>` form, which has no array case.

The column is by far the largest allocation the library makes — one `Float32Array`
channel per layer over the whole reference grid, plus masks, truncation masks and
seal weights. It is keyed to the *column*, not to a component, so nothing collects
it until it is released. `SurfaceZoneDiagnostics.columnBytes` reports it, and
`zoneResourceStats()` reports what the built zones hold.
