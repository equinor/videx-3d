---
name: videx-3d-storybook-inspection
description: 'Drive the videx-3d Storybook scene from a browser session — set an exact camera pose, change controls without reloading, wait for the scene to be built, and locate wellbores in scene coordinates. Use when visually inspecting or debugging any 3D story (fence/column cuts, surfaces, casings, rendering passes), when a screenshot is needed at a repeatable viewpoint, or when a story fails to render.'
---

# Inspecting videx-3d stories in the browser

Storybook publishes `window.videx3d` (Storybook only — the library has no globals).
Everything below runs inside `page.evaluate`.

⚠️ Do not write TypeScript in `page.evaluate` — the snippet is evaluated as plain
JS and `x as T` is a syntax error.

## Recipe

```js
// 1. wait for the handle, then for the scene to actually be built
for (let i = 0; i < 80 && !window.videx3d; i++)
  await new Promise(r => setTimeout(r, 250));
await window.videx3d.ready();            // ~6 s; NEVER use a fixed sleep

// 2. change controls in place — a reload costs ~25 s, this costs ~0.3 s
await window.videx3d.setArgs({ fenceSide: -1, fenceWidth: 0 });

// 3. ask where things are instead of hard-coding coordinates
const { head, td, deepest } =
  await window.videx3d.locate('wellbore', '<wellbore id>');

// 4. set an exact, repeatable pose
await window.videx3d.camera.orbit({
  azimuth: 90, polar: 2, distance: 700, target: head, transition: false,
});
```

Then `screenshot_page`.

## API

| call | what it gives |
| --- | --- |
| `ready({stableFrames, timeout, minMeshes})` | resolves when the scene graph stops growing |
| `setArgs(args)` / `getArgs()` | story controls, no reload |
| `locate(kind, id)` | scene-frame `{head, td, deepest}`; `kind` is `'wellbore'` |
| `bounds()` | `{min, max, center, size}` of everything in the scene |
| `camera.orbit({azimuth, polar, distance, target, transition})` | spherical pose, **degrees and metres** |
| `camera.lookAt({position, target, transition})` | explicit pose |
| `camera.frame(box, {azimuth, polar, padding})` | fit a box to the view |
| `camera.pose()` | current pose, in the form `orbit` takes — paste it back to return |
| `camera.settled()` | resolves when the controls stop moving |

Conventions: **azimuth** is measured from +X toward +Z; **polar** is 0 straight
down, 90 at the horizon, 180 straight up. `transition: false` lands exactly and
in one frame — always use it before a screenshot.

`locate` is registered per story (see `useVidex3dLocate`), so it is only present
on stories that opt in. It resolves through the scene's own `utmToArea`, so its
answer is in the frame the scene is actually in — prefer it over deriving
coordinates yourself.

## Judging geometry — learned the hard way

- ⭐⭐ **For anything defined in plan (a vertical fence, an outline, a footprint),
  look straight down**: `orbit({ polar: 2, ... })`. A perspective view at a
  grazing angle repeatedly reads as a defect that is not there. Three wrong
  diagnoses in one session came from this; the top-down shot settled it in one.
- ⭐ To disambiguate a shape, **orbit around a fixed `target`** and take two or
  three bearings. Keeping the target fixed is what makes the frames comparable.
- ⚠️ Surface colour depends heavily on angle, because you may be seeing an
  interior layer through a cut. Do not identify a surface by its colour alone.
- Turn distracting geometry off while debugging: `water: false` in particular
  hides the seabed entirely.
- Zoom in further than feels necessary. Misalignments of a metre or two are
  invisible at 300 m and obvious at 60 m.

## Gotchas

- ⚠️⚠️ The canvas decorator can load an HDR environment from
  `raw.githubusercontent.com`. If that 429s or the machine is offline, the fetch
  throws inside `<Canvas>` and **every 3D story is replaced by an error
  boundary**. Symptom: no `<canvas>` element and a `Could not load
  studio_small_03_1k.hdr` page error. Disable the `Environment` to proceed.
- Storybook URL args: `?id=<story>&viewMode=story&args=key:value;key2:value2`,
  booleans as `!true` / `!false`, `#` in colours as `%23`. Prefer `setArgs` over
  URL args once the page is up.
- Story ids used here: `spikes-chunks-fieldcolumn--default`.

## Measuring instead of looking

Numeric harnesses under `tests/` can load the real demo data
(`public/data/wellbore-headers.json`, `position-logs.json` — objects keyed by id).

⚠️ Vitest 4 swallows `console.log` from **passing** tests. Run
`npx vitest run <file> --disable-console-intercept`, or a working harness looks
like a broken one.

⚠️ Restrict any error metric to the region that is actually **drawn**. A large
value measured outside the footprint means nothing, and reporting one as a cause
has wasted whole sessions here.
