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

## 3. `vitest/valid-expect` — off for `tests/*`

**Was:** 3 errors.

The rule is modelled on Jest, where `expect` takes exactly one argument. **Vitest
supports a second `message` argument**, and it carries real value in a loop:

```ts
expect(covered, `${id} has no data`).toBeGreaterThan(0);
```

Without the message, a failure in a loop over generated scenarios does not say which
scenario broke. The code is correct; the rule is wrong about this runtime.

## 4. `documents/*` added to `ignorePatterns`

`documents/` holds explanatory sketch scripts alongside the prose (for example
`column-sketch.cjs`, which renders the stratigraphic-column model diagram). They are
one-off illustrations, not shipped code — the same category as `scripts/*`, which was
already ignored.

---

## Inline exemptions

Two findings are suppressed at the call site rather than in the config, because they
are one-offs and the reason is local:

**`import/default`** in `src/generators/workers/stack-worker-pool.ts` — the import is
a Vite virtual module:

```ts
import RefineWorker from './stack-refine.worker?worker&inline';
```

The `?worker&inline` query is resolved by the bundler into a module with a default
export; oxlint's resolver cannot follow it. Types come from `vite/client`.

**`react/no-array-index-key`** in `src/components/Chunks/ChunkMeshes.tsx` (×2) — the
array index is the *correct* key here. The data-dependent alternative the rule wants
is the mesh's `layer` index, and that is **not unique**: a `void` seal splits one
surface into two meshes that share a layer. Keying on it would collide.

---

## Known remaining findings (not exceptions — open work)

`npm run lint` does **not** pass cleanly today. Four errors remain, all pre-dating or
deliberately deferred from the oxlint migration:

| Where | Rule | Note |
| --- | --- | --- |
| `src/components/Annotations/AnnotationsHMTL.tsx` (×2) | `jsx-a11y/click-events-have-key-events`, `jsx-a11y/no-static-element-interactions` | Pre-existing on `main`. A clickable `div` with no keyboard handler or role — a genuine accessibility finding, not a false positive. |
| `tests/mesh-boundary.test.ts` (×2) | `vitest/no-conditional-expect` | `expect` inside `if (opposite[he] >= 0)` within a loop. The rule guards against assertions that silently never run; here a separate `expect(paired).toBe(16)` proves they did. Suppress or restructure — not yet decided. |

Warnings are down from 168 to 79 after the changes above. The remainder are mostly
pre-existing (`no-shadow`, `no-object-type-as-default-prop`,
`jsx-no-new-function-as-prop`) and were left alone deliberately.

## Rules considered and deliberately kept

- **`react-perf/jsx-no-new-function-as-prop`** (13 warnings) — kept as a warning.
  Unlike the object/array case, an unmemoised callback passed to an R3F object really
  does cause handler re-attachment, so the finding is sometimes real.
- **`react/no-object-type-as-default-prop`** (14 warnings) — kept. Low value in most
  of the hits, but it is a correct observation about default `[]` / `{}` values.

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

