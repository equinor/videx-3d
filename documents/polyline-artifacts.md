# Polyline Geometric Defects & Artifacts Taxonomy

This document provides a formal taxonomy and visual reference for pathological geometric features, noise artifacts, and deformation hazards along 2D and 3D polylines.

---

## Interactive Visual Catalog

For an interactive, filtered visual sheet with side-by-side SVG diagrams for every artifact, open the standalone reference:
- [documents/polyline-artifacts.html](documents/polyline-artifacts.html)

---

## 1. Angular & Tangent Discontinuities

### 1.1 Cusp / Needle Reversal
- **Common Names:** Hairpin, Needle, 180° Turn-back, U-turn, Backtracking.
- **Geometric Definition:** Two consecutive segments turn by $\Delta\theta \approx 180^\circ$ over a near-zero arc length ($L \to 0$), reversing heading.
- **Upstream Causes:** Decimation algorithms clipping near colinear points, path-finding loops, unconstrained optimization steps.
- **Downstream Hazards:**
  - Tangent vector calculation collapses: $\mathbf{T}_{i} + \mathbf{T}_{i+1} \approx \mathbf{0}$.
  - Normal/binormal frames flip $180^\circ$, causing ribbons, casings, and extrusion tubes to twist or self-intersect instantly.
- **Remedy:** Prune vertices where $\cos(\Delta\theta) < \cos(\theta_{\text{max\_turn}})$ or replace with a chord bridge.

### 1.2 Kink / Elbow
- **Common Names:** Kink, Elbow, Dog-leg, Sharp break, Acute corner.
- **Geometric Definition:** A localized angular discontinuity where the turn angle $\theta_{\text{turn}}$ exceeds the physical or numerical threshold $\theta_{\text{max}}$ (e.g. wellbore Dogleg Severity limits).
- **Upstream Causes:** Low-resolution survey stations, independent segment stitching, unrelaxed splines.
- **Downstream Hazards:**
  - Geometry pinching on inner radii.
  - Generates sharp creases in smooth-shaded tubes.
- **Remedy:** Fillet with circular arc, Chaikin corner-cutting sub-division, or localized spline re-sampling.

### 1.3 Notch / Dent
- **Common Names:** Notch, Dent, Nock, Bayonet step, Square jog.
- **Geometric Definition:** A localized rectangular or triangular detour that steps away from the trajectory and immediately returns within 1–3 vertices.
- **Upstream Causes:** Sensor glitch, obstacle avoidance jitter, single-pixel boundary tracing noise.
- **Downstream Hazards:**
  - Generates dual self-intersections when parallel offsetting both inward and outward.
- **Remedy:** Morphological opening, Douglas-Peucker simplification, or local convex hull bridging.

---

## 2. Topological Anomalies & Folds

### 2.1 Loop / Pigtail
- **Common Names:** Self-intersection, Pigtail, Bowtie, Figure-8 knot, Knotting.
- **Geometric Definition:** A non-adjacent segment intersection: $\mathbf{e}_i \cap \mathbf{e}_j \neq \emptyset$ for $|i - j| > 1$.
- **Upstream Causes:** Curvature overshoot in parametric fitting, offset curves exceeding local curvature radius.
- **Downstream Hazards:**
  - Reverses polygon winding direction (Counter-Clockwise $\leftrightarrow$ Clockwise).
  - Corrupts triangulation algorithms (Ear Clipping, Delaunay), causing missing or flipped faces.
- **Remedy:** Bentley-Ottmann line sweep intersection resolver; split into independent simple loops.

### 2.2 Accordion Fold
- **Common Names:** Pleat, Accordion, Doubling-back, Multi-pass overlap.
- **Geometric Definition:** Consecutive segments retrace backward collinearly: $\mathbf{e}_i \parallel -\mathbf{e}_{i+1}$.
- **Upstream Causes:** Survey station correction logging, bidirectional path sweeps.
- **Downstream Hazards:**
  - Zero-area degenerate triangles during ribbon skinning.
  - Extreme Z-fighting in rasterizers.
  - Raycaster hit count ambiguities.
- **Remedy:** Arc-length monotonic projection filter, colinear edge collapse.

