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
- **Size**: `size`, the font's size (the em) in world units. Nothing else changes it.
- **Placement**: `align` (`'left'` starts the text at its position, `'center'`, `'right'`
  ends it there) and `baseline` (`'top'` hangs it below, `'middle'`, `'bottom'` stands it
  above), by its quad, halo included (`labelAnchor`); then `offset`, `[along, up]` in ems,
  in its plane, so it scales with `size`: a label beside its line or marker.
- **Fades**: from behind, never drawn. `minFacing` to `fullFacing` (cosine between the
  normal and the way to the camera; default twice `minFacing`), `minPixels` to
  `fullPixels` (the font on screen, in CSS pixels; default 1.5 times `minPixels`),
  `minDistance` and `maxDistance` softened over `fadeDistance` (0 cuts there; with no
  `minDistance`, nothing fades near the camera), all times `opacity`. A full bound short of
  its least makes a step there (`labelRamp`). The shader and `labelFade` do the same.
- **Depth**: `depthTest` (default on) hides labels behind the scene; `lift` (world units)
  draws them that much toward the camera, so the surface they lie on does not cut through.

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
