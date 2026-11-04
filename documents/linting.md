# Linting (oxlint)

This project moved from ESLint to [oxlint](https://oxc.rs/docs/guide/usage/linter.html)
(`ce6685a fix(229): replace eslint with oxlint`). `eslint.config.js` is gone; the
configuration lives in `.oxlintrc.json` and the entry point is:

```sh
npm run lint      # oxlint
npx oxlint        # same, ad hoc
```

`categories.correctness` is set to `error`, so anything in that category fails the
run. `suspicious` and `perf` are warnings.

This document records the **deliberate rule exceptions** and why each one was made,
so that a future reader can tell an intentional exemption from an oversight. JSON
does not support comments, which is the only reason these notes are not in
`.oxlintrc.json` itself.

---

## 1. `oxc/no-this-in-exported-function` — off for `src/generators/*`

**Was:** 31 warnings, every one of them in `src/generators/`.

Generators are declared with an explicit `this` parameter and invoked with the store
bound by the generator registry (see [Generators](./generators.md)):

```ts
export function generateSurfaceChunk(this: ReadonlyStore, spec: SurfaceChunkSpec) {
  const values = await this.get('surface-values', id);
  ...
}
```

The rule's rationale — *"in bundlers, `this` becomes `undefined` in exported
functions"* — is exactly inverted here: the whole contract is that the **caller**
binds the store, and TypeScript type-checks that binding through the `this`
parameter. Every generator in the library follows this shape, so the finding is
architectural, not accidental.

Scoped to `src/generators/*` via `overrides` rather than disabled globally, so the
rule still protects ordinary application code, where a stray `this` in an exported
function usually *is* a bug.

## 2. `react-perf/jsx-no-new-object-as-prop` — off

**Was:** 50 warnings — the single largest category.

React Three Fiber's idiomatic API takes fresh arrays and objects as props:

```tsx
<mesh position={[x, y, z]} scale={[1, k, 1]} />
```

The config already turned off the sibling rule `react-perf/jsx-no-new-array-as-prop`
for this reason; the object variant is the same idiom and was only half-addressed.
Turning it off finishes a decision that had already been taken.

⚠️ **This does not make the underlying concern disappear.** Referential churn in
props still matters in this codebase — it is precisely what made changing a chunk's
opacity rebuild its geometry (see `chunks.md`). The mitigation is memoisation on the
values that feed an expensive rebuild (the `stableLayers` / content-key pattern in
`Chunk.tsx`), which the linter could not have enforced anyway. This rule was firing on
*presentational* props where the cost is nil, and drowning the signal.

## 3. `vitest/valid-expect` and `no-await-in-loop` — off for `tests/*`

**Was:** 3 errors, and 3 warnings.

The `valid-expect` rule is modelled on Jest, where `expect` takes exactly one argument. **Vitest
supports a second `message` argument**, and it carries real value in a loop:

```ts
expect(covered, `${id} has no data`).toBeGreaterThan(0);
```

Without the message, a failure in a loop over generated scenarios does not say which
scenario broke. The code is correct; the rule is wrong about this runtime.

`no-await-in-loop` is about throughput, which a test does not have: awaiting one case
after another keeps a failure and its log in order, and keeps one case's state from
leaking into the next.

## 4. `documents/*` added to `ignorePatterns`

`documents/` holds explanatory sketch scripts alongside the prose (for example
`column-sketch.cjs`, which renders the stratigraphic-column model diagram). They are
one-off illustrations, not shipped code — the same category as `scripts/*`, which was
already ignored.

## 5. `import/no-unassigned-import` — stylesheets allowed

**Was:** 3 warnings, every one an `import './x.css'` / `import './x.scss'`.

A stylesheet is imported for its side effect alone; there is nothing to assign. The rule
stays on for scripts, where an import kept only for its side effect is worth a second look.

## 6. `react-perf/jsx-no-new-function-as-prop` — off for `src/storybook/**`

**Was:** 9 warnings, in the story decorators.

Storybook scaffolding, not shipped: the decorators render once per story, and the inline
callbacks keep each one readable next to the component it demonstrates. The rule stays on
for the library itself (see below).

---

## Inline exemptions

These findings are suppressed at the call site rather than in the config, because they
are one-offs and the reason is local:

**`import/default`** in `src/generators/workers/stack-worker-pool.ts` — the import is
a Vite virtual module:

```ts
import RefineWorker from './stack-refine.worker?worker&inline';
```

The `?worker&inline` query is resolved by the bundler into a module with a default
export; oxlint's resolver cannot follow it. Types come from `vite/client`.

**`react/no-array-index-key`** — the array index is the *correct* key here:

- `src/components/Chunks/ChunkMeshes.tsx` (×2): the data-dependent alternative the rule
  wants is the mesh's `layer` index, and that is **not unique**: a `void` seal splits one
  surface into two meshes that share a layer. Keying on it would collide.
- `src/components/Wellbores/Casings/Casings.tsx`: a section is positional — its material
  options, render order and `sectionIndex` are all looked up by the same index.

**`jsx-a11y/no-noninteractive-element-interactions`**, **`jsx-a11y/no-noninteractive-tabindex`**
in `src/components/Html/GeoMap/GeoMap.tsx` — a map is a composite widget the user pans and
zooms with the pointer and, focused, with the arrow keys and + and −: WAI-ARIA's
`application` role (with `aria-roledescription="map"`) says exactly that, and the rules
count it as non-interactive. Its buttons are buttons of their own.

**`oxc/no-map-spread`** — the copy is the point:

- `src/generators/casings-generator.ts`: the items come from the store, which may cache
  them; writing into them would change what the next caller gets.
- `src/sdk/geometries/wellbore-fence.ts` (`loopSpans`): the spans may be the caller's own
  (`options.problems`), and the neck wrapped from them still holds them.

**`eslint/no-await-in-loop`** in `src/components/Chunks/useChunkContacts.ts` — the
surfaces are fetched one at a time on purpose: each is a full grid, and a cancelled build
stops before the next one is fetched.

---

## Formerly open findings (resolved 2026-10-14)

`npm run lint` passes with no errors. The four that remained after the oxlint
migration were resolved as follows:

| Where | Rule | Resolution |
| --- | --- | --- |
| `src/components/Annotations/AnnotationsHMTL.tsx` (×2) | `jsx-a11y/click-events-have-key-events`, `jsx-a11y/no-static-element-interactions` | The label wrapper carries `role="presentation"`: it positions a host-provided label component, and the click/hover handlers are a pointer convenience, not a control of its own. Keyboard access, where wanted, belongs in the label component. |
| `tests/mesh-boundary.test.ts` (×2) | `vitest/no-conditional-expect` | Restructured: the loop collects the paired half-edges, and the checks run on that list afterwards. |

The warnings (86) were mostly pre-existing (`no-shadow`,
`no-object-type-as-default-prop`, `jsx-no-new-function-as-prop`) and were left alone at
the time; they were cleared on 2026-11-04 (below).

## Warnings cleared (2026-11-04)

`npm run lint` reports **0 errors and 0 warnings**. Besides the config changes (§3, §5,
§6) and inline exemptions above, the 97 warnings were fixed in the code:

| Rule | Fix |
| --- | --- |
| `no-shadow` (37) | Renames only. |
| `no-object-type-as-default-prop` (15) | Default `[]` / `{}` props are module constants. One was live churn: `WellMap`'s `theme = { ...DarkTheme }` re-ran `setStyles` on every render. |
| `jsx-no-new-function-as-prop` (7) | `useCallback`. `BoxGrid`'s inline `onChange` restarted `ObservableGroup`'s observer on every render. The callback refs in a `.map()` (`MinimapPoints`, `MinimapGeoLayer`) use `useIndexedRefs` (`src/hooks`), one stable ref callback per index. |
| `no-accumulating-spread` (7) | `reduce` with `{ ...acc, [k]: v }` (quadratic) became `Object.fromEntries`. |
| `no-map-spread` (6 fixed, 2 exempt) | Fresh objects are written into rather than copied; the event records in `fence-run-out` carry only the fields read. |
| `no-unmodified-loop-condition` (3) | All three were loop-invariant guards or a flag set in a closure; hoisted or moved into the body, behaviour unchanged. |
| `jsx-no-constructed-context-values` (1) | `DataProvider` memoises its value; it re-rendered every consumer on each render. |
| `approx-constant` (1) | `Math.SQRT1_2` in the test — the same double. |

## Rules considered and deliberately kept

- **`react-perf/jsx-no-new-function-as-prop`** — kept as a warning (0 left; off only in
  `src/storybook/**`, §6). Unlike the object/array case, an unmemoised callback passed to
  an R3F object really does cause handler re-attachment, and one passed to a component
  that lists it in an effect's dependencies restarts that effect (`BoxGrid` did).
- **`react/no-object-type-as-default-prop`** — kept (0 left). A default `[]` / `{}` is a
  new identity per render, which breaks any memo or effect keyed on the prop.

## React hooks rules: mostly still enforced

There is **no separate `react-hooks` plugin to enable** — oxlint bundles those rules
into the `react` plugin, which is already in `plugins`. Verified against a deliberately
broken probe component:

```
error react-hooks(exhaustive-deps): React Hook useEffect has a missing dependency: 'value'
```

So `react-hooks/exhaustive-deps` is live and, being in the `correctness` category, is an
**error**. `react-hooks/rules-of-hooks` is available too and the codebase has no
violations of it.

⚠️ The `// eslint-disable-next-line react-hooks/exhaustive-deps` comments in `Chunk.tsx`
(×3) and `ChunkStack.tsx` are therefore **load-bearing, not decoration** — oxlint honours
the `eslint-disable-*` syntax, and `npx oxlint --report-unused-disable-directives`
confirms none of them is redundant. Deleting one fails the lint. They mark the content-key
trick (`stableLayers` / `layersKey`) that stops a fresh `layers={[...]}` array identity
from rebuilding chunk geometry on every render.

⚠️ **`react-hooks/set-state-in-effect` is the one real loss** — it is absent from
oxlint's rule set entirely, so nothing enforces it now. It is why asynchronous chunk
builds set state inside an async IIFE guarded by a `cancelled` flag rather than directly
in an effect body. The pattern is correct on its own merits and should be preserved by
convention; see `Chunk.tsx`.