### 2.3 Overhang / Undercut
- **Common Names:** Monotonicity inversion, Overhang, Undercut, S-bend hook.
- **Geometric Definition:** Path reverses progression along the primary coordinate axis: $\frac{dx}{ds} < 0$.
- **Upstream Causes:** Highly deviated / horizontal drilling trajectories, folded geological boundaries.
- **Downstream Hazards:**
  - Breaks 2.5D heightfields, terrain drapes, and single-valued column-carve passes.
- **Remedy:** Parameterize strictly by cumulative arc-length $s$ or split the polyline into monotonic segments.

---

## 3. Sampling & Metric Noise

### 3.1 Spike / Whisker
- **Common Names:** Spike, Whisker, Barb, Thorn, Rogue vertex, Outlier.
- **Geometric Definition:** A single vertex $\mathbf{p}_i$ displaced at a distance $\|\mathbf{p}_i - \text{proj}(\mathbf{p}_i)\| \gg \sigma$ from neighbor chords.
- **Upstream Causes:** Packet drop / corrupted survey coordinate, division by near-zero matrix determinant.
- **Downstream Hazards:**
  - Inflates AABB and bounding sphere by orders of magnitude, corrupting frustum culling.
  - Produces giant needle triangles.
- **Remedy:** Median filter on vertex coordinates, Ramer-Douglas-Peucker outlier pruning.

### 3.2 Micro-Chatter / Jitter
- **Common Names:** Micro-chatter, Jitter, Sawtooth noise, High-frequency ripples.
- **Geometric Definition:** High-frequency, low-amplitude alternating directional oscillations across successive vertices.
- **Upstream Causes:** Floating-point precision quantization, noisy measurement sensors.
- **Downstream Hazards:**
  - Normal vectors thrash erratically between vertices.
  - Specular noise and noisy lighting artifacts in 3D shaders.
- **Remedy:** Savitzky-Golay filter, moving average smoothing, or Gaussian convolution.

### 3.3 Staircase / Aliasing
- **Common Names:** Staircasing, Manhattan stepping, Taxicab aliasing, Grid snapping.
- **Geometric Definition:** Diagonal paths quantized into alternating $0^\circ / 90^\circ$ orthogonal steps.
- **Upstream Causes:** Raster/voxel grid extraction, integer coordinate truncation.
- **Downstream Hazards:**
  - 5×–10× unnecessary vertex inflation.
  - False $90^\circ$ miter joins along naturally smooth gradients.
- **Remedy:** Visvalingam-Whyatt area-based decimation, RDP simplification with diagonal tolerance.

---

## 4. Extrusion & Offset Phenomena

### 4.1 Swallowtail Pinch
- **Common Names:** Swallowtail, Offset loop, Self-swallow, Caustic loop.
- **Geometric Definition:** Inward offset of a curve at distance $d > R_{\text{curvature}}$, producing a self-crossing loop.
- **Upstream Causes:** Parallel curve offsetting, buffer polygon generation around sharp bends.
- **Downstream Hazards:**
  - Creates self-intersecting ribbons with overlapping inverted geometry.
- **Remedy:** Clipper2 polygon offsetting, Voronoi Medial Axis Transform (MAT).

### 4.2 Miter Spike / Horn
- **Common Names:** Miter spike, Horn, Beak, Corner blowout.
- **Geometric Definition:** Miter length diverges to infinity as turn angle approaches $180^\circ$:
  $$d_{\text{miter}} = \frac{w}{\sin(\theta / 2)} \xrightarrow{\theta \to 0} \infty$$
- **Upstream Causes:** Extruding thick ribbons or fence corridors around acute angle corners.
- **Downstream Hazards:**
  - Miter tip shoots across the scene, piercing unrelated geometry or camera frustums.
- **Remedy:** Miter limit clamping (e.g. $d \le 3w$) with automatic Bevel or Round join fallback.

### 4.3 Coincident Points / Degenerate Segments
- **Common Names:** Coincident points, Zero-length segment, Vertex clump.
- **Geometric Definition:** Consecutive vertices where $\|\mathbf{p}_{i+1} - \mathbf{p}_i\| \le \varepsilon$.
- **Upstream Causes:** Duplicate data points, uncleaned survey tables.
- **Downstream Hazards:**
  - Division by zero in unit tangent calculation: $\mathbf{T} = \frac{\Delta\mathbf{p}}{0} \to \text{NaN}$.
  - Degenerate zero-area triangles crashing physics/raycast structures.
- **Remedy:** Epsilon deduplication pass (`dedupePolyline2D/3D`).
