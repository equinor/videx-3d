import type { CSSProperties } from 'react';

// The look the HTML gadgets over the 3D view share — the maps' buttons and labels, the
// overlay's buttons, the altitude control's readout — so they read as one set. Public: a layout
// or a gadget of the host's own can share it.

/**
 * A gadget's button: a small dark square with a faint edge.
 *
 * @group Utils
 */
export const HUD_BUTTON: CSSProperties = {
  width: 24,
  height: 24,
  padding: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  font: '14px/1 verdana, sans-serif',
  color: '#fff',
  background: 'rgba(0, 0, 0, 0.55)',
  border: '1px solid rgba(255, 255, 255, 0.3)',
  borderRadius: 4,
  cursor: 'pointer',
  boxSizing: 'border-box',
};

/**
 * A button's edge and text when what it toggles is on.
 *
 * @group Utils
 */
export const HUD_ACTIVE = '#ffd21a';
/**
 * A button's edge when it is off.
 *
 * @group Utils
 */
export const HUD_IDLE = 'rgba(255, 255, 255, 0.3)';

/**
 * One look for every label (a map's extent and distance, an altitude): sharp text with a hard
 * one-pixel outline all round and a tight core, readable on light ground and dark.
 *
 * @group Utils
 */
export const HUD_LABEL: CSSProperties = {
  font: '10px/1.2 verdana, sans-serif',
  color: '#fff',
  textShadow: [
    '-1px -1px 0 #000',
    '0 -1px 0 #000',
    '1px -1px 0 #000',
    '-1px 0 0 #000',
    '1px 0 0 #000',
    '-1px 1px 0 #000',
    '0 1px 0 #000',
    '1px 1px 0 #000',
    '0 0 2px #000',
  ].join(', '),
  pointerEvents: 'none',
  whiteSpace: 'nowrap',
};

/**
 * `metres` as a short distance: `850 m`, `4.5 km`, `120 km`.
 *
 * @group Utils
 */
export function formatHudDistance(metres: number) {
  if (metres < 1000) return `${Math.round(metres)} m`;
  const km = metres / 1000;
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

/**
 * A height over the sea: `120 m`, `−1.2 km`, `MSL` within a metre of it.
 *
 * @group Utils
 */
export function formatHudAltitude(metres: number) {
  if (Math.abs(metres) < 1) return 'MSL';
  return `${metres < 0 ? '−' : ''}${formatHudDistance(Math.abs(metres))}`;
}

/**
 * Set `element`'s text to `text`, touching the DOM only when it changes: for a readout
 * written per frame.
 *
 * @group Utils
 */
export function setHudText(element: Element | null, text: string) {
  if (element && element.textContent !== text) element.textContent = text;
}
