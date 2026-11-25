import type { Decorator } from '@storybook/react-vite';
import { STORY_PREPARED } from 'storybook/internal/core-events';
import { includeConditionalArg, type InputType } from 'storybook/internal/csf';
import { addons, useEffect, useRef } from 'storybook/preview-api';

type ArgTypesLike = Record<string, InputType | undefined>;

// No story has this arg, so a condition on its existence never holds.
const NEVER = { arg: '__hiddenByChain', exists: true };

/**
 * The controls whose own condition holds but which hang on a control that is hidden, at any
 * depth: Storybook tests an `if` against the value alone, so `reliefLandColor` (`reliefColor`
 * is `'flat'`) would still show while `relief`, which `reliefColor` hangs on, is off.
 */
export function hiddenByChain(
  argTypes: ArgTypesLike,
  args: Record<string, unknown>,
  globals: Record<string, unknown>,
): string[] {
  const memo = new Map<string, boolean>();
  const shown = (key: string, path: Set<string>): boolean => {
    const known = memo.get(key);
    if (known !== undefined) return known;
    const argType = argTypes[key];
    let result = true;
    if (argType?.if) {
      result = includeConditionalArg(argType, args, globals);
      const parent = 'arg' in argType.if ? argType.if.arg : undefined;
      if (result && parent && argTypes[parent] && !path.has(parent)) {
        path.add(key);
        result = shown(parent, path);
      }
    }
    memo.set(key, result);
    return result;
  };
  return Object.keys(argTypes).filter(key => {
    const argType = argTypes[key];
    return (
      argType?.if &&
      includeConditionalArg(argType, args, globals) &&
      !shown(key, new Set())
    );
  });
}

/**
 * Chains the controls' conditions: a control whose condition holds is still hidden while the
 * control it hangs on is. Only the Controls panel changes — the manager is sent the story's
 * `argTypes` with those conditions made false (`STORY_PREPARED`, which it merges into the
 * story) — so the story's args, and so what it renders, are as Storybook made them.
 */
export const chainedControlsDecorator: Decorator = (Story, context) => {
  const args = (context.allArgs ?? context.args) as Record<string, unknown>;
  const hidden =
    context.viewMode === 'story'
      ? hiddenByChain(context.argTypes, args, context.globals)
      : [];
  const signature = hidden.join(',');
  const sent = useRef('');
  useEffect(() => {
    if (signature === sent.current) return;
    sent.current = signature;
    const argTypes = { ...context.argTypes };
    for (const key of hidden) argTypes[key] = { ...argTypes[key], if: NEVER };
    addons.getChannel().emit(STORY_PREPARED, { id: context.id, argTypes });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `hidden` and the story are in `signature`
  }, [signature]);
  return <Story />;
};
