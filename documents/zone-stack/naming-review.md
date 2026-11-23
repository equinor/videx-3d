# Naming and contract review

> **Status: working document (2026-10-16).** It lists the developer-facing names of
> the zone stack spike, flags where they mislead, and proposes alternatives for a
> naming session. Delete this page once the decisions are applied.
>
> **Decided and applied (2026-11-23):** `Chunk` → `Zone` throughout
> ([2](#2-the-core-component-pair)); a zone's footprint is its **boundary**
> (`ZoneBoundary`, the `boundary` prop — [3.4](#34-boundary-sources)); a layer, called a
> "boundary" before, is a **horizon** in the docs; and the fence's stiff rod is the
> **batten**, its `rodStiffness` now `ZoneFence.stiffness` ([3.8](#38-section-and-fence)).
> Everything else is open.

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

Stack-level declarations are prefixed `Zone*` (`ZoneSection`, `ZoneFence`,
`ZoneContact`, `ZoneCarrier`, `ZoneWaterTint`) **and** `Stack*` (`StackWater`,
`StackImmersion`). `ZoneCarrier` extends `StackCarrier`. The SDK adds `SurfaceStack*`
and `SurfaceZone*` for the same family.

### 1.2 Domain clashes

| Name | What it means here | What a geoscientist reads |
|------|--------------------|---------------------------|
| `layer` / `ZoneLayer` | a **horizon** (one surface) | the rock between two horizons |
| `carrier` | the flat floor closing the column | *carrier bed* — a migration pathway |
| `water.depth` | sea level, positive-down | *water depth* — how deep the sea bed is |
| `immersion.sediment` | inside the block | sediment only, yet the block holds basement, salt, carbonate |
| `immersion` | fog while the camera is inside the sea or the block | see [3.7](#37-immersion--flagged) |

### 1.3 Overloaded words

| Word | Meanings in the current API |
|------|-----------------------------|
| **cut** | boundary source (`cutSource`, `CutoutSource`); section/fence cuts (`prepareCuts`, `ZoneCutDepths`); neighbour footprints (`capCuts`, `SurfaceZoneCut`, `SeamCut`) |
| **section** | the plane cut (`ZoneSection`); "any cut may take this unit, fence included" (`ZoneLayer.section`); "return cut channels" (`SurfaceZoneSpec.section`, `StackWaterSpec.section`, `SurfaceZone.section`, `StackSectionSource`); cut faces also used by fences (`useZoneSection`, `ZoneSectionFace`); seismic sections (`WellboreSeismicSection`) |
| **fill** | the volume below a layer (`ZoneLayer.fill`); hole-fill reach (`maxFill`, `DEFAULT_ZONE_MAX_FILL`) |
| **offset** | synthetic layer below the one above (`ZoneLayer.offset`); cut-face nudge (`ZoneSection.offset`, `ZoneFence.offset`); polygon `offset: Vec2`; popup pixel offset |
| **tolerance** | vertical window widening (`WellboreCutoutOptions.tolerance`); plan deviation of the fence face (`ZoneFence.tolerance`) |
| **column** | `ZoneStackProps.surfaces` (called "the column" in the docs); context `column` (only the CLAIMED subset); SDK `StratColumn`; `ColumnSpec`; the FieldColumn story |
| **surface** | `SurfaceMeta`; the cap (`surfaceOpacity`, `showSurfaces`); the `<Surface>` component; `SurfaceSampler` (samples the stack, not `<Surface>`) |

### 1.4 Synonym sets — pick one each

- horizon / layer — the docs say **horizon** (decided); `layers` / `ZoneLayer` are open
- interval / unit / volume / group
- cap / surface / top
- phase / step / stage
- boundary / outline / cutout / footprint / envelope / polygon — a zone's footprint is
  its **boundary** (decided); the cutout family and the wellbore outline are open
- floor / carrier / base

---

## 2. The core component pair

**Decided (2026-11-23): `ZoneStack` / `Zone`.** The options weighed:

| Option | Provider | Child | For | Against |
|--------|----------|-------|-----|---------|
| A (was) | `ChunkStack` | `Chunk` | no churn | "chunk" means nothing in geoscience, and next to tiles, packets and streaming it reads as a voxel/streaming term |
| B | `BlockDiagram` | `Block` / `GeoBlock` | *block diagram* is the geology term for exactly this 3D cutaway; the docs already say "the block", and so does the fence code (`fenceBlockTrace`, `FenceBlockSpan`) | `Block` alone is generic |
| C | `ZoneModel` | `ZoneBlock` | matches modelling-tool vocabulary (a zone lies between two horizons) | "model" suggests a property grid |
| **D (chosen)** | `ZoneStack` | `Zone` | a zone lies between two horizons, as in the modelling tools | — |

**Proposed prefix rule** (open): stack-level types take the provider's prefix
(`StackSection`, `StackFence`, `StackFloor`, `StackWater`), zone-level types take the
child's (`ZoneLayer`, `ZonePeel`, `ZoneBoundary`), and an established domain name wins
over either (`FluidContact`).

---

## 3. Inventory by area

### 3.1 `ZoneLayer`

| Current | Issue | Suggestion |
|---------|-------|------------|
| `layers` / `ZoneLayer` | it is a horizon (the docs' word since 2026-11-23) | `horizons` / `ZoneHorizon` — `ZoneBoundary` is the footprint now |
| `material: string` | it is a colour; `Surface` and `SubseaTemplate` use `color`; `LevelledBase.material` takes `string \| Material` | `color` |
| `fill: string \| boolean \| null` | presence and colour in one; clashes with `maxFill` | keep, rename `maxFill`; or `fill: boolean` + `fillColor` |
| `offset` | one of four `offset`s | `below` (mirrors `StackCarrier.below`) or `thickness` |
| `section: boolean` | also governs the fence | `cut?: boolean` or `keepWhole` (the story calls it `sectionKeep`) |
| `detail: ZoneDetail` | presets are lithologies plus `seabed` | fine; type could be `RockDetail` |
| `surface`, `depth`, `relief`, `opacity`, `contacts` | — | — |

### 3.2 `Zone` props

| Current | Issue | Suggestion |
|---------|-------|------------|
| `surfaceOpacity`, `showSurfaces` vs `cullHiddenCaps` | the docs' word is "cap" | `capOpacity`, `showCaps` |
| `inferredStyle` + `ZoneInferenceStyle` + `createInferenceMaterial` | two stems; values mix adjective and noun (`hatched` vs `checker`) | `inferenceStyle: 'none' \| 'hatch' \| 'checker' \| 'zigzag'` |
| `onBuild(metrics)` (also `LevelledBase`) | reads as "build started"; outline options use `onMetrics` | `onBuilt` or `onMetrics`, one everywhere |
| `onBuildStateChange` vs stack `onProgress` | — | keep, or `onStateChange` |
| `lodLevel`, `lodPixelError`, `debugTiles`, `diagnostics` | `lodLevel` is a forced debug view but reads as config, next to `resolve.lod.levels` | group: `debug={{ tiles, lodLevel }}` |
| `boundary: ZoneBoundary` vs stack `boundary` + `cutSource` | asymmetric | one stack `boundary` accepting a polygon or a source |
| `peel: { from, count }` | `resolvePeel` returns `{ top, base }` | possibly `{ top, count }` |

### 3.3 Build options — `resolve: ZoneResolveOptions`

Covers far more than the depth-order resolve: sealing, coverage, grid budget,
tessellation and LOD — while `rimSpacing` and `maxError` sit outside it.

| Current | Suggestion |
|---------|------------|
| `resolve` | `build` / `ZoneBuildOptions`, or split into `resolve`, `seal`, `tessellation` |
| `mode: 'clamp' \| 'truncate'` | `crossings` |
| `collapseThreshold`, `minThickness` (seal), `minGap` | `minUnitThickness`, `sealMinThickness`, `minGap` |
| `coverageAbsence` | `dropUnmapped` |
| `maxFill` / `DEFAULT_ZONE_MAX_FILL` | `maxExtrapolation` or `holeFillDistance` |
| `maxNodes` | `maxGridNodes` |
| `refineTerminations`, `constrainTerminations` | the progress label says "pinch-outs" — pick one term |
| `maxError` ("grid height units") | `heightTolerance` |
| spacing family: `rimSpacing`, fence `maxSpacing`, outline `sampleSpacing`, `LevelledBase.spacing`, seismic `step` | align where they mean the same thing |

### 3.4 Boundary sources

A zone's footprint is its **boundary** (decided 2026-11-23: `ZoneBoundary`, the
`boundary` prop on `Zone` and `ZoneStack`). Its sources are still open:

| Current | Issue | Suggestion |
|---------|-------|------------|
| `cutSource`, `CutoutSource`, `PolygonCutoutSource`, `WellboreCutoutSource`, `WellboreCutoutOverride`, `WellboreCutoutOptions` vs `ZoneBoundary`, `WellboreOutlineMode`, generator `wellboreOutline`, SDK `WellboreOutlineOptions` | three stems for one concept; "cut" belongs to section/fence | "boundary" throughout: `BoundarySource`, `PolygonBoundarySource`, `WellboreBoundarySource`, `WellboreBoundaryOverride` |
| `WellboreCutoutOptions.mode: 'window' \| 'above' \| 'below'` | generic `mode` | `span` |
| `WellboreCutoutOptions.tolerance` | vertical, unlike the fence's | `depthTolerance` |
| `ZoneStackProps.boundary` | at least two roles: default zone boundary and the sea's footprint | document, or separate |

### 3.5 Floor (`carrier`)

Uses: the `carrier` prop, `ZoneCarrier`, SDK `StackCarrier`, `CARRIER_SEAM_ID = '@carrier'`,
`ZoneSection.carrier`, `ZoneFence.carrier`, `isCarrierSpecLayer`, context
`carrierMaterial` / `carrierDetail`.

**Suggestion:** `floor` / `StackFloor`; `below` → `clearance`; `material` → `color`.
Not `basement`, which is already a `ZoneDetail` preset.

### 3.6 Water

| Current | Issue | Suggestion |
|---------|-------|------------|
| `StackWater.depth` | domain clash ([1.2](#12-domain-clashes)) | `level` or `seaLevel` |
| `ZoneWaterTint` (`bedTint`, `bedTintDepth`, `wetBand`, `wetStrength`) | `Zone` prefix on a stack type; `Ocean` calls the idea `seaBedWaterTint` | `SeaBedTint`, aligned with `Ocean` |
| `StackWater.opacity` vs `waterOpacity` | a documented ⚠️ trap is a naming smell | keep (matches `Ocean`), or `masterOpacity` |
| `StackWater.resolution` | triangle edge length; `LevelledBase.resolution` too | fine |

### 3.7 Immersion ⚑ (flagged)

**What it is:** fog applied while the CAMERA is inside the sea or inside the block —
a positional cue for a user who has flown into the water or the ground, which also
reaches host geometry.

**Names involved:**

| Name | Kind |
|------|------|
| `ZoneStackProps.immersion: StackImmersion` | prop / type |
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
`FogMedium`, and move it to `hooks/` — nothing in it is zone-specific. Stop exporting
`StackImmersionFog`.

### 3.8 Section and fence

| Current | Issue | Suggestion |
|---------|-------|------------|
| `ZoneSection` `plane` / `cameraDistance` / `lockToTarget` | the mode is implied by precedence; the story already has `sectionMode: 'fixed' \| 'camera' \| 'target'` | explicit `anchor: 'plane' \| 'camera' \| 'target'` |
| `ZoneSectionState`, `ZoneSectionFace`, `useZoneSection` | also used for fence faces | `CutFace`, `useCutFaces` |
| `ZoneFence.side` | names the half **removed**, while `FenceSideInfo.side` is documented as "the side shown, i.e. the half removed", and `onFenceSide` reports "the SHOWN side" | `removedSide` (or `open`) |
| `ZoneFence.margin` | it is the clearance around the trajectory | `clearance` |
| ~~`rodStiffness`~~ | exposes the algorithm | **decided (2026-11-23):** `ZoneFence.stiffness`; the stiff rod itself is now the **batten** (`seedBatten`, `battenStiffness` in the SDK) |
| `headBearing: 'opposite-td' \| 'free'`, `headMinTdAngle` | jargon (fine for well specialists) | `headArm: 'opposite' \| 'free'`, `headArmMinAngle` |
| `scope: 'stack' \| 'touched'` | "touched" is vague | `reach: 'all' \| 'intersected'` |
| `ZoneFenceOverlay`, `FenceOverlayTexture { values, along, y }`, `FenceSideInfo { verticalRange }`, `ZoneFenceOverlayShading` | mixed prefixes; terse fields | `FenceOverlay`; `alongRange`, `yRange` |
| `ZoneFence` vs SDK `WellboreFence` | options vs built result | `StackFence` for the options |
| `section.carrier`, `fence.carrier` | see [3.5](#35-floor-carrier) | `floor` |

### 3.9 Contacts

`ZoneContact`, `ZoneContactType`, `ZONE_CONTACT_TYPES`, `ZONE_CONTACT_COLORS`,
`DEFAULT_CONTACT_MAX_WIDTH`, `ZoneContactTexture` — all declared on the stack, and
the domain has a name: **`FluidContact`**, `FLUID_CONTACT_TYPES`. Fields are fine.

### 3.10 Progress (17 public names)

- State has three vocabularies: `ZoneBuildState` (`building` / `ready` / `empty` /
  `failed`), `ZoneProgressOutcome`, and the `states.preparing` label.
- phase / step / stage: `ZoneBuildProgress.phase`, `ZoneProgressEntry.step`,
  `ZoneProgressRow.stage`, `ZoneProgressDetails.stage`, `formatZoneStep`, the
  `phases` labels, SDK `SurfaceZonePhase`. Pick `phase`.
- Overlapping per-zone shapes: `Entry`, `Row`, `View`, `Snapshot`; `Entry` and
  `ZoneProgressInput` could be internal.
- Three measures: `fraction`, `estimate`, `percent` — fine, but document side by side.
- It reports a STACK, so `StackProgress*` may fit better.

### 3.11 Sampling and placement

| Current | Issue | Suggestion |
|---------|-------|------------|
| `SurfaceSampler`, `useSurfaceSampler`, `SurfaceSamplerContext`, `SurfaceSamplerRegistry(Context)`, `SurfaceSamplerEntry`, `createSurfaceSampler`, `sampleSurfaceFootprint`, `useSurfacePlacement` | samples the stack's drawn caps, NOT `<Surface>` — which a `<Surface>` user would expect | `StackSampler` / `useStackSampler` (or `GroundSampler`) |
| `solidAt` | returns metres inside the block | `depthInsideAt` |
| `LevelledBase` | British spelling (the library otherwise uses `color`); its `surface` is an id string while `ZoneLayer.surface` is `SurfaceMeta` | `LeveledBase` or a domain name (`SeabedFoundation`); `surface` → `surfaceId` |

### 3.12 Generator keys and constants

- Keys `surfaceZone`, `wellboreOutline`, `stackWater`, `stackRelease`,
  `generatorStatsKey`: only the last has a `Key` suffix; `stackRelease` is a command.
- `TAPER_MIN_THICKNESS` is `minThickness`'s default without the `DEFAULT_` prefix;
  `DEFAULT_PALETTE` has no family prefix.

### 3.13 SDK

- `SurfaceZoneLayerSpec` and `SurfaceZoneSpecLayer` are DIFFERENT types whose names
  differ only in word order.
- `ZoneSurfaceLayer` lives in the SDK's wellbore outline code.
- The generator cache's `StackContext` sits beside React's `ZoneStackContext`.

---

## 4. Stale references — fix regardless

- `ZoneStack.tsx`: the `surfaces` doc and the component example still use a `groups`
  prop that no longer exists.
- `ZoneMeshes.tsx`: three comments describe a caller-supplied `Material`;
  `ZoneLayer.material` is `string` only.
- `zone-defs.ts`: `DEFAULT_FENCE_CELL_SIZE` documents `ZoneFence.cellSize`, which
  does not exist, and nothing uses the constant.
- ~~`layersFromGroups` is the last trace of the "groups" model~~ — the docs call that
  form "groups" again (2026-11-23), so the name matches.

---

## 5. Export surface

`src/components/Zones/index.ts` re-exports internals that would otherwise become
contract:

- `ZoneMeshes`, `ZoneSectionDebug`, `StackImmersionFog`, `useZoneSection`
- `ZoneStackContextValue` and the registry types `ZoneMarginEntry`,
  `ZoneBoundaryEntry`, `ZoneSurfaceClaim`, `ZoneBoundaryRegistry`, `ZoneSeamRegistry`
- shader helpers `ZoneMaterial`, `createFenceUniforms`, `applyFenceSide`,
  `createTileUniforms`, `bindZoneNormalMap`, `createInferenceMaterial`
- worker spec types `SurfaceZoneSpec*`
- `CARRIER_SEAM_ID`, `isCarrierSpecLayer`, `aggregateZoneProgress`, `UtmToScene`

---

## 6. Story args that already use better names

The FieldColumn story's controls are evidence of what reads naturally:

| Story arg | Library name |
|-----------|--------------|
| `floor`, `floorClearance`, `floorColor` | `carrier`, `carrier.below`, `carrier.material` |
| `seaLevel` | `water.depth` |
| `sectionKeep` | `ZoneLayer.section: false` |
| `sectionMode: 'fixed' \| 'camera' \| 'target'` | implied by `plane` / `cameraDistance` / `lockToTarget` |
| `lodLevels` | `resolve.lod.levels` |

---

## 7. Suggested agenda

1. Family name and prefix rule ([2](#2-the-core-component-pair)) — everything else follows.
2. Domain clashes: `layer`, `carrier`, `water.depth`, `sediment`, `immersion`.
3. One meaning each for "cut" and "section"; one word for interval/unit.
4. Restructure `resolve` and the debug props.
5. Trim the export surface.
6. Leaf renames (`material` → `color`, `margin` → `clearance`, …).
