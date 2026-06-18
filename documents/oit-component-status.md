# OIT Component Status — videx-3d

Quick-reference list of which components are wired for Order-Independent
Transparency (OIT) and which remain. For the full technical background see
[oit-report.md](oit-report.md); for the non-technical overview see
[oit-presentation.md](oit-presentation.md).

_Verified against source on 2026-06-17._

---

## ✅ Wired for OIT (transparency resolved order-independently)

| Component | Material | Wiring mechanism | Notes |
|-----------|----------|------------------|-------|
| `Surface` | `SurfaceMaterial` (`ShaderMaterial`) | `attachOitVariants` | `DoubleSide`; shader includes `oit.glsl` |
| `TubeTrajectory` | `tube-material` (SDK) | `attachOitVariants` | shader includes `oit.glsl` |
| `BasicTrajectory` | `LineBasicMaterial` | `makeOitCompatible` | line geometry; `vViewPosition` auto-injected |
| `Casings` | `CasingMaterial` (`MeshStandardMaterial`) | `makeOitCompatible` | `shareUniforms:['uniforms']` keeps slicing live |
| `CompletionTools / Screen` | `screen-material` (`ShaderMaterial`) | `attachOitVariants` | shader includes `oit.glsl` |
| `WellboreSeismicSection` | inline `ShaderMaterial` | `attachOitVariants` | `DoubleSide`; was a fence occluding wells before |
| `WellboreFormationColumn` | inline `ShaderMaterial` | `makeOitCompatible` | `vViewPosition` auto-injected |
| `Perimeter` | `ShaderMaterial` | `makeOitCompatible` | `DoubleSide` |
| `Grid` / `BoxGrid` | inline `<shaderMaterial>` | `<OitMaterial>` | only when actually transparent (`opacity<1`) |

## ✅ Integrated via special OIT layers (OIT-aware, not peeled/averaged)

| Component | Layer | Behavior |
|-----------|-------|----------|
| `Perforations` | `EMISSIVE` | additive glow drawn between opaque & transparent layers; provides an opt-in occlusion depth-stamp material (`userData.occlusionDepthMaterial`) used by `OITRenderPass.emitterDepthStamp` to stop surfaces behind dense jet cores washing them out |
| `Highlighter` | `EMISSIVE` | additive highlight, same placement |
| `CameraTargetMarker` | `OVERLAY` | always-on-top, drawn after transparency is resolved |

> The SDK `ribbon-material` (`RibbonMaterial`) is also `attachOitVariants`-wired, but
> it is **not currently used by any component** (the `WellboreRibbon` stripes use
> their own inline materials — see below).

## ⏳ Remaining — transparent-capable but NOT yet OIT-wired

| Component | Material | Why deferred / status |
|-----------|----------|-----------------------|
| `WellboreRibbon / FormationsStripe` | inline `<shaderMaterial transparent>` | uses a glyph UBO (`uniformsGroups`); needs verified UBO sharing before wiring (via `<OitMaterial mode="attach">` or `makeOitCompatible`) |
| `WellboreRibbon / MeasuredDepthStripe` | inline `<shaderMaterial transparent>` | same glyph-UBO concern as above |
| `PositionMarkers` | inline `ShaderMaterial transparent` | drives alpha via custom `uOpacity`/`uBackgroundOpacity`; not wired (router needs `material.opacity` or `uniforms.opacity` synced) |
| `SDFTest` | inline `<shaderMaterial>` | debug/test component, low priority |
| `Annotations` (+ `WellboreLabel`) | 2D canvas / HTML overlay | **by design separate** — occluded via the depth texture, not part of the 3D OIT pipeline. By default only *opaque* geometry occludes labels; the opt-in surface depth-stamp (`OITRenderPass.occlusionDepthStamp`) lets sufficiently-opaque transparent surfaces occlude them too |

## ◻️ Opaque — OIT not applicable

`DepthMarkers`, `FormationMarkers`, `Shoes` — no transparency (no `opacity<1` /
`transparent` / additive blending); they render in the opaque pass as normal.

---

> **Reminder:** an unwired *transparent* material is silently treated as **opaque**
> by `OITRenderPass` and can occlude OIT geometry behind it. The "Remaining" items
> above are the candidates to watch when transparency is enabled on them.
