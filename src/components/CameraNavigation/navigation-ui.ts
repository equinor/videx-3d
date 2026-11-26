import {
  type CameraKey,
  type CameraNavigationBindings,
  describeCameraKey,
} from '../../sdk/managers/camera-bindings';
import {
  CAMERA_NAVIGATOR_NOTICE,
  type CameraNavigatorState,
} from '../../sdk/managers/CameraNavigator';

const BOX = {
  position: 'absolute',
  zIndex: '20',
  font: '12px sans-serif',
  color: '#fff',
  background: 'rgba(0, 0, 0, 0.6)',
  borderRadius: '4px',
  pointerEvents: 'none',
  whiteSpace: 'nowrap',
} as const;

const MODE_TEXT = {
  fly: 'Fly mode: the mouse turns the view. Esc or F leaves it.',
  target:
    'Target: the arrows move it, Shift faster. Click, Enter or T sets it; Esc cancels.',
} as const;

// Each row of the keys shown: what it does, and its keys.
function helpRows(
  bindings: CameraNavigationBindings,
  goThere: boolean,
): [string, string][] {
  const keys = (list: CameraKey[]) =>
    [...new Set(list.map(describeCameraKey))].join(' ');
  const rows: [string, string][] = [];
  const row = (label: string, ...lists: CameraKey[][]) => {
    const text = lists.map(keys).filter(Boolean).join(' / ');
    if (text) rows.push([label, text]);
  };
  row('Move', [
    ...bindings.forward,
    ...bindings.left,
    ...bindings.backward,
    ...bindings.right,
  ]);
  row('Up, down', [...bindings.up, ...bindings.down]);
  if (bindings.boost) rows.push(['Faster while held', bindings.boost]);
  row('Speed ×2, ÷2', bindings.faster, bindings.slower);
  row('Fly mode: the mouse turns the view', bindings.flyMode);
  row('Target mode: place a new target', bindings.targetMode);
  if (goThere && bindings.goThere)
    rows.push(['Go to the ground or sea', `${bindings.goThere}+click`]);
  row('Home', bindings.home);
  row('Back to the view before', bindings.previous);
  row('Save a view, go to it', bindings.saveView, bindings.recallView);
  row('Level the horizon', bindings.level);
  row('Face north', bindings.north);
  row('Show or hide these keys', bindings.help);
  return rows;
}

/**
 * What a `CameraNavigation` shows over the canvas: a notice (the speed, a view saved), what the
 * mode is, and the keys.
 */
export class NavigationUi {
  private readonly notice: HTMLDivElement;
  private readonly mode: HTMLDivElement;
  private readonly help: HTMLDivElement;
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;
  private lastCount = 0;
  private shownBindings: CameraNavigationBindings | null = null;
  private shownGoThere = false;

  constructor(private readonly parent: HTMLElement) {
    const document = parent.ownerDocument;
    this.notice = document.createElement('div');
    Object.assign(this.notice.style, BOX, {
      left: '50%',
      bottom: '24px',
      transform: 'translateX(-50%)',
      padding: '4px 10px',
      display: 'none',
    });
    this.mode = document.createElement('div');
    Object.assign(this.mode.style, BOX, {
      left: '50%',
      top: '12px',
      transform: 'translateX(-50%)',
      padding: '4px 10px',
      display: 'none',
    });
    this.help = document.createElement('div');
    Object.assign(this.help.style, BOX, {
      left: '12px',
      bottom: '12px',
      padding: '8px 10px',
      display: 'none',
    });
    parent.append(this.notice, this.mode, this.help);
  }

  /** Show `state`; the keys as `bindings` has them, Alt+click among them where it goes somewhere. */
  update(
    state: CameraNavigatorState,
    bindings: CameraNavigationBindings,
    goThere: boolean,
  ) {
    if (state.messageCount !== this.lastCount && state.message) {
      this.lastCount = state.messageCount;
      this.notice.textContent = state.message;
      this.notice.style.display = '';
      if (this.noticeTimer) clearTimeout(this.noticeTimer);
      this.noticeTimer = setTimeout(() => {
        this.notice.style.display = 'none';
      }, CAMERA_NAVIGATOR_NOTICE * 1000);
    }
    if (state.mode === 'orbit') this.mode.style.display = 'none';
    else {
      this.mode.textContent = MODE_TEXT[state.mode];
      this.mode.style.display = '';
    }
    if (
      state.help &&
      (bindings !== this.shownBindings || goThere !== this.shownGoThere)
    ) {
      this.shownBindings = bindings;
      this.shownGoThere = goThere;
      this.renderHelp(bindings, goThere);
    }
    this.help.style.display = state.help ? '' : 'none';
  }

  dispose() {
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.notice.remove();
    this.mode.remove();
    this.help.remove();
  }

  private renderHelp(bindings: CameraNavigationBindings, goThere: boolean) {
    const document = this.parent.ownerDocument;
    const table = document.createElement('table');
    table.style.borderSpacing = '10px 2px';
    for (const [label, keys] of helpRows(bindings, goThere)) {
      const tr = document.createElement('tr');
      const what = document.createElement('td');
      what.textContent = label;
      const which = document.createElement('td');
      which.textContent = keys;
      which.style.fontFamily = 'monospace';
      tr.append(what, which);
      table.append(tr);
    }
    const title = document.createElement('div');
    title.textContent = 'Camera keys';
    title.style.fontWeight = 'bold';
    title.style.marginBottom = '4px';
    this.help.replaceChildren(title, table);
  }
}
