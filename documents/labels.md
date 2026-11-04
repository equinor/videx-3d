# Labels

Text labels glued to the world: for lines, contours and grids, where the annotations' HTML
labels would be too many and too heavy. A label is painted where it lies, in the plane
square to its normal, as large as its layer's `size`: world units by default, or pixels on
screen (`sizing`). It never moves or turns on its own: it fades out as its plane turns
edge-on or grows small on screen, and is hidden from behind and behind the scene. Where
labels meet on screen, the less wanted give way (`priority`), as annotations do. Given room
of its own (`bounds`) or places to choose from (`places`: a polygon's name, say), a label
breaks into the fewest lines that fit at the size it is drawn, shrinking where none do.

```tsx
<Labels>
  <LabelLayer labels={contourLabels} size={30} color="#ffd23f" priority={1} />
  <LabelLayer provider={gridLabels} size={50} />
  <LabelLayer labels={wellNames} size="medium" sizing="auto" distanceFactor={5000} />
</Labels>
```

Example: the `Components/Misc/Labels` story (`src/components/Labels/Labels.stories.tsx`):
contour labels painted on a hill's slope, grid labels at fixed crossings from a provider,
texts wrapped in their outlined bounds (`wrap`), a stress layer (`stressLabels`), a pane of
glass and an OIT pipeline (`pipeline: 'oit'`). Polygons' names: the
`Components/Layers/GeoLayers` story's discoveries (`GeoLabels`, see layers.md).

## Model

| piece | what it is |
| --- | --- |
| `Label` | `text` (its lines broken by `\n`), `position`; `normal` (default up: lying flat, read from above); `direction`, the way it reads (default level: up × normal, or +X lying flat); `size`, `priority` and `id` of its own; `bounds`, room of its own to wrap in; `places`, others it may be drawn at |
| `LabelPlace` | somewhere a label may be drawn instead, and as what: `text`, `position`, `normal`, `direction`, `bounds`, each its label's where left out |
| `LabelLayer` | its labels (`labels`), a `provider`, or both; its `LabelStyle`, `priority` and `overlap` as props |
| `LabelsProvider` | `(view) => Label[]`, called when the camera or the view's size changes: which crossings of a grid to label, say |
| `LabelGroup` | the layers drawn and kept apart together: one glyph atlas, one draw (two: depth tested, and not), one placement a frame. A `<Labels>` is one, freed with it; the layers of a scene under none share the scene's |
| `LabelAtlas` | each glyph (character, font, halo width) drawn once with the canvas API into one texture, and texts as runs of them |

Positions, normals and directions are in the layer's frame (its parent's), so a layer can
sit in a group with the data it labels; its `size` stays in world units (or pixels). Keep a provider
stable (`useCallback` or module level), and have it hand back the same array while its
labels are the same: a new array writes them all again.

## Overlap and priority

