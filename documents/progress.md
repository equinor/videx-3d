# Progress

How the library tells a host how far it has come — a chunk stack building its model, the
sky compiling its shaders and loading its relief — and how the host shows it, in its own
DOM, outside the R3F canvas.

Code: `src/components/Progress/` (`progress-store.ts`, `Progress.tsx`,
`ProgressPopup.tsx`, `useProgress.ts`). Tests: `tests/progress.test.ts`.

## The store

What reports lives inside the canvas; what shows it belongs in the host's DOM. A
`ProgressStore` carries it across, and only what reads the store re-renders: passing
`setState` as a callback instead would re-render the whole `<Canvas>` on every report.

```tsx
const progress = useMemo(createProgressStore, []);
// inside the canvas
<Sky onProgress={progress.source('sky', { name: 'Sky' })} />
<ChunkStack onProgress={onModelProgress}>…</ChunkStack>
// anywhere in the host's DOM
<ProgressPopup store={progress} position="top" split="source" />
```

- **Sources.** `store.source(key, { name, title, group })` hands out the report function
  of one source: the same function for the same key, so it can be passed in render. Any
  number of sources report into one store. `name` names the source as a row when a
  display shows several, `title` heads a display showing it alone (default `name`), and
  `group` puts sources together (default its key).
- **Reports.** A source reports everything it is doing, whole, each time anything
  changes: a `ProgressReport` of `items`, each a unit of work with a `state`
  (`working` | `ready` | `empty` | `failed`), an `estimate` (0 to 1), an optional
  `weight`, the `step` it is on (`{ label, done, total }`), its start and end times and
  `stats` to sum (e.g. `tiles`, `triangles`). `current` names the item whose step heads a
  display. A report with no items means the source has gone away: it leaves the store,
  and a run it was in ends without an outcome.
- **Runs.** Each source runs from its first working report to its first that is not:
  `building`, a `percent` that never moves backwards within the run and stays below 100
  until it ends, a `session` counter, `startedAt` / `finishedAt` and how it ended
  (`outcome`: `ready` | `failed`). The store keeps the same for every source together
  (`all`) and for each group (`groups`), over the sources that took part: a source that
  was done before the run started does not count toward it, so the sky being ready does
  not start the model's build at 50 %.
- It notifies at most once per animation frame. It also holds whether the details are
  `expanded` (`setExpanded`), so a display that comes back opens the way it was left,
  and every display reading one store agrees.

## Showing it

Three ways, from most to least custom:

| | What | Visibility |
|---|---|---|
| 1 | `useProgress(store)` + `describeProgress(snapshot, { source?, group?, labels? })` → title, percent, stage text, `durationMs` and summed `stats` once done, and rows: the items of a lone source (each chunk), or one per source when there are several | yours |
| 2 | `<Progress store source? group? details expandable onDismiss? footer? />` — plain HTML where it is placed | while one of its sources is there; shows the finished state afterwards |
| 3 | `<ProgressPopup store split position offset delay exitDuration dismissible stayOpen />` — tier 2 in a click-through layer over the positioned element holding the canvas | while a run lasts: a card mounts when it starts (after `delay`), turns `data-state="closing"` for `exitDuration` when it ends or is dismissed, then unmounts. With `stayOpen` it stays as `data-state="done"` until dismissed or the next run |

`split` decides how many displays a popup shows, stacked in a column:

- `none` (default): one for all its sources, a row each — or one `group` or `source` of
  them, given;
- `source`: one per source, each coming and going with its own runs;
- `group`: one per group, for a combination: e.g. the sky and its relief together, the
  model apart.

`footer(view, snapshot)` adds content to tiers 2 and 3 without going fully custom — e.g.
"12.3 s · 48 tiles · 1.2 M triangles" from `view.durationMs` and `view.stats`, empty
while building. Tier 2 visible only while building needs no option: it stays mounted
and turns `data-state="idle"`, so CSS can fade it out.

The display's own texts come from `PROGRESS_LABELS` (`title`, `states`, `showDetails`,
`hideDetails`, `dismiss`, `item`), overridable piecewise through `labels`; the steps'
come from their sources. A step's count (`3/16`) is shown only when it has several
units. A lone source building is titled by its `title`; several by `title.building`.

⭐ The library ships NO CSS. The only inline styles are the popup's anchoring and its
stack's direction, the bar fill's width and a `--videx-progress` custom property (0 to
1). Everything else is the host's, through the `videx-progress` BEM classes (`__header`,
`__title`, `__percent`, `__dismiss`, `__bar`, `__fill`, `__toggle`, `__details`,
`__stage`, `__rows`, `__row`, `__row-name`, `__row-stage`, `__row-percent`,
`__footer`), `data-state` / `data-outcome` / `data-expanded` on the root, `data-state`
per row, `data-position` on `videx-progress-popup`, and `data-key` / `data-state` on
each `videx-progress-popup__card` in its `__stack`. The bar is decorative
(`aria-hidden`); the title and percentage carry it as text.

## What reports

- **`ChunkStack.onProgress`** reports its own detailed `ChunkStackProgress`;
  `chunkProgressReport(progress, labels?)` turns it into a report, a chunk an item (see
  [chunk-stack/coordination.md](./chunk-stack/coordination.md#showing-progress-in-the-host)).
- **`Sky.onProgress`** reports two items: `shaders`, its programs compiled of those it
  waits for (the stand-in, its own, its stages', its bakes' and the cliffs'), and with a
  tiled relief `relief`, its stages' tiles loaded of those wanted. The relief runs from
  when a tile is waited for to when none is, so moving the camera starts a short run: a
  popup's `delay` keeps those from flashing it. Its texts are `SKY_PROGRESS_LABELS`,
  overridable through `progressLabels`. See [sky.md](./sky.md#performance) for why its
  shaders take long the first time.
- Anything of the host's own can report through a source as well.

## In Storybook

Every story drawing a sky, and the `FieldColumn` story, report into one store held
outside the canvas (`storyProgress` in `src/storybook/decorators/progress-decorator.tsx`):
the sky as `sky`, the chunk stack as `model`. `skyDecorators` include its decorator, and
the `Progress` controls choose the display (`progressDisplay`), its `progressSplit`,
`progressDelay` and the rest. The look is the stories' own stylesheet,
`src/storybook/styles/progress.css`.
