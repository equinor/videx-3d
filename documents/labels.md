# Labels

Text labels glued to the world: for lines, contours and grids, where the annotations' HTML
labels would be too many and too heavy. A label is painted where it lies, in the plane
square to its normal, as large as its layer's `size` in world units. It never moves, turns
or resizes on its own: it fades out as its plane turns edge-on or grows small on screen,
and is hidden from behind and behind the scene.

```tsx
<Labels>
  <LabelLayer labels={contourLabels} size={30} color="#ffd23f" />
  <LabelLayer provider={gridLabels} size={50} />
</Labels>
```

Example: the `Components/Misc/Labels` story (`src/components/Labels/Labels.stories.tsx`):
contour labels painted on a hill's slope, grid labels at fixed crossings from a provider, a
stress layer (`stressLabels`), a pane of glass and an OIT pipeline (`pipeline: 'oit'`).

## Model

| piece | what it is |
| --- | --- |
| `Label` | `text`, `position`; `normal` (default up: lying flat, read from above); `direction`, the way it reads (default level: up × normal, or +X lying flat) |
| `LabelLayer` | one instanced draw: its labels (`labels`), a `provider`, or both, and its `LabelStyle` as props |
| `LabelsProvider` | `(view) => Label[]`, called when the camera or the view's size changes: which crossings of a grid to label, say |
| `<Labels>` | optional: one text atlas for the layers under it, freed with it. Layers under none share the page's |
| `LabelAtlas` | each distinct text drawn once with the canvas API, into one texture |

Positions, normals and directions are in the layer's frame (its parent's), so a layer can
sit in a group with the data it labels; its `size` stays in world units. Keep a provider
stable (`useCallback` or module level).

## Style

Per layer (`LabelStyle`, defaults in `LABEL_STYLE_DEFAULTS`).

