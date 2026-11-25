import { addons } from 'storybook/manager-api';
import theme from './theme';

addons.setConfig({
  theme,
});

const COLLAPSE_CONTROLS = 'videx/collapse-controls';

// The Controls panel's group rows: a row titled "Hide <group> items" while open, "Show <group>
// items" while closed, toggled by its button.
const controlGroupRows = () =>
  [
    ...document.querySelectorAll<HTMLTableRowElement>(
      '#storybook-panel-root table tbody tr[title]',
    ),
  ].filter(row => /^(Hide|Show) .* items$/.test(row.title));

// Alt+C: every open control group closed, or, with none open, every group opened. Shown on the
// shortcuts page, and taken from the story's frame too.
addons.register(COLLAPSE_CONTROLS, api => {
  void api.setAddonShortcut(COLLAPSE_CONTROLS, {
    label: 'Collapse or expand all control groups',
    defaultShortcut: ['alt', 'C'],
    actionName: 'toggleControlGroups',
    showInMenu: false,
    action: () => {
      const rows = controlGroupRows();
      const open = rows.filter(row => row.title.startsWith('Hide '));
      for (const row of open.length > 0 ? open : rows)
        row.querySelector('button')?.click();
    },
  });
});
