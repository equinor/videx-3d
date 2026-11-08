# The void's hollow

Under a `Scenery`'s seabed the camera is in the rock. To show the data that lies there (wells,
horizons, reservoirs) the solid is turned inside out: the rock becomes an open gap and the
data shows solid in it. By default that gap is a **hollow**, a crater in the crust about the
field, rather than the bottomless gradient of the plain void. It should be plain at once that
you are under the seabed, and the hollow should frame the data without competing with it:
dark, dull rock that gives scale and depth.

```tsx
<Scenery>
  <SceneryOcean seabed={false} />
  <SceneryAbyss hollow={{ radius: 400000, pulse: 0.1 }} />
</Scenery>
```

`hollow={false}` keeps the plain void: the endless lid and the bottomless gradient
([scenery.md](./scenery.md#the-void-sceneryabyss)).

## Design (decided)

- **A crater, a fixed size, centred on the field** (the `World`'s anchor, the globe's disc). It
  is 500 km across the rim (`radius`) and 35 km deep (`floorDepth`), down to the mantle's
  cooled top. From the sea over the field its rim lies at the horizon. Its size never follows
  the camera.
- **The seabed is its lid.** With the seabed on, the hollow is shut and nothing changes from
  above. Peeling it (`SceneryOcean`'s `seabed={false}`) opens it: the relief and the sea's
  seabed are cut away inside the rim and kept whole around it, so the opening is a hole in the
  ground, not a missing ground.
- **Real geometry with baked textures**, no ray marching: walls and floor are meshes, shaded
  from two textures baked once on the GPU.
- **Nothing re-bakes or recompiles** when the seabed is peeled, the camera flies into the
  hollow, or any of its look changes: those are uniforms. The bakes (environment, light probe)
  never see the hollow or the peel (`scenery-baker.ts` overrides both).
- **Past its walls and under its floor the void is solid rock:** black below the horizon, with
  the hollow's lid overhead, the same lid as inside the rim.

## Geometry (`scenery-hollow.ts`)

Built once on the CPU in 64-bit floats about the globe's disc centre, and placed in the shader
at `uGlobeDisc.xyz + position`, so far points keep their precision (`hollow-vertex.glsl`). It is
built again only when the globe, the radius, the floor depth or the seabed's height changes.

- **The rim** wanders in and out of the radius by some 6% (`SCENERY_HOLLOW_RIM`, 11 waves), in
  broad bays and a ragged edge. The CPU (`sceneryHollowInside`) and the GPU (`hollowInside`,
  `hollow.glsl`) share it: the walls are built along it, and the relief and the seabed are cut
  along it.
- **The walls** (`sceneryHollowWallAt`): 1024 columns round the rim and 72 rows down. They have
  terraces, buttresses about 60 km apart and 15 km proud, broad spurs, gullies about 45 km
  apart, and an apron of fallen rock onto the floor. The buttresses and gullies drift round
  the rim as they go down, jog at each terrace and swell and thin, so their flanks are never
  slabs the full height of the wall. Insets and depths never shrink down a column, so the face
  never leans out over itself. The columns stand 3 m outside the rim, so the relief cut leaves
  no crack. Each vertex carries how open it is to the hollow (`hollowOpen`), 0 in a crease.
- **The walls are 16 sectors** (`SCENERY_HOLLOW_WALL_SECTORS`), runs of one index over one set of
  attributes, each culled against the frustum's sides each frame (`SceneryHollowParts.cull`).
  Placed in the shader, three cannot cull them itself.
- **The floor:** 48 rings out to the walls' foot, each with a power of two of segments (8 up to
  1024, the walls' columns at the foot), and a gentle swell (1.2 km over 70 km). Seen from
  above it is drawn one-sided, so from under it it never hides the data.
- **The relief:** its tiles wholly inside the rim's furthest reach are not drawn while the
  hollow is open and the camera is over the ground (`sceneryHollowHoldsTile`). They are still
  handed to the layers draped on it. Near the rim each pixel is cut in `relief-fragment.glsl`.

## Look

### Styles

`style` sets the look, and what the colours, `embers`, `pulse` and `air` default to; anything
set on the hollow overrides it. A uniform (`uHollowLook.z`): switching recompiles nothing.

| | `calm` (default) | `molten` | `simple` |
|--|--|--|--|
| Walls | the crust in section, `#3d3f41`, the bands' warm/cool shift a third (`HOLLOW_CALM_HUE`) | the crust in section, `#42403d`, warmer bands, a warmer top | one even slope (`SIMPLE_SLOPE`), matte `#7c7d7e`, a line every 5 km of depth, a shadow under the rim |
| Floor | grey rock, its fissures dark cracks (`HOLLOW_CALM_CRACKS`), as light as the walls' foot (`HOLLOW_CALM_FLOOR`) | the mantle's cooled top: charcoal, brown and rust, its fissures glowing and pulsing | flat `#252525`, a ring every 50 km |
| Rim | — | — | a ring a few pixels wide on the ground (`HOLLOW_SIMPLE_RIM`) |
| Warmth from below | none | on the walls and the lid | none |
| Lid | the sediments' underside, mottled | the same, faintly warm | plain `#b0b0b0` (`colors.lid`), a soft shade toward the walls (`HOLLOW_SIMPLE_LID_EDGE`) |
| Air over the opening | dulled, 0.35 left | dulled, 0.1 left | untouched (`air` 1, no dulled sky) |
| `embers`, `pulse`, `air` | 0, 0, 0.35 | 1, 0.2, 0.1 | 0, 0, 1 |

The calm one is the sober backdrop for engineers; the molten one the dramatic one; the simple
one a diagram, as the cutaway is an illustration (`HOLLOW_SIMPLE_*` in `hollow-fragment.glsl`).
Its geometry is built apart (`SceneryHollowShape.simple`): switching to or from it rebuilds the
geometry once, nothing else. A faint grain from the baked rock (`HOLLOW_SIMPLE_GRAIN`, ±6%) keeps
its floor, walls and lid from looking flat close up; the mips average it out far off.

#### The radius grips (simple style)

`handle` puts four grips on the rim, at its true east, north, west and south: small cubes, as
large on screen at any distance (7 drawing-buffer pixels, a little wider than the rim's ring),
centred on the ring, each under an invisible element that takes the pointer
(`SceneryHollowGrip`, on the cutaway's `SceneryCutawayHandle`). Cubes rather than flat marks:
they read the same from any angle and point no way in particular. Dragging any
draws a ghost ring at sea level under the pointer, the hollow left as it is; on release the
hollow takes the radius, its geometry rebuilt once, and `onRadiusChange` reports it. A double
click puts the default radius back. The radius is kept between the walls' reach plus 20 km and
1500 km (`sceneryHollowRadiusRange`); the dragged one holds until the `radius` prop changes.

### Parts

- **Textures** (`src/sdk/materials`): `createRockTexture` (512², slope, shade, a crack network)
  and `createCliffTexture` (1024², shade, normal, openness), each drawn once by `bakeTexture`
  after its program has compiled (drawing a compiling program stalls Chrome's GPU process).
  Both together take 50–100 ms when nothing else is compiling.
- **The floor:** charcoal, brown and rust blotches some hundreds of km across, with rock at
  three sizes. Each size is read with its square shifted by region (Quílez's texture
  repetition, technique 3), so no lattice shows. The two largest sizes are read per vertex
  (`vHollowLarge`). Glowing fissures at three sizes; a warm glow only seen face on and dull grey
  at a slant (`HOLLOW_FACE_ON`, a Fresnel-like term); cooling to grey rubble toward the walls.
  It darkens close up (`HOLLOW_NEAR_FLOOR`) and recedes into the void's dark with distance
  (`HOLLOW_VEIL`, 200 km), so it looks vast, not reachable.
- **The walls:** the crust in section, in one warm grey. The sea's seabed's hue along the cut's
  top (`HOLLOW_TOP_LIGHT`, `HOLLOW_TOP_DEPTH`), folded sediment bands below it telling apart
  mostly by their shade (`HOLLOW_BAND_CONTRAST`, `HOLLOW_BAND_HUE`), mottled granite, darker
  basalt, rubble on the aprons. The baked cliffs give their columns and ledges.
- **The embers pulse:** the glow in the fissures, its warmth on the walls and on the lid dim by
  up to `pulse` (default 0.2) in two slow waves of 7 s and 17 s
  (`SCENERY_HOLLOW_PULSE_PERIODS`). Each wave rolls across the hollow, one about every
  250 km (`HOLLOW_PULSE_SPAN`), and the mantle's blotches put neighbouring patches out of step
  (`HOLLOW_PULSE_MOTTLE`). It moves only while frames are drawn.
- **No sky haze on the hollow.** The sky's haze is blue: over the dark walls even a tenth of it
  turned them blue (tried, removed). Any haze added later must be the hollow's own dark grey.

## Light (`hollowLight`, `hollow-look.glsl`)

- **Open:** a light raking from the opening at the subsurface light's bearing, 28° up, falling
  with depth (`lightFalloff`; on the walls a quarter as fast near the top, `HOLLOW_WALL_LIGHT`,
  handing over to the floor's down the face). The sky from above, as much as a face sees the
  opening. A fill the hollow keeps at any depth (`HOLLOW_FILL`). The floor's warmth from below
  (`HOLLOW_WARMTH_FOLD`).
- **The walls' faces** are lit by a blend of the face toward the hollow's axis and the mesh's
  own, `HOLLOW_WALL_SHAPE` (0.4) of the mesh's turn. Lit by the mesh's normals alone, the
  buttresses' flanks and the terraces' lips fell into dark rectangles under a light from one
  side. The rake wraps all the way round on the walls (`HOLLOW_WALL_WRAP`). They darken toward
  the floor from the top (`HOLLOW_WALL_DUSK`), deeper in their creases.
- **Shut** (the seabed in place, or the camera under the lid; `uHollowView.y`, eased over
  0.3 s): no rake and no sky, but light scattered about the hollow (`HOLLOW_SCATTER`), a little
  more onto faces up. The walls keep 35% of their light (`HOLLOW_SHUT_WALL`) and darken more
  toward their top, in one shaded corner with the lid.

## The lid

While the hollow is on, the lid is the same everywhere: the seabed's underside, the sediments'
underside, mottled at three sizes and rippled as the plain lid is, with faint relief lit from the
hollow's middle (`hollowLid`, used by `skyAbyssCeilingOver` for the sky, the relief's underside
and the stage alike). Inside the rim it curves down with the globe to meet the walls
(`skyAbyssLidCurved`); past the rim it lies level over the camera. Crossing the rim under the
seabed changes nothing overhead. The relief draws it near the field, the background beyond.

- It darkens with distance from the camera, to 45% over 60 km (`HOLLOW_LID_FADE`), and toward
  the walls from above the field, to 40% at the rim (`HOLLOW_LID_EDGE`), so it reads as one
  surface down to the walls, not a black band. Past the rim it stays as it is at the rim.
- The floor's warmth on it is faint and half grey (`HOLLOW_LID_WARM`), fading out within 20 km
  past the rim (`HOLLOW_LID_PAST`), where there is no floor below.
- It switches on exactly where the camera passes through the seabed, as the relief flips to
  its underside there. A fade-in was tried and removed: half faded, the layers meant for above
  the seabed showed through it.

## Over the opening

- The sky over the open hollow is greyed and dimmed (`hollowDullSky`) so the eye goes down into
  the hollow.
- **Its air drains into the void:** all but `air` of it over the opening (0.35 calm, 0.1
  molten), thinning over a band 0.4 of the radius wide outside the rim (`HOLLOW_AIR_BAND`). The
  ground there loses the sky's light (to `HOLLOW_AIR_GROUND`) and its haze, and the sky about a
  camera low over the opening darkens toward space's (`sceneryHollowAirGone`, fading out between
  50 and 150 km up).
- Views down into the opening see the sky mirrored about the horizon (`skyAir`), not the ground
  the sky paints below it. From at or below the sea's level, inside the rim, every view down is
  into the opening.

## From outside and below

- **Past the walls**, under the seabed, the camera is in the rock: the hollow is not drawn, the
  hollow's own lid is overhead (as inside the rim) and the void below the horizon is black
  (`Scenery` sets the plain void's horizon and depth colours black while the hollow is on).
- **Under the floor**, the hollow and its lid stay drawn, seen through the rock: each view is
  dimmed by the length of rock it crosses under the floor, by e every 30 km
  (`HOLLOW_ROCK_FADE`), never below 15% (`HOLLOW_ROCK_KEPT`). The path is zero at the floor, so
  crossing it shows no step.

## Cost

Measured at 1280×800 on the development laptop's integrated GPU, each part drawn alone and
interleaved before/after (the per-group profiler swung up to 2×):

| Part | Cost |
|--|--|
| Floor, fragments | about 0.4 ms at the field view, inside or straight down (was 0.8–0.9 ms with 12 reads; now 7) |
| Floor, vertices | about 0.13 ms (20.6k triangles, was 80k) |
| Walls | 0.3–0.6 ms, 4–6 of 16 sectors drawn from the field |
| Relief | about 2.9 ms saved at the field view by not drawing the tiles inside the opening (173 → 1) |
| Sky | cheaper than the plain void with the seabed peeled: the hollow covers the background (1.5 against 9.6 ms at a regional view) |

## Open

- Water over an open hollow: the sea's surface seen from below the opening.
- Faint ember motes rising when the camera is under the floor (parked).
- Whether a peeled seabed should keep the land with the hollow off (today the relief is hidden
  everywhere, the plain void's old rule, `GeoRelief.tsx`).
