# Relief: land and seabed beyond the stage

A `SkyBoxStage` can put land and seabed from your own elevation data around the scene: a
`relief`. Below sea level it is the seabed, seen through the water as the stage's own
seabed is; above sea level it is land, lit by the sky's sun and fading into the air as the
far sea does. It continues to the sea's horizon and, with the sky's `curvedHorizon`, falls
away with the Earth's curve, so coasts and mountains stand on the horizon where they
should. It is off by default.

```tsx
<Sky ocean={{ level: 0, depth: 120 }}>
  <SkyBoxStage
    bounds={[minX, minZ, maxX, maxZ]}
    occupant={{ seabed }}
    relief={{
      id: 'my-relief',
      // the UtmArea's map; reliefFrameAt(longitude, latitude) for a scene placed by a point
      frame: { projection: crs.utmDef, origin: crs.originUtm },
      color: 'ramp',
    }}
  />
</Sky>
```

## Data

The relief comes from the store, as two data sets (see [Data](./data.md)):

- `relief-meta`: a `SurfaceMeta` record — a grid header and the grid's `projection`
  (a proj4 definition, or a name proj4 knows, such as `EPSG:4326` for longitude/latitude).
- `relief-values`: a `Float32Array`, one value per grid node, row-major from the northern
  row, as `surface-values` are: metres above mean sea level, positive up, negative below,
  `NaN` where there is none.

One grid holds both land and seabed. Global grids that run from the deepest seabed to the
mountain tops exist: ETOPO 2022 (NOAA, public domain) and GEBCO. The detail is the
host's: the relief is as fine as its grid near the scene, but no finer than the GPU's
texture size allows over the area it covers.

The `skyRelief` generator (`generateSkyRelief`) reads the grid where the generators run,
so the stage needs a `GeneratorsProvider`. It resamples the grid onto the scene with
`resampleRelief` (sdk): around the stage, out to the camera's far plane and at least
2000 km (the sea's horizon from some 300 km up), as an RG half float texture of height
times coverage and coverage, with its mip levels.

`frame` says where the scene lies on the map: the projection it is drawn in and the map
coordinates of its origin, as a `UtmArea` places a scene (scene X east, scene Z south).
`reliefFrameAt(longitude, latitude)` gives a transverse Mercator map about a point, for a
scene placed by its longitude and latitude only.

### The demo relief

The stories' store holds `etopo-2022-nordic`: ETOPO 2022 (ice surface) from 12°W to 32°E
and 49°N to 72°N — Norway, Denmark, the British Isles and the North Sea — averaged to 2
arc-minutes (1320 x 690, 3.6 MB). `scripts/generate-relief.js` crops it from NOAA's
server into `public/relief/`, outside `public/data`, which `generate-data` replaces.

## How it fits the stage

- The stage keeps its own seabed over its own area — `bounds`, and an occupant's near
  rectangle with its falloff — where it can be see-through (`seabedOpacity`). The relief
  lies beyond that area and is always opaque.
- Around the area the relief rises from the stage's flat seabed over `falloff` (default
  10000), so the two meet level. The occupant's seabed eases into the flat seabed as
  before (`seabedFalloff`).
- Under a relief the sea stays flat over the disc holding the whole area, and the stage's
  sea surface writes the depth of the curved sea, so land beyond the scene meets it there.
- `color`: a colour is the land's, the seabed taking the sea's; `'ramp'` colours the land
  by height — green lowland, umber at 600 m, grey high ground at 1500 m, eased between —
  and
  darkens the sea's seabed colour with depth, to half 600 m below the stage's own seabed.
- The coast follows the height map per pixel, not the triangles: they miss the curved
  sea by up to tens of metres where they are coarse, so the map decides which shows.
  Seabed stays behind the sea over it, and where the view would meet the sea over land
  the land comes in front.
- Land, and a dry seabed, fade through the air as the sea does, channel by channel and
  blue a little fastest: into the sky's blue over short paths and the horizon's colour
  over long ones, so distant land turns blue before it fades into the horizon, but keeps
  its own colour in most views.
- `debug.hide: ['relief']` hides it, like the stage's other layers.

## The far plane

The stage, and the relief's mesh with it, reach 80% of the camera's far plane, measured
along the curved sea; past that the sky's own sea takes over, and the curved sea's depth
is clamped. Where the sea's horizon lies farther, a fullscreen layer at the far plane
draws the relief on past the mesh: what the map holds above the sea (without water, the
seabed too), shaded and faded through the air as the mesh is, but flat on the curved sea,
so mountains past the mesh show no outline against the sky. It draws only where nothing
nearer is drawn, and is hidden while the mesh reaches the horizon.

For mountains on the horizon, set the far plane past it from the highest the camera goes:
about 360 km from 10 km up, 760 km from 45 km and 1130 km from 100 km (the sky stories
use 3000 km). With a logarithmic depth buffer that costs almost nothing (about 1 m of
depth resolution at 1000 km); with a standard one, a far plane that far from a near plane
of centimetres has no resolution left, so use a logarithmic or reversed depth buffer.
Either way the GPU clips by the ordinary clip depth, which that far from a near plane of
centimetres rounds past the far plane and drops vertices at random: the mesh keeps its
vertices just inside it.
However far the far plane, the relief is drawn no farther than the curved sea's horizon
from the camera, plus the highest relief's own.

## Level of detail

The relief is drawn as one patch of a 32 x 32 grid per node of a quadtree around the
camera (CDLOD, `selectTerrainNodes` in the sdk), in one instanced draw. The finest nodes
are as fine as the relief's texels; each level up is twice as coarse and reaches twice as
far, and toward the end of its range a node morphs into its parent's grid, so levels
meet without cracks. Heights are read in the vertex shader, as coarsely as the grid they
are drawn on; the slope for the lighting is read per pixel. Typically under a hundred
nodes, about 200k triangles.

## Limits

- Beyond the stage's reach (see The far plane) the sky's own flat seabed and sea take
  over, with the relief drawn flat over them: its land, and without water its seabed too.
  A dry seabed view shows that edge.
- The sea's curve is measured from the scene along each view, so the farther the camera
  is from the scene, the more the ground under it falls away: hundreds of kilometres out,
  a camera a few kilometres up is far above the land below it.
- The environment bakes do not include it.
- ⚠️ It assumes the default `up` (+Y), as the stage does.