- **Text**: `fontFamily`, `fontWeight`, `fontStyle` (italic), `letterSpacing` (ems; where
  the browser's canvas supports it), `color`; `haloColor` (its alpha kept) and `haloWidth`,
  a fraction of `size`. Font, weight, style, spacing and halo width are drawn into the
  atlas (`labelAtlasKey`); the colours are uniforms, so layers of any colours share texts.
- **Size**: `size`, the font's size (the em) in world units. Nothing else changes it but
  `scaleRef`, an optional live multiplier read each frame and set on the GPU alone (no
  render, nothing written again): for a size that follows the view smoothly, as the
  graticule's `'smooth'` labels do.
- **Placement**: `align` (`'left'` starts the text at its position, `'center'`, `'right'`
  ends it there) and `baseline` (`'top'` hangs it below, `'middle'`, `'bottom'` stands it
  above), by its quad, halo included (`labelAnchor`); then `offset`, `[along, up]` in ems,
  in its plane, so it scales with `size`: a label beside its line or marker.
- **Flip**: `flip` (default off) turns a label to read left to right from wherever it is
  seen: where its way of reading points away from 10° above screen right by more than a
  right angle (`labelReadsBackward`, `LABEL_FLIP_TILT`: so near-vertical text reads
  upward, the map maker's way, and a line straight up the screen does not flip back and
  forth as the view turns by a hair), its text is mirrored both ways inside its own quad —
  turned half round, not moved — so it keeps its place, alignment and offset. Per label,
  in the vertex shader, from where its reading direction projects: nothing is written
  again. The graticule's labels flip by default.
- **Fades**: from behind, never drawn. `minFacing` to `fullFacing` (cosine between the
  normal and the way to the camera; default twice `minFacing`), `minPixels` to
  `fullPixels` (its text's height on screen **as seen**, its slant included: the font
  face-on times the facing cosine, in CSS pixels; default 1.5 times `minPixels`),
  `minDistance` and `maxDistance` softened over `fadeDistance` (0 cuts there; with no
  `minDistance`, nothing fades near the camera), all times `opacity`. A full bound short of
  its least makes a step there (`labelRamp`). The shader and `labelFade` do the same. By
  its height as seen, a label lying flat fades out toward the horizon as it thins to a
  sliver, which would only shimmer — however large it is face-on.
- **Depth**: `depthTest` (default on) hides labels behind the scene. `lift` (world units),
  plus `liftPerDistance` for every world unit from the camera, draws them that much toward
  it, so the surface they lie on does not cut through, far off too. A move of the quad,
  not a depth bias (`polygonOffset` is lost with a logarithmic depth buffer writing
  `gl_FragDepth`, and turns round with a reversed one), so it holds with any depth buffer
  three.js draws with: linear, logarithmic or reversed.
- **The far plane**: a label fades out as its farthest corner along the view goes from 90 %
  to 99 % of the camera's `far` (`LabelLayer` passes it each frame), rather than being
  clipped whole or in part by it. From space, beyond a far plane the sky still draws the
  Earth past, labels were cut to pieces that looked like z-fighting. To see labels farther
  out, give the camera a farther plane. Well inside it, too, a label's clip depth is held
  just short of it (`z ≤ 0.999999 w`; `≥ 10⁻⁶ w` with a reversed depth buffer): with a near
  plane far closer than the far one (0.1 m to 3000 km), anything over a few hundred
  kilometres off lies within a float's rounding of the far plane, so the clip test passed
  and failed corner by corner as the view moved — labels flickered, cut through on a
  diagonal, at 1600 km. A logarithmic depth buffer writes its depth from `w`, so only the
  clipping changes there.
- **Too large**: `maxPixels` (default none) is the largest a label is drawn on screen, its
  font face-on: nearer, it is shrunk to it rather than growing. For labels sized for far
  away that come near the camera (the graticule's, 48).

## How it is drawn

- **Atlas** (`label-atlas.ts`): each text, per font, weight and halo width, is drawn once
  at `LABEL_RASTER_SIZE` (48 px): its fill's coverage into red, its halo's into green, so
  colours are uniforms and texts are shared across layers whatever their colours. Packed
  on shelves (`ShelfPacker`, 4 px gutters) into an RG8 `DataTexture`, mipmapped and
  filtered anisotropically at the renderer's most (`setAnisotropy`, set by `LabelLayer`),
  so labels lying flat and seen at a slant stay sharp along their length. Texts are
  kept; when it is full, `repack` packs only those its layers still draw, larger if needed
  (up to 8192²), and every layer looks its entries up again (`generation`).
- **Instances** (`label-mesh.ts`): a quad per label, 15 floats in one interleaved instanced
  buffer (position, normal, reading direction, atlas rect, size in ems), written only when
  the layer's labels change, or a provider hands over a new array.
- **Shader** (`shaders/label-vertex.glsl`): corners from the frame and `size`; the fades
  (the same as `labelFade` in `label-geometry.ts`, which the tests check); a hidden label is
  collapsed out of the clip volume. The fragment shader reads the atlas half a mip finer
  than the footprint asks (bias −0.5), so small text stays crisp rather than heavy, and
  mixes colour and halo from red and green **in display (sRGB) values**, as a canvas does,
  then converts to linear, premultiplied. Mixed in linear light, a label a few pixels
  high, its fill and halo sharing every pixel, read as its fill alone: the halo vanished
  at a distance. Logarithmic depth supported.
- **In the pipeline**: the meshes are scene objects on layers 0 and `LAYERS.OVERLAY`. An
  `OITRenderPass` draws them in its overlay step, after the transparent layers resolve,
  anti-aliased with the frame and depth tested against the opaque scene; transparent
  surfaces in front do not dim them. Without OIT they are ordinary transparent objects
  (`renderOrder` 1000). They are never picked (`LAYERS.NOT_EMITTER`).

## Measured (2026-10-27)

The story's orbit, 1860 × 1008 drawing buffer, integrated GPU, `videx3d.profile`:

| extra labels | frame GPU ms | frame (orbit) ms, mean / p95 | main thread ms |
| --- | --- | --- | --- |
| 0 (the story's ~250) | 4.1 | 16.7 / 17.6 | 0.7 |
| 1 000 | 4.6 | 16.7 / 17.5 | 0.6 |
| 5 000 | 4.9 | 16.7 / 17.5 | 0.6 |
| 20 000 | 8.1 | 17.3 / 22.4 | 0.5 |

Labels cost nothing on the CPU while they stay the same; a provider's labels are written
again whenever the view changes.

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

- Text only, one line.
- Magnified past `LABEL_RASTER_SIZE` on screen, text grows soft: a signed-distance atlas
  (the glyphs' work) would keep it sharp.
- No overlap handling: labels are where they are put. Space them in the data, or with a
  provider that picks which to show.
- Seen from the far side of its plane a label is hidden, never mirrored; turned past the
  vertical, it reads upside down.
- Style is per layer: a label of its own colour, alignment or offset needs a layer of its
  own. Per-label overrides (colour, alignment, offset), camera-facing point labels and
  multi-line text are open, as is pointer picking.
