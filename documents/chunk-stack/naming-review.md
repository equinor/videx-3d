# Naming and contract review

> **Status: working document (2026-10-16).** Nothing here is decided. It lists the
> developer-facing names of the chunk stack spike, flags where they mislead, and
> proposes alternatives for a naming session. Delete this page once the decisions
> are applied.

- [1. Cross-cutting issues](#1-cross-cutting-issues)
- [2. The core component pair](#2-the-core-component-pair)
- [3. Inventory by area](#3-inventory-by-area)
- [4. Stale references](#4-stale-references--fix-regardless)
- [5. Export surface](#5-export-surface)
- [6. Story args that already use better names](#6-story-args-that-already-use-better-names)
- [7. Suggested agenda](#7-suggested-agenda)

---

## 1. Cross-cutting issues

### 1.1 Two prefix families, no rule

Stack-level declarations are prefixed `Chunk*` (`ChunkSection`, `ChunkFence`,
`ChunkContact`, `ChunkCarrier`, `ChunkWaterTint`) **and** `Stack*` (`StackWater`,
`StackImmersion`). `ChunkCarrier` extends `StackCarrier`. The SDK adds `SurfaceStack*`
and `SurfaceChunk*` for the same family.

### 1.2 Domain clashes

| Name | What it means here | What a geoscientist reads |
|------|--------------------|---------------------------|
| `layer` / `ChunkLayer` | a **boundary** (one surface) | the rock between two boundaries |
| `carrier` | the flat floor closing the column | *carrier bed* — a migration pathway |
| `water.depth` | sea level, positive-down | *water depth* — how deep the sea bed is |
| `immersion.sediment` | inside the block | sediment only, yet the block holds basement, salt, carbonate |
| `immersion` | fog while the camera is inside the sea or the block | see [3.7](#37-immersion--flagged) |

### 1.3 Overloaded words

| Word | Meanings in the current API |
|------|-----------------------------|
| **cut** | outline source (`cutSource`, `CutoutSource`); section/fence cuts (`prepareCuts`, `ChunkCutDepths`); neighbour footprints (`capCuts`, `SurfaceChunkCut`, `SeamCut`) |
| **section** | the plane cut (`ChunkSection`); "any cut may take this unit, fence included" (`ChunkLayer.section`); "return cut channels" (`SurfaceChunkSpec.section`, `StackWaterSpec.section`, `SurfaceChunk.section`, `StackSectionSource`); cut faces also used by fences (`useChunkSection`, `ChunkSectionFace`); seismic sections (`WellboreSeismicSection`) |
| **fill** | the volume below a layer (`ChunkLayer.fill`); hole-fill reach (`maxFill`, `DEFAULT_CHUNK_MAX_FILL`) |
| **offset** | synthetic layer below the one above (`ChunkLayer.offset`); cut-face nudge (`ChunkSection.offset`, `ChunkFence.offset`); polygon `offset: Vec2`; popup pixel offset |
| **tolerance** | vertical window widening (`WellboreCutoutOptions.tolerance`); plan deviation of the fence face (`ChunkFence.tolerance`) |
| **column** | `ChunkStackProps.surfaces` (called "the column" in the docs); context `column` (only the CLAIMED subset); SDK `StratColumn`; `ColumnSpec`; the FieldColumn story |
| **surface** | `SurfaceMeta`; the cap (`surfaceOpacity`, `showSurfaces`); the `<Surface>` component; `SurfaceSampler` (samples the stack, not `<Surface>`) |

### 1.4 Synonym sets — pick one each

- boundary / layer
- interval / unit / volume / zone / group
- cap / surface / top
- phase / step / stage
- outline / cutout / footprint / envelope / polygon
- floor / carrier / base

---

## 2. The core component pair

| Option | Provider | Child | For | Against |
|--------|----------|-------|-----|---------|
| A (keep) | `ChunkStack` | `Chunk` | no churn | "chunk" means nothing in geoscience, and next to tiles, packets and streaming it reads as a voxel/streaming term |
| B | `BlockDiagram` | `Block` / `GeoBlock` | *block diagram* is the geology term for exactly this 3D cutaway; the docs already say "the block", and so does the fence code (`fenceBlockTrace`, `FenceBlockSpan`) | `Block` alone is generic |
| C | `ZoneModel` | `ZoneBlock` | matches modelling-tool vocabulary (a zone lies between two horizons) | "model" suggests a property grid |

**Proposed prefix rule**, whichever pair is chosen: stack-level types take the
provider's prefix (`StackSection`, `StackFence`, `StackFloor`, `StackWater`), chunk-level
types take the child's (`ChunkLayer`, `ChunkPeel`, `ChunkOutline`), and an established
domain name wins over either (`FluidContact`).

---

## 3. Inventory by area

### 3.1 `ChunkLayer`

| Current | Issue | Suggestion |
|---------|-------|------------|
| `layers` / `ChunkLayer` | it is a boundary | `horizons` / `ChunkHorizon`, or `boundaries` / `ChunkBoundary` |
| `material: string` | it is a colour; `Surface` and `SubseaTemplate` use `color`; `LevelledBase.material` takes `string \| Material` | `color` |
| `fill: string \| boolean \| null` | presence and colour in one; clashes with `maxFill` | keep, rename `maxFill`; or `fill: boolean` + `fillColor` |
| `offset` | one of four `offset`s | `below` (mirrors `StackCarrier.below`) or `thickness` |
| `section: boolean` | also governs the fence | `cut?: boolean` or `keepWhole` (the story calls it `sectionKeep`) |
| `detail: ChunkDetail` | presets are lithologies plus `seabed` | fine; type could be `RockDetail` |
| `surface`, `depth`, `relief`, `opacity`, `contacts` | — | — |

### 3.2 `Chunk` props

| Current | Issue | Suggestion |
|---------|-------|------------|
| `surfaceOpacity`, `showSurfaces` vs `cullHiddenCaps` | the docs' word is "cap" | `capOpacity`, `showCaps` |
| `inferredStyle` + `ChunkInferenceStyle` + `createInferenceMaterial` | two stems; values mix adjective and noun (`hatched` vs `checker`) | `inferenceStyle: 'none' \| 'hatch' \| 'checker' \| 'zigzag'` |
| `onBuild(metrics)` (also `LevelledBase`) | reads as "build started"; outline options use `onMetrics` | `onBuilt` or `onMetrics`, one everywhere |
| `onBuildStateChange` vs stack `onProgress` | — | keep, or `onStateChange` |
| `lodLevel`, `lodPixelError`, `debugTiles`, `diagnostics` | `lodLevel` is a forced debug view but reads as config, next to `resolve.lod.levels` | group: `debug={{ tiles, lodLevel }}` |
| `outline: ChunkOutline` vs stack `outline` + `cutSource` | asymmetric | one stack `outline` accepting a polygon or a source |
| `peel: { from, count }` | `resolvePeel` returns `{ top, base }` | possibly `{ top, count }` |

### 3.3 Build options — `resolve: ChunkResolveOptions`

Covers far more than the depth-order resolve: sealing, coverage, grid budget,
tessellation and LOD — while `rimSpacing` and `maxError` sit outside it.

| Current | Suggestion |
|---------|------------|
| `resolve` | `build` / `ChunkBuildOptions`, or split into `resolve`, `seal`, `tessellation` |
| `mode: 'clamp' \| 'truncate'` | `crossings` |
| `collapseThreshold`, `minThickness` (seal), `minGap` | `minUnitThickness`, `sealMinThickness`, `minGap` |
| `coverageAbsence` | `dropUnmapped` |
| `maxFill` / `DEFAULT_CHUNK_MAX_FILL` | `maxExtrapolation` or `holeFillDistance` |
| `maxNodes` | `maxGridNodes` |
| `refineTerminations`, `constrainTerminations` | the progress label says "pinch-outs" — pick one term |
| `maxError` ("grid height units") | `heightTolerance` |
| spacing family: `rimSpacing`, fence `maxSpacing`, outline `sampleSpacing`, `LevelledBase.spacing`, seismic `step` | align where they mean the same thing |

### 3.4 Outline sources

| Current | Issue | Suggestion |
|---------|-------|------------|
| `cutSource`, `CutoutSource`, `PolygonCutoutSource`, `WellboreCutoutSource`, `WellboreCutoutOverride`, `WellboreCutoutOptions` vs `ChunkOutline`, `WellboreOutlineMode`, generator `wellboreOutline`, SDK `WellboreOutlineOptions` | two stems for one concept; "cut" belongs to section/fence | "outline" throughout: `OutlineSource`, `PolygonOutlineSource`, `WellboreOutlineSource`, `WellboreOutlineOverride` |
| `WellboreCutoutOptions.mode: 'window' \| 'above' \| 'below'` | generic `mode` | `span` |
| `WellboreCutoutOptions.tolerance` | vertical, unlike the fence's | `depthTolerance` |
| `ChunkStackProps.outline` | at least two roles: default chunk outline and the sea's footprint | document, or separate |

### 3.5 Floor (`carrier`)

Uses: the `carrier` prop, `ChunkCarrier`, SDK `StackCarrier`, `CARRIER_SEAM_ID = '@carrier'`,
`ChunkSection.carrier`, `ChunkFence.carrier`, `isCarrierSpecLayer`, context
`carrierMaterial` / `carrierDetail`.

**Suggestion:** `floor` / `StackFloor`; `below` → `clearance`; `material` → `color`.
Not `basement`, which is already a `ChunkDetail` preset.

### 3.6 Water

| Current | Issue | Suggestion |
|---------|-------|------------|
| `StackWater.depth` | domain clash ([1.2](#12-domain-clashes)) | `level` or `seaLevel` |
| `ChunkWaterTint` (`bedTint`, `bedTintDepth`, `wetBand`, `wetStrength`) | `Chunk` prefix on a stack type; `Ocean` calls the idea `seaBedWaterTint` | `SeaBedTint`, aligned with `Ocean` |
| `StackWater.opacity` vs `waterOpacity` | a documented ⚠️ trap is a naming smell | keep (matches `Ocean`), or `masterOpacity` |
| `StackWater.resolution` | triangle edge length; `LevelledBase.resolution` too | fine |

### 3.7 Immersion ⚑ (flagged)

**What it is:** fog applied while the CAMERA is inside the sea or inside the block —
a positional cue for a user who has flown into the water or the ground, which also
reaches host geometry.

**Names involved:**

| Name | Kind |
|------|------|
| `ChunkStackProps.immersion: StackImmersion` | prop / type |
| `StackImmersion` fields: `water`, `sediment`, `color`, `visibility`, `background`, `transition`, `settle` | fields |
| `StackImmersionFog` / `StackImmersionFogProps` | component (rendered by the stack, yet exported) |
| `useImmersionFog` / `ImmersionFogOptions` | generic hook |
| `ImmersionMedium` (`color`, `density`, `amount`) | hook input |
| story args `immersion`, `immersionColor`, `immersionVisibility`, `immersionTransition`, `immersionSettle`, `immersionBackground` | Storybook |

**Why it is unintuitive:**

- In UI/UX "immersion" means a feeling of presence (immersive, VR), so it suggests an
  ambience or presentation mode rather than fog.
- It names neither **what** happens (fog) nor **when** (the camera is inside
  something). The docs have to restate it every time: "Fog the view while the camera
  is INSIDE…".
- `sediment` and `color` inherit the vagueness: `color` applies to the block only, and
  the sea's colour comes from the water settings.

**Candidates:**

| Prop / type | For | Against |
|-------------|-----|---------|
| `interiorFog` / `StackInteriorFog` | says what and where | "interior" can read as a building interior |
| `insideFog` / `StackInsideFog` | plainest | informal |
| `cameraInsideFog` | states the trigger exactly | long |
| `submergedFog` / `submersion` | intuitive for water | wrong for rock |
| `mediumFog` | matches the hook's model (`ImmersionMedium`) | "medium" is abstract too |
| `positionCue` / `insideCue` | states the purpose | does not say it is fog |

**Field suggestions** (independent of the prop name): `sediment` → `rock` (or `block`),
`color` → `rockColor`. Hook: `useImmersionFog` → `useMediumFog`, `ImmersionMedium` →
`FogMedium`, and move it to `hooks/` — nothing in it is chunk-specific. Stop exporting
`StackImmersionFog`.

### 3.8 Section and fence

| Current | Issue | Suggestion |
|---------|-------|------------|
| `ChunkSection` `plane` / `cameraDistance` / `lockToTarget` | the mode is implied by precedence; the story already has `sectionMode: 'fixed' \| 'camera' \| 'target'` | explicit `anchor: 'plane' \| 'camera' \| 'target'` |
| `ChunkSectionState`, `ChunkSectionFace`, `useChunkSection` | also used for fence faces | `CutFace`, `useCutFaces` |
| `ChunkFence.side` | names the half **removed**, while `FenceSideInfo.side` is documented as "the side shown, i.e. the half removed", and `onFenceSide` reports "the SHOWN side" | `removedSide` (or `open`) |
| `ChunkFence.margin` | it is the clearance around the trajectory | `clearance` |
| `rodStiffness` | exposes the algorithm | `stiffness` |
| `headBearing: 'opposite-td' \| 'free'`, `headMinTdAngle` | jargon (fine for well specialists) | `headArm: 'opposite' \| 'free'`, `headArmMinAngle` |
| `scope: 'stack' \| 'touched'` | "touched" is vague | `reach: 'all' \| 'intersected'` |
| `ChunkFenceOverlay`, `FenceOverlayTexture { values, along, y }`, `FenceSideInfo { verticalRange }`, `ChunkFenceOverlayShading` | mixed prefixes; terse fields | `FenceOverlay`; `alongRange`, `yRange` |
| `ChunkFence` vs SDK `WellboreFence` | options vs built result | `StackFence` for the options |
| `section.carrier`, `fence.carrier` | see [3.5](#35-floor-carrier) | `floor` |

### 3.9 Contacts

`ChunkContact`, `ChunkContactType`, `CHUNK_CONTACT_TYPES`, `CHUNK_CONTACT_COLORS`,
`DEFAULT_CONTACT_MAX_WIDTH`, `ChunkContactTexture` — all declared on the stack, and
the domain has a name: **`FluidContact`**, `FLUID_CONTACT_TYPES`. Fields are fine.

### 3.10 Progress (17 public names)

- State has three vocabularies: `ChunkBuildState` (`building` / `ready` / `empty` /
  `failed`), `ChunkProgressOutcome`, and the `states.preparing` label.
- phase / step / stage: `ChunkBuildProgress.phase`, `ChunkProgressEntry.step`,
  `ChunkProgressRow.stage`, `ChunkProgressDetails.stage`, `formatChunkStep`, the
  `phases` labels, SDK `SurfaceChunkPhase`. Pick `phase`.
- Overlapping per-chunk shapes: `Entry`, `Row`, `View`, `Snapshot`; `Entry` and
  `ChunkProgressInput` could be internal.
- Three measures: `fraction`, `estimate`, `percent` — fine, but document side by side.
- It reports a STACK, so `StackProgress*` may fit better.

### 3.11 Sampling and placement

| Current | Issue | Suggestion |
|---------|-------|------------|
| `SurfaceSampler`, `useSurfaceSampler`, `SurfaceSamplerContext`, `SurfaceSamplerRegistry(Context)`, `SurfaceSamplerEntry`, `createSurfaceSampler`, `sampleSurfaceFootprint`, `useSurfacePlacement` | samples the stack's drawn caps, NOT `<Surface>` — which a `<Surface>` user would expect | `StackSampler` / `useStackSampler` (or `GroundSampler`) |
| `solidAt` | returns metres inside the block | `depthInsideAt` |
| `LevelledBase` | British spelling (the library otherwise uses `color`); its `surface` is an id string while `ChunkLayer.surface` is `SurfaceMeta` | `LeveledBase` or a domain name (`SeabedFoundation`); `surface` → `surfaceId` |

### 3.12 Generator keys and constants

- Keys `surfaceChunk`, `wellboreOutline`, `stackWater`, `stackRelease`,
  `generatorStatsKey`: only the last has a `Key` suffix; `stackRelease` is a command.
- `TAPER_MIN_THICKNESS` is `minThickness`'s default without the `DEFAULT_` prefix;
  `DEFAULT_PALETTE` has no family prefix.

### 3.13 SDK

- `SurfaceChunkLayerSpec` and `SurfaceChunkSpecLayer` are DIFFERENT types whose names
  differ only in word order.
- `ChunkSurfaceLayer` lives in the SDK's wellbore outline code.
- The generator cache's `StackContext` sits beside React's `ChunkStackContext`.

---

## 4. Stale references — fix regardless

- `ChunkStack.tsx`: the `surfaces` doc and the component example still use a `groups`
  prop that no longer exists.
- `ChunkMeshes.tsx`: three comments describe a caller-supplied `Material`;
  `ChunkLayer.material` is `string` only.
- `chunk-defs.ts`: `DEFAULT_FENCE_CELL_SIZE` documents `ChunkFence.cellSize`, which
  does not exist, and nothing uses the constant.
- `layersFromGroups` is the last trace of the "groups" model; `layersFromZones` would
  match the current docs.

---

## 5. Export surface

`src/components/Chunks/index.ts` re-exports internals that would otherwise become
contract:

- `ChunkMeshes`, `ChunkSectionDebug`, `StackImmersionFog`, `useChunkSection`
- `ChunkStackContextValue` and the registry types `ChunkMarginEntry`,
  `ChunkOutlineEntry`, `ChunkSurfaceClaim`, `ChunkOutlineRegistry`, `ChunkSeamRegistry`
- shader helpers `ChunkMaterial`, `createFenceUniforms`, `applyFenceSide`,
  `createTileUniforms`, `bindChunkNormalMap`, `createInferenceMaterial`
- worker spec types `SurfaceChunkSpec*`
- `CARRIER_SEAM_ID`, `isCarrierSpecLayer`, `aggregateChunkProgress`, `UtmToScene`

---

## 6. Story args that already use better names

The FieldColumn story's controls are evidence of what reads naturally:

| Story arg | Library name |
|-----------|--------------|
| `floor`, `floorClearance`, `floorColor` | `carrier`, `carrier.below`, `carrier.material` |
| `seaLevel` | `water.depth` |
| `sectionKeep` | `ChunkLayer.section: false` |
| `sectionMode: 'fixed' \| 'camera' \| 'target'` | implied by `plane` / `cameraDistance` / `lockToTarget` |
| `lodLevels` | `resolve.lod.levels` |

---

## 7. Suggested agenda

1. Family name and prefix rule ([2](#2-the-core-component-pair)) — everything else follows.
2. Domain clashes: `layer`, `carrier`, `water.depth`, `sediment`, `immersion`.
3. One meaning each for "cut" and "section"; one word for interval/unit.
4. Restructure `resolve` and the debug props.
5. Trim the export surface.
6. Leaf renames (`material` → `color`, `margin` → `clearance`, `rodStiffness`, …).