Every layer of a group (its `<Labels>`, or the scene's) is placed together each frame the
view or its labels change (`LabelGroup`, `label-placement.ts`), as annotations are:

- **Where each lies on screen**, as the vertex shader draws it: its text's ink — the box its
  glyphs and halo fill (`LabelTextRun.inkWidth`, `inkHeight`, from its glyphs' ink as laid
  out, about the middle of its cell either way, so the same flipped) — its four
  corners placed as the shader places the quad (`labelPixels`, anchor, offset, lift), only
  for labels that show at all (`labelFade` over 0: facing, large enough, within their
  distances), and in view. A label off the view by more than its text reaches is skipped
  before its corners are worked out. Kept apart by their cells instead — 1.3 ems tall, and
  the halo — labels lay farther apart than their ink needs.
- **Ranked** (`labelRank`): `priority` first — the layer's plus the label's own — then,
  between labels of one priority, one shown already over one that is not (so labels keep
  their places as the view moves), as much as it shows: one all but faded out keeps no
  place from one that reads whole, as it did while the bonus was its own; then whole rather
  than faded, near the middle of the view, and near the camera.
- **Let in best first** where its quad comes no closer than `margin` pixels (`<Labels
  margin>`, default 1) to any let in before it (`LabelPlacer`: a grid of cells over the
  candidates, each tested against those in the cells it covers, then exactly, by the
  separating axes of the two quads, `labelQuadsOverlap`; a first version kept them in
  an R-tree, as the annotations do, and took nearly three times as long: 2.0 ms against 0.7
  with 5000 labels in view). A layer with `overlap` is let
  in always and keeps none out.
- **Bands**, as the annotations': a label is **near** while its layer's `distanceFactor` is
  at least half the view's height where it is (`labelBand`, `LABEL_NEAR_SCALE`), else
  distant. Near labels are kept apart from near ones, distant from distant; a near one may
  lie over a distant one, and is drawn after it: every group draws its labels farthest
  first. With `sizing` `'auto'` that is where a label has shrunk to half its size.
- **Faded** in and out over `LABEL_FADE_TIME` (0.25 s) as it is let in or pushed out; one
  pushed out stays out for `LABEL_COOLDOWN` (0.5 s), so two that meet as the view moves do not
  trade places back and forth. Labels keep their state across their layer's labels given
  anew by `Label.id`, or their text and position (a provider's, say).
- **Budget**: placing takes about 0.6 ms a frame for the graticule's ~1900 labels.
  Thousands in view take longer: a placement that overruns `LABEL_PLACE_BUDGET` (1 ms) is
  done again only after as many frames as it overran by, at most `LABEL_PLACE_MAX_WAIT` (3),
  fading by the time since (`LabelGroup.placeBudget`; Infinity places every frame). Labels
  are drawn where they are by the GPU each frame regardless; only which are shown lags.

Priorities in the library: data labels (`GeoLabels`) 0, a relief's contour labels −0.5
(`RELIEF_CONTOUR_LABEL_PRIORITY`, see [relief.md](./relief.md#contour-labels)), latitude and
longitude's names −1 (`GRATICULE_LABEL_PRIORITY`), the zones' −2
(`GRATICULE_ZONE_LABEL_PRIORITY`).

## Wrapping and places

A label may be drawn more than one way: each a **source** (`LabelSource`, `labelSources`),
a record of its own in its group, its text, position, frame and room.

- **`bounds`** — `[width, height]` in its layer's frame's units, along the way it reads and
  across, about its position as its text is aligned (`align`, `baseline`: its anchor puts
  the box where it puts the text). Its text is broken into lines each way up to its layer's
  `maxLines` (default 3), fewest first (`wrapLabelText`): at spaces, balanced — its widest
  line as narrow as it can be (min-max, by dynamic programming over the words), not greedy —
  a count of lines left out where it is not 2 % narrower than fewer. Measured by the font's
  metrics (`LabelAtlas.measure`, `labelLineWidth`). A way whose text could be no larger in
  the box than in fewer lines is left out too: it would never be drawn.
- **`places`** — ways given whole, in order of preference, each with its own text, middle,
  frame and room: what `GeoLabels` gives a polygon's name, a place for each way of breaking
  it into lines, where that shape fits the polygon best. A place is not wrapped further.
- Neither: one source, the label itself; a text with `\n` is drawn on several lines as it is.

Each placement, a label with more than one source or any room works out each source's room
for its text at the size it is drawn there (`roomAt`: the least of its room over its ink's
extent either way, its size as its sizing and `maxPixels` make it), and is drawn
(`labelPlaceChoice`) at the **first that fits**, whole; **else at the roomiest, shrunk to
fit**. It stays where it is while that still fits (none fitting: while it has nearly the
most room), unless one before it fits with 5 % to spare (`LABEL_PLACE_HYSTERESIS`), so a
text that just fits two ways does not switch back and forth as the view moves by a hair.
Each label keeps its place and shrink by its key, as its fade. The shrink is the draw's
third float (`labelDraw.z`), applied **after** `maxPixels` caps its size in the shader (and
`labelFade` is given the size so drawn): a label shrunk past `minPixels` fades out as any
too small to read. In world sizing nothing changes as the view moves, unless `maxPixels`
caps it; sized on screen, zooming out breaks a label into more lines, then shrinks it, then
fades it out.

Switching between sources is a cut, not a fade: the text and its place change between one
frame and the next.

## Style

Per layer (`LabelStyle`, defaults in `LABEL_STYLE_DEFAULTS`; `resolveLabelStyle` fills them
in and resolves a preset).

- **Text**: `fontFamily`, `fontWeight`, `fontStyle` (italic), `letterSpacing` (ems, set
  by the layout between each two characters), `color`; `haloColor` (its alpha kept) and
  `haloWidth`, a fraction of `size`. Font, weight, style and halo width are drawn into the
  atlas's glyphs (`labelGlyphKey`); spacing and alignment are the layout's, the colours the
  layer's style, read by the shader, so layers of any colours, spacing and alignment share
  glyphs.
  By default: the Equinor font where the page has loaded it, else the system's UI font
  (`LABEL_FONT_FAMILY`: `Equinor, system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial,
  sans-serif`), weight 400, white, and a thin crisp halo (0.1 em, `rgba(0, 0, 0, 0.85)`).
  The library never loads a font: a page that wants the Equinor font links
  `https://cdn.eds.equinor.com/font/equinor-font.css` (Storybook does, in
  `.storybook/preview-head.html`; the font is Equinor's own, never bundled). See **Fonts**
  under [How it is drawn](#how-it-is-drawn) for one that is not in yet.
- **Size**: `sizing` decides what `size`, the font's size (the em), is:
  - `'world'` (default): world units, glued to the world — it grows and shrinks on screen
    with distance, no larger than `maxPixels`;
  - `'screen'`: CSS pixels, at any distance;
  - `'auto'`: CSS pixels near, as an annotation's label: whole while the view spans no more
    than `distanceFactor` world units top to bottom where the label is (default 1000), then
    shrinking with distance as a world-sized label does, down to `minScale` of its size
    (default 0.6: a `small` preset's 12 pixels keep to 7.2, still read whole). Bent smoothly
    into both bounds on a log scale (`labelAutoScale`, `LABEL_AUTO_KNEE`, about a factor of
    1.5 in distance), so its size never turns sharply as the view zooms; exact outside the
    bends.

  Sized on screen (`'screen'`, `'auto'`), a label lying at a slant is drawn larger, by one
  over the square root of its facing, at most `slantGrowth` times (default 2; 1 never): it
  reads as large as asked, as seen (`labelSeenPixels`). Without it, a 12 pixel label lying
  flat seen 35° up read 7 pixels, and `'auto'` labels at their least faded out where they
  should read.

  `size` may instead be a **preset**, a size on screen tuned to read well
  (`LABEL_SIZE_PRESETS`), drawn `'screen'` unless `'auto'`:

  | preset | font, px | halo, em (px) | also |
  | --- | --- | --- | --- |
  | `xsmall` | 10 | 0.16 (1.6) | weight 500, spacing 0.02 em |
  | `small` | 12 | 0.13 (1.56) | spacing 0.01 em |
  | `medium` | 14 | 0.11 (1.54) | |
  | `large` | 18 | 0.09 (1.62) | |
  | `xlarge` | 24 | 0.08 (1.92) | |

  A halo of about a pixel and a half to two at every size: thin, but enough to read over
  anything. All read whole as they are (`minPixels`, 7), and `'auto'` at its least all but
  `xsmall`. What the style gives itself wins over its preset. Each label's own `size`
  (`Label.size`, default 1: labels of one layer at sizes of their own, as the
  graticule's zone names, each its cell's) multiplies it in any sizing, as does `scaleRef`,
  an optional live multiplier read each frame and set on the GPU alone (no render,
  nothing written again): for a size that follows the view smoothly, as the graticule's
  `'smooth'` labels do. The vertex shader works the size out per label each frame
  (`labelPixels` does the same on the CPU), so no sizing writes anything again.
- **Placement**: `align` (`'left'` starts the text at its position, `'center'`, `'right'`
  ends it there) and `baseline` (`'top'` hangs it below, `'middle'`, `'bottom'` stands it
  above), by its quad, halo included (`labelAnchor`); then `offset`, `[along, up]` in ems,
  in its plane, so it scales with `size`: a label beside its line or marker. A text of
  several lines aligns them by `align` too.
- **Wrapping**: `maxLines` (default 3), the most lines a label with `bounds` is broken into
  (see [Wrapping and places](#wrapping-and-places)).
- **Flip**: `flip` (default on) turns a label to read left to right from wherever it is
  seen: where its way of reading points away from 10° above screen right by more than a
  right angle (`labelReadsBackward`, `LABEL_FLIP_TILT`: so near-vertical text reads
  upward, the map maker's way, and a line straight up the screen does not flip back and
  forth as the view turns by a hair), its text is mirrored both ways inside its own quad —
  turned half round, not moved — so it keeps its place, alignment and offset. Per label,
  in the vertex shader, from where its reading direction projects: nothing is written
  again. Off for text that must keep its own way, a contour's value reading with its top
  uphill, say.
- **Fades**: from behind, never drawn. **A label that reads whole never fades**: it is whole
  while it faces the camera at least `minFacing` (cosine between the normal and the way to
  the camera, default 0.15) and its text reads at least `minPixels` high on screen **as
  seen** (default 7 CSS pixels: its font face-on times the square root of its facing,
  `labelSeenPixels`), and fades out only below them, gone at `fadeFacing` (default half
  `minFacing`) and `fadePixels` (default 0.6 of `minPixels`). `minDistance` and
  `maxDistance` are softened over `fadeDistance` (0 cuts there; with no `minDistance`,
  nothing fades near the camera), all times `opacity`. A bound where it is gone at or above
  where it is whole makes a step there (`labelRamp`). The shader and `labelFade` do the
  same. First, the named bounds were where a label was gone, and it faded in above them, to
  1.5 and 2 times them: a label 8 pixels high, perfectly readable, was still a third
  faded, and lying flat seen 35° up one had to be 15 pixels face-on to show whole. As seen,
  a label lying flat at a slant reads smaller — by the square root of its facing, not the
  facing itself: its letters are foreshortened across the way it reads, not along it — and
  fades out toward the horizon as it thins to a sliver, which would only shimmer, however
  large it is face-on.
- **Depth**: `depthTest` (default on) hides labels behind the scene. `lift` (world units),
  plus `liftPerDistance` for every world unit from the camera, draws them that much toward
  it, so the surface they lie on does not cut through, far off too. A move of the quad,
  not a depth bias (`polygonOffset` is lost with a logarithmic depth buffer writing
  `gl_FragDepth`, and turns round with a reversed one), so it holds with any depth buffer
  three.js draws with: linear, logarithmic or reversed.
- **The far plane**: a label fades out as its farthest corner along the view goes from 90 %
  to 99 % of the camera's `far` (`LabelLayer` passes it each frame), rather than being
  clipped whole or in part by it. Its farthest corner is half its extent about its middle,
  where its anchor puts it, plus its offset: counted from its position as a whole extent,
  large labels (a time zone's, 1300 km across) faded out 600 km early. From space, beyond a far plane the sky still draws the
  Earth past, labels were cut to pieces that looked like z-fighting. To see labels farther
  out, give the camera a farther plane. Well inside it, too, a label's clip depth is held
  just short of it (`z ≤ 0.999999 w`; `≥ 10⁻⁶ w` with a reversed depth buffer): with a near
  plane far closer than the far one (0.1 m to 3000 km), anything over a few hundred
  kilometres off lies within a float's rounding of the far plane, so the clip test passed
  and failed corner by corner as the view moved — labels flickered, cut through on a
  diagonal, at 1600 km. A logarithmic depth buffer writes its depth from `w`, so only the
  clipping changes there.
- **Too large**: `maxPixels` (default none) is the largest a label is drawn on screen, its
  font face-on, in any sizing: nearer, it is shrunk to it rather than growing. For labels
  sized for far away that come near the camera (the graticule's, 48).

## How it is drawn

- **Atlas** (`label-atlas.ts`): each **glyph**, per character, font (family, weight,
  style) and halo width, is drawn once at `LABEL_RASTER_SIZE` (48 px), however many texts
  use it: its fill's coverage into red, its halo's into green, so colours are the layer's
  and glyphs are shared across layers whatever their colours. Packed on shelves
  (`ShelfPacker`, 4 px gutters) into an RG8 `DataTexture`, mipmapped and filtered
  anisotropically at the renderer's most (`setAnisotropy`, set by its group), so labels
  lying flat and seen at a slant stay sharp along their length. Each glyph's cell and its
  box about its pen are in a float **glyph table** (`glyphTable`, `LABEL_GLYPH_TEXELS` a
  glyph): glyphs added never recompile a shader. Glyphs are kept; when it is full,
  `repack` draws only those of the texts its layers still draw, larger if needed (up to
  8192²), and every layer lays its texts out again (`generation`); still full, a layer
  draws those of its labels whose texts are in, and the group warns once. The discoveries'
  598 names (about 9300 characters, three ways of breaking each) take 69 glyphs in a
  1024² atlas (2 MB); drawn a text at a time, as first done, they needed 8192² (128 MB),
  uploaded whole as it grew: stalls of 81–281 ms as the names came in, none now.
  Uploaded whole once (made anew, packed again, or freed on the GPU) until three tells it
  has (`onUpdate`), then only the rows glyphs were drawn into since. three uploads a range
  a row at a time, counting four elements a texel whatever the format, so a row of the RG
  atlas is queued as `4 × size` from `4 × size × row`.
- **Layout** (`label-text.ts`): a text is laid out glyph by glyph (`layoutLabelText`): each
  character's advance and ink box (`LabelFontMetrics.glyph`), and each pair's kerning as
  the canvas sets them — the pair's width less its two characters' (`kerning`, measured
  once a pair and kept: the font's own pair adjustments, not a table we keep) — plus
  `letterSpacing` between each two, lines `LABEL_LINE_HEIGHT` (1.2 em) apart, aligned by
  the layer's `align`, in a cell `LABEL_CELL_HEIGHT` (1.3 em) a line high and its halo and
  `LABEL_CELL_PADDING` wider each side. A font's metrics are measured once and shared
  (`labelFontMetrics`): the atlas lays out with them, and `GeoLabels` fits polygons with
  them (`labelTextVariants`), so what is fitted is what is drawn. The atlas keeps each
  text's run (`LabelAtlas.text`, `LabelTextRun`): its glyphs with ink, each its index in
  the glyph table, its pen's place along its line and its line; spaces draw nothing.
- **Fonts**: a glyph drawn in a font the page declares (`@font-face`) but has not loaded
  asks the page for it (`document.fonts.load`), and is drawn meanwhile in the next font of
  its family list (the canvas's fallback for a character the font lacks, too). When the
  page tells that a face of a family the atlas draws in is in (`loadingdone`), every font's
  metrics are measured again (`resetLabelFontMetrics`), the atlas draws its glyphs again
  (`repack`), and its layers lay their texts out again. A family the page does not declare
  is the system's: drawn at once. The stylesheet declaring a font must be in before the
  first label is drawn, or the atlas never asks for it.
- **Records** (`label-records.ts`, `label-group.ts`): a record is 16 floats — position and
  its layer's row, normal and own size, reading direction and its text's lines, its text's
  run (its first glyph in the group's runs, how many) and its cell's width and height in
  ems — one for each of a
  label's sources (see [Wrapping and places](#wrapping-and-places)): a label its own
  unless it wraps or has places. In its group's
  float texture (`LABEL_RECORDS_WIDTH` texels a row), a block a layer with room to grow,
  written only when the layer's labels change (or a provider hands over a new array) and
  uploaded by that block's rows alone — once three has uploaded the texture whole
  (`onUpdate`): a texture made anew, laid out again or freed on the GPU is uploaded whole
  first. Uploaded by ranges before then, a newly made GPU texture held those ranges alone,
  the rest zero: the graticule's zone names, their styles written in a frame nothing was
  drawn, vanished for good. The texts' runs are a third float texture (a texel a glyph:
  `LABEL_RUN_FLOATS`), a block a layer as its records, each distinct text of a layer once
  (the graticule's and contours' repeated values share theirs). Each layer's style and
  frame (its world matrix) is a
  row of another (`LABEL_STYLE_TEXELS`), written when they change. All three are a
  `GroupTexture`: uploaded whole, then by row ranges. Each frame its labels
  are placed, the group writes what is drawn — each label's chosen record, its opacity and
  its shrink, 4 floats,
  farthest first — into the instanced attribute of one of its two meshes: those depth
  tested, and those not (`renderOrder` 1001, after). Nothing else is written as the view
  moves, and nothing at all while it is still.
- **Shader** (`shaders/label-vertex.glsl`, `label-fragment.glsl`): its record and its
  layer's style fetched by the record it draws (`texelFetch`), its extent in ems from its
  record; its size on screen
  from its sizing (`labelPixels`), capped at `maxPixels`, and the world size that gives;
  corners from the frame and that size; the fades
  (the same as `labelFade` in `label-geometry.ts`, which the tests check), times its
  opacity as placed; a hidden label is
  collapsed out of the clip volume. A label is one quad: the vertex shader hands on where
  in its text each corner is (ems, after turning it to read left to right) and its run.
  The fragment shader finds its line, then the glyph whose pen is the last at or before
  the pixel by halving the run, and takes the most coverage of it and the two either side
  whose cells may reach it (and of the next line's, where lines' cells meet): so
  neighbouring glyphs' halos join as one outline, as when a canvas strokes a whole text.
  The atlas is read with explicit gradients from the text's ems (`textureGrad`), the same
  for every glyph, so no seams where one meets the next, half a mip finer
  than the footprint asks (2^−0.5), so small text stays crisp rather than heavy, and
  mixes colour and halo from red and green **in display (sRGB) values**, as a canvas does,
  then converts to linear, premultiplied. Mixed in linear light, a label a few pixels
  high, its fill and halo sharing every pixel, read as its fill alone: the halo vanished
  at a distance. Where the atlas is magnified along either way on screen — text larger
  than its 48 px raster, or at a slant, across its length — its coverage is steepened
  about its middle by how fast it changes on screen, so edges stay about a pixel wide
  rather than the texels they span (never softened; minified, untouched, or thin halos far
  off would thin away). Lying flat at a slant, large zone names read hollow without it:
  each pixel's footprint, a long streak through the atlas, crossed their thin strokes and
  left the fill whole only in a thin core, the halo filling the rest. Logarithmic depth
  supported.
- **In the pipeline**: the meshes are scene objects on layers 0 and `LAYERS.OVERLAY`. An
  `OITRenderPass` draws them in its overlay step, after the transparent layers resolve,
  anti-aliased with the frame and depth tested against the opaque scene; transparent
  surfaces in front do not dim them. Without OIT they are ordinary transparent objects
  (`renderOrder` 1000, and 1001 for those not depth tested). They are never picked
  (`LAYERS.NOT_EMITTER`). A scene's own group is put in the scene with its first layer and
  taken out with its last, its GPU resources freed (`LabelGroup.release`) and made anew if
  used again.

## Measured (2026-11-03)

The story's orbit (120 frames, 0.75° a frame), 580 × 454 CSS pixels at 3× (1740 × 1362
drawing buffer), integrated GPU; the labels' CPU time a frame from a CPU profile (the
group's `frame`: providers, records, placement):

| extra labels | frame ms, median / p95 | labels' CPU ms a frame | drawn |
| --- | --- | --- | --- |
| 0 (the story's ~400) | 17.1 / 22.3 | 1.6 | 32 |
| 5 000 | 16.3 / 39.4 | 1.6 | 53 |
| 20 000 | 16.5 / 34.7 | 4.0 | 70 |

The story's grid provider hands over a new array each frame the view moves, so its ~400
labels are written again each time: about 1 ms of the 1.6. Placing 5000 labels in view
takes about 4 ms, 20 000 about 12: the placement budget spreads them over up to four
frames, so the p95 frames are those it falls in. The graticule's ~1900 labels (most out of
view) take about 0.6 ms a frame as the view moves. Only the labels let in are drawn: the
GPU draws tens of quads where it drew every label before (8.1 ms GPU at 20 000, 2026-10-27).

### Why not a canvas over the view

The first version laid labels out and drew them with the canvas 2D API each frame the view
moved. Two costs made it unusable at a thousand labels:

- uploading the full-size canvas to a texture: ~63 ms a frame at 1860 × 1008, however many
  labels, whatever the texture's settings (flip, premultiplied alpha, colour space,
  mipmaps). A canvas laid over the renderer's instead, composited by the browser, removes
  it;
- drawing transformed text: every glyph and its halo rasterized again each frame, ~7 ms a
  thousand labels to record alone, more to rasterize.

The annotations get away with a canvas because theirs holds only anchors and lines, at CSS
resolution; their text is HTML, rasterized once.

## Limits

- Lines are broken at spaces only, never inside a word.
- Moving between a label's places (or line breaks) is a cut, not a fade.
- Texts are laid out a character at a time, not shaped: kerning is the font's (measured a
  pair at a time on the canvas), but ligatures are not drawn, nor scripts whose letters
  join or reorder (Arabic, the Indic scripts); a character made of several code points
  (an emoji sequence, a combining accent) is drawn a code point at a time.
- Magnified far past `LABEL_RASTER_SIZE` on screen, edges stay a pixel wide but corners
  round off, as the raster's: a signed-distance atlas (the glyphs' work) would keep them.
- Placement knows nothing of what hides a label: one behind a hill still keeps others out
  where it lies on screen.
- Layers of different groups are not kept apart, nor drawn in one order: a `<Labels>` of
  its own is its own world.
- Seen from the far side of its plane a label is hidden, never mirrored; turned past the
  vertical, it reads upside down.
- Style is per layer: a label of its own colour, alignment or offset needs a layer of its
  own. Per-label overrides (colour, alignment, offset), camera-facing point labels and
  pointer picking are open.
