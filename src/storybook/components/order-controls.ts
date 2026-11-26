import type { ArgTypes } from '@storybook/react-vite';

const categoryOf = (argType: unknown) =>
  (argType as { table?: { category?: string } } | undefined)?.table?.category ??
  '';

// Last of all, the groups a reader needs least: Storybook's panel to save or revert changed
// args, once anything changes, covers the last group.
const TRAILING = ['Debug', 'Diagnostics'];

// The groups A to Z: those in no group first, as Storybook shows them; Debug and Diagnostics last.
function alphabeticalGroups(argTypes: object): string[] {
  const groups = new Set(Object.values(argTypes).map(categoryOf));
  const named = [...groups]
    .filter(group => group !== '' && !TRAILING.includes(group))
    .sort((x, y) => x.localeCompare(y));
  return ['', ...named, ...TRAILING];
}

/**
 * A story's `args` and `argTypes` with the Controls panel's groups in the order of
 * `categories`, or A to Z (`'alphabetical'`: Debug and Diagnostics last), for a story with many
 * of them.
 * Storybook lays the panel out by the order of the args (then of the argTypes), a group where
 * its first control comes, and no project-wide hook can change that: Storybook rebuilds the
 * argTypes in the args' order after them. So both are reordered here. Within a group, the keys
 * `first` lists for it lead, in that order, and the rest keep theirs. Groups not named follow,
 * as they came.
 */
export function orderControls<T>(
  controls: { args: Partial<T>; argTypes: Partial<ArgTypes<T>> },
  categories: string[] | 'alphabetical',
  first: Record<string, string[]> = {},
): { args: Partial<T>; argTypes: Partial<ArgTypes<T>> } {
  const order =
    categories === 'alphabetical'
      ? alphabeticalGroups(controls.argTypes)
      : categories;
  const rank = (category: string) => {
    const index = order.indexOf(category);
    return index < 0 ? order.length : index;
  };
  const lead = (key: string, category: string) => {
    const index = first[category]?.indexOf(key) ?? -1;
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
  };
  const keys = Object.entries(controls.argTypes)
    .map(([key, argType], index) => ({
      key,
      index,
      category: categoryOf(argType),
    }))
    .sort(
      (a, b) =>
        rank(a.category) - rank(b.category) ||
        lead(a.key, a.category) - lead(b.key, b.category) ||
        a.index - b.index,
    )
    .map(({ key }) => key);
  const reorder = <V extends object>(record: V): V => {
    const entries = Object.entries(record);
    const at = new Map(keys.map((key, index) => [key, index]));
    const place = (key: string) => at.get(key) ?? keys.length;
    return Object.fromEntries(
      entries
        .map((entry, index) => ({ entry, index }))
        .sort(
          (a, b) => place(a.entry[0]) - place(b.entry[0]) || a.index - b.index,
        )
        .map(({ entry }) => entry),
    ) as V;
  };
  return {
    args: reorder(controls.args),
    argTypes: reorder(controls.argTypes),
  };
}

/**
 * A story's own `args` in the order {@link orderControls} gives the groups of `argTypes` (the
 * meta's): for args a story spreads in (a `commonArgs`), its argTypes held by the meta.
 */
export function orderArgs<A extends object>(
  args: A,
  argTypes: object,
  categories: string[] | 'alphabetical' = 'alphabetical',
): A {
  return orderControls({ args, argTypes }, categories).args as A;
}
