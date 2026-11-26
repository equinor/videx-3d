# Camera navigation

`<CameraNavigation>` adds keyboard and mouse navigation on top of the camera's orbit controls:
move around with keys, look around with the mouse, place a new point to orbit about, jump home and
back, and keep views on number keys. Over a [`World`](./georeferencing.md), it also takes you to
the ground or the sea where you click, and Home shows the whole Earth.

It is optional, and it changes nothing until a key is pressed. Every key can be changed.

## Setting it up

It needs drei's `CameraControls` as the scene's default controls (`makeDefault`). With other
controls, or none, it does nothing.

```tsx
import { CameraControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { CameraNavigation } from '@equinor/videx-3d';

<Canvas>
  <CameraControls makeDefault />
  <CameraNavigation />
  {/* the scene */}
</Canvas>;
```

The keys reach it while nothing else on the page has the focus: not while typing in a field, nor
while a button or a control of its own (the `WellMap`'s depth cursor) has it. A click in the view
gives the keys back.

## Keys

| Key | What it does |
| --- | --- |
| W / S | move forward / back, along the view |
| A / D | move left / right |
| ↑ / ↓, PgUp / PgDn | move straight up / down |
| Shift (held) | move four times faster (`sprint`) |
| + / - | double / halve the speed (`speed` is metres a second at 1×) |
| F | fly mode: the mouse turns the view where the camera is. Esc or F leaves it |
| T | target mode: place a new point to orbit about (see below) |
| Alt+click | go to the ground or the sea where you click (over a `World`) |
| Home | the whole Earth over a curved globe; otherwise the view it started in (`home`) |
| Backspace | back to the view before the last jump; again, further back |
| Alt+0–9 | keep the view on that number |
| 0–9 | go to the view kept on that number |
| L | level the horizon, keeping the heading |
| N | face north, keeping the angle to the horizon |
| ? | show or hide the keys over the view |

While you move, the point the camera orbits about is kept `distance` (1 km) ahead, so when you
stop, orbiting turns the view about what is in front of you.

### Fly mode

Press F, and the mouse turns the view without moving the camera: the controls pause, and the
pointer is captured where the browser allows it. The moving keys still work, so this is the way to
fly through a scene. Esc or F leaves fly mode, and orbiting goes on about a point `distance`
ahead.

### Target mode

Press T, and a marker appears `distance` ahead. The arrows move it: ↑ forward along the view, ↓
back toward the camera, ← and → to the sides (Shift faster). Its size is in metres (2% of
`distance`), so it shrinks as it moves away and grows as it comes near; far off, it keeps a few
pixels across. A click, Enter or T makes it the new point to orbit about: the camera stays where
it is and turns to it. Esc cancels.

### Jumps and views

Home, Alt+click, a view kept on a number key, level, north and a new target are jumps: Backspace
goes back to the view before each, up to the last 50. The views on the number keys are kept while
the component is mounted. Ctrl+0–9 is not used, as browsers keep it for switching tabs.

## Over a World

Inside a [`World`](./georeferencing.md), up, down and north are the globe's where the camera is,
and the camera's up follows the globe as you move far, so the horizon stays level.

- **Alt+click** follows the view down to the ground (the `GeoRelief`'s, as drawn) or the sea, and
  goes there: the camera ends up `distance` from that point, about 30° above it, raised further
  where the ground in between would hide it.
- **Home** over a curved globe (`globe` on) shows the whole Earth from 4000 km, orbiting about its
  centre and its poles. Backspace brings you back.

`CameraNavigation` finds the `World` drawn in the same scene, so it can sit outside it, beside the
scene's content.

## Changing the keys

`bindings` changes the default keys (`DEFAULT_CAMERA_BINDINGS`): give an action its keys, or
`false` to turn it off. Actions left out keep theirs.

```tsx
<CameraNavigation
  bindings={{
    forward: ['KeyW', 'ArrowUp'],
    backward: ['KeyS', 'ArrowDown'],
    up: ['KeyE', 'PageUp'],
    down: ['KeyQ', 'PageDown'],
    north: false,
    goThere: 'Shift',
  }}
/>
```

A key is written as:

- a `KeyboardEvent.code` (`'KeyW'`, `'ArrowUp'`, `'PageUp'`, `'Home'`, `'Digit1'`): the key's
  place on the keyboard, the same on any layout;
- or one character, matched as typed (`'+'`, `'?'`): for keys whose place differs between layouts;
- after any modifiers it needs: `'Alt+Digit1'`, `'Ctrl+KeyL'`.

In `saveView` and `recallView`, `#` stands for any digit (`'Alt+Digit#'`). `boost` and `goThere`
are modifiers (`'Shift'`, `'Alt'`, `'Ctrl'`, `'Meta'`), held while moving and while clicking.

## Options

| Prop | Default | |
| --- | --- | --- |
| `bindings` | the keys above | changes to the keys |
| `speed` | 200 | metres a second at 1× |
| `sprint` | 4 | how many times faster with Shift |
| `distance` | 1000 | metres ahead the orbit point is kept while moving, and the marker placed |
| `lookSpeed` | 0.15 | degrees the view turns per pixel in fly mode |
| `home` | the starting view | where Home goes without a curved globe (`{ position, target }`) |
| `enabled` | true | listen to the keys and the pointer |
| `help` | false | show the keys from the start |

## Without React

`CameraNavigator` (from the sdk) does the work, and works with any `CameraControls`:

```ts
import { CameraNavigator } from '@equinor/videx-3d/sdk';

const navigator = new CameraNavigator(camera, controls, { speed: 100 });
const detach = navigator.attach(renderer.domElement);
// each frame, before the controls update:
navigator.update(delta);
// when done:
detach();
```

Its methods (`home`, `previous`, `save`, `recall`, `level`, `faceNorth`, `jump`, `setFlyMode`,
`setTargetMode`) can be called from buttons of your own; a `jump` can be gone back from with
Backspace like any other.
