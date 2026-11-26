/**
 * Keys for {@link CameraNavigator}: which keys do which camera action, written as text so a host
 * can change them.
 *
 * @module
 */

/**
 * A key, as {@link CameraNavigationBindings} write it: a `KeyboardEvent.code` (`'KeyW'`,
 * `'ArrowUp'`, `'PageUp'`, `'Home'`), or one character matched as typed (`'+'`, `'?'`: the same
 * on any keyboard layout), after the modifiers it needs (`'Alt+Digit1'`, `'Ctrl+KeyL'`). In
 * `saveView` and `recallView`, `#` stands for any digit: `'Alt+Digit#'`.
 *
 * @group Managers
 */
export type CameraKey = string;

/**
 * A modifier held with the pointer: `boost` while moving, `goThere` while clicking.
 *
 * @group Managers
 */
export type CameraModifier = 'Shift' | 'Alt' | 'Ctrl' | 'Meta';

/**
 * The actions of {@link CameraNavigator} that keys do.
 *
 * - held: `forward`, `backward`, `left`, `right`, `up`, `down` (the camera) and `targetForward`,
 *   `targetBackward`, `targetLeft`, `targetRight` (the marker, in target mode);
 * - pressed: the rest.
 *
 * @group Managers
 */
export type CameraNavigationKeyAction =
  | 'forward'
  | 'backward'
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'faster'
  | 'slower'
  | 'flyMode'
  | 'targetMode'
  | 'targetForward'
  | 'targetBackward'
  | 'targetLeft'
  | 'targetRight'
  | 'targetSet'
  | 'cancel'
  | 'home'
  | 'previous'
  | 'saveView'
  | 'recallView'
  | 'level'
  | 'north'
  | 'help';

/**
 * Which keys do what, for {@link CameraNavigator}: each action's keys, and the modifiers held
 * to move faster (`boost`) and to go where you click (`goThere`). `null` turns one off.
 *
 * @group Managers
 */
export type CameraNavigationBindings = Record<
  CameraNavigationKeyAction,
  CameraKey[]
> & {
  boost: CameraModifier | null;
  goThere: CameraModifier | null;
};

/**
 * Changes to the default bindings: an action's keys (one, or a list) or `false` to turn it
 * off; actions left out keep theirs.
 *
 * @group Managers
 */
export type CameraNavigationBindingsInput = {
  [A in CameraNavigationKeyAction]?: CameraKey | CameraKey[] | false;
} & {
  boost?: CameraModifier | false;
  goThere?: CameraModifier | false;
};

/**
 * The default keys of {@link CameraNavigator} (see documents/camera-navigation.md).
 *
 * @group Managers
 */
export const DEFAULT_CAMERA_BINDINGS: Readonly<CameraNavigationBindings> = {
  forward: ['KeyW'],
  backward: ['KeyS'],
  left: ['KeyA'],
  right: ['KeyD'],
  up: ['ArrowUp', 'PageUp'],
  down: ['ArrowDown', 'PageDown'],
  faster: ['+'],
  slower: ['-'],
  flyMode: ['KeyF'],
  targetMode: ['KeyT'],
  targetForward: ['ArrowUp'],
  targetBackward: ['ArrowDown'],
  targetLeft: ['ArrowLeft'],
  targetRight: ['ArrowRight'],
  targetSet: ['Enter', 'NumpadEnter'],
  cancel: ['Escape'],
  home: ['Home'],
  previous: ['Backspace'],
  saveView: ['Alt+Digit#', 'Alt+Numpad#'],
  recallView: ['Digit#', 'Numpad#'],
  level: ['KeyL'],
  north: ['KeyN'],
  help: ['?'],
  boost: 'Shift',
  goThere: 'Alt',
};

/** The default bindings with `changes` over them. */
export function resolveCameraBindings(
  changes: CameraNavigationBindingsInput = {},
): CameraNavigationBindings {
  const bindings = { ...DEFAULT_CAMERA_BINDINGS } as CameraNavigationBindings;
  for (const [action, value] of Object.entries(changes)) {
    if (value === undefined) continue;
    if (action === 'boost' || action === 'goThere') {
      bindings[action] = value === false ? null : (value as CameraModifier);
      continue;
    }
    bindings[action as CameraNavigationKeyAction] =
      value === false
        ? []
        : Array.isArray(value)
          ? [...value]
          : [value as CameraKey];
  }
  return bindings;
}

/** The modifier keys held, as a keyboard or pointer event has them. */
export type CameraModifiers = {
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
};

/** A key press, as a `KeyboardEvent` has it. */
export type CameraKeyPress = CameraModifiers & { code: string; key: string };

/** A {@link CameraKey}, read. */
export type ParsedCameraKey = {
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
  /** a `KeyboardEvent.code`; for a digit pattern, the part before `#` */
  code?: string;
  /** a character, matched as typed */
  key?: string;
  /** `#` stands for a digit */
  digit: boolean;
};

const MODIFIER_NAMES: Record<string, 'shift' | 'alt' | 'ctrl' | 'meta'> = {
  shift: 'shift',
  alt: 'alt',
  ctrl: 'ctrl',
  control: 'ctrl',
  meta: 'meta',
};

/** Read a {@link CameraKey}: its modifiers, and its code or character. */
export function parseCameraKey(token: CameraKey): ParsedCameraKey {
  const parsed: ParsedCameraKey = {
    shift: false,
    alt: false,
    ctrl: false,
    meta: false,
    digit: false,
  };
  // `+` is a key of its own, alone or last (`Ctrl++`).
  let base: string;
  let modifiers: string[];
  if (token === '+') {
    base = '+';
    modifiers = [];
  } else if (token.endsWith('++')) {
    base = '+';
    modifiers = token.slice(0, -2).split('+');
  } else {
    const parts = token.split('+');
    base = parts.pop() ?? '';
    modifiers = parts;
  }
  for (const name of modifiers) {
    const modifier = MODIFIER_NAMES[name.toLowerCase()];
    if (modifier) parsed[modifier] = true;
  }
  if (base.length === 1) parsed.key = base.toLowerCase();
  else if (base.endsWith('#')) {
    parsed.code = base.slice(0, -1);
    parsed.digit = true;
  } else parsed.code = base;
  return parsed;
}

/**
 * Whether `press` is `key` as pressed: its base key, and Ctrl, Alt and Meta exactly as it asks;
 * Shift only where it asks for it (so `'?'`, typed with Shift on most layouts, still matches).
 *
 * @returns the digit for a digit pattern, `true` for another match, `false` for none
 */
export function matchCameraKey(
  key: ParsedCameraKey,
  press: CameraKeyPress,
): number | boolean {
  if (key.ctrl !== press.ctrlKey) return false;
  if (key.alt !== press.altKey) return false;
  if (key.meta !== press.metaKey) return false;
  if (key.shift && !press.shiftKey) return false;
  if (key.key !== undefined) return press.key.toLowerCase() === key.key;
  if (key.digit) {
    if (!key.code || !press.code.startsWith(key.code)) return false;
    const digit = press.code.slice(key.code.length);
    return /^[0-9]$/.test(digit) ? Number(digit) : false;
  }
  return press.code === key.code;
}

/**
 * Whether one of an action's keys is held, by the codes held down (each with the character it
 * typed): for the held actions, whatever modifiers are held with it.
 */
export function heldCameraKey(
  keys: readonly ParsedCameraKey[],
  held: ReadonlyMap<string, string>,
): boolean {
  for (const key of keys) {
    if (key.code !== undefined && !key.digit) {
      if (held.has(key.code)) return true;
    } else if (key.key !== undefined) {
      for (const typed of held.values())
        if (typed.toLowerCase() === key.key) return true;
    }
  }
  return false;
}

/** A {@link CameraKey} for people: `'KeyW'` as `W`, `'ArrowUp'` as `↑`, `'Digit#'` as `0–9`. */
export function describeCameraKey(token: CameraKey): string {
  const key = parseCameraKey(token);
  const parts: string[] = [];
  if (key.ctrl) parts.push('Ctrl');
  if (key.alt) parts.push('Alt');
  if (key.meta) parts.push('Meta');
  if (key.shift) parts.push('Shift');
  let base = key.key ?? key.code ?? '';
  if (key.digit) base = key.code === 'Numpad' ? 'Num 0–9' : '0–9';
  else if (key.code) {
    base = key.code
      .replace(/^Key/, '')
      .replace(/^Digit/, '')
      .replace(/^Numpad(\d)$/, 'Num $1')
      .replace('ArrowUp', '↑')
      .replace('ArrowDown', '↓')
      .replace('ArrowLeft', '←')
      .replace('ArrowRight', '→')
      .replace('PageUp', 'PgUp')
      .replace('PageDown', 'PgDn')
      .replace('Escape', 'Esc')
      .replace('NumpadEnter', 'Num Enter');
  }
  parts.push(base);
  return parts.join('+');
}

/** Whether a key event's target is somewhere the user types or works a control of its own. */
export function isControlTarget(target: EventTarget | null): boolean {
  const element = target as {
    tagName?: string;
    isContentEditable?: boolean;
    tabIndex?: number;
    getAttribute?: (name: string) => string | null;
  } | null;
  if (!element || typeof element.tagName !== 'string') return false;
  if (element.isContentEditable) return true;
  const tag = element.tagName.toUpperCase();
  if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(tag)) return true;
  // Something made focusable to take keys of its own (a depth cursor, a slider).
  const tabindex = element.getAttribute?.('tabindex');
  return tabindex != null && !['BODY', 'HTML', 'CANVAS'].includes(tag);
}
