import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// Every Docs page says what it is, and every story what it shows: a Docs page renders no story
// unless it opts in (src/storybook/docs/docs-page.tsx), so its words are the page.

function sourceFiles(dir: string, keep: (name: string) => boolean): string[] {
  return (readdirSync(dir, { recursive: true }) as string[])
    .filter(keep)
    .map(name => join(dir, name).replace(/\\/g, '/'));
}

const storyFiles = sourceFiles('src', name => name.endsWith('.stories.tsx'));

// What is exported with TSDoc outside the story files: a component's description reaches its
// page through react-docgen-typescript, which skips the story files (.storybook/main.ts).
const documented = new Set<string>();
for (const file of sourceFiles(
  'src',
  name => /\.tsx?$/.test(name) && !name.endsWith('.stories.tsx'),
)) {
  const source = readFileSync(file, 'utf-8');
  for (const m of source.matchAll(
    /\/\*\*(?:(?!\*\/)[\s\S])*\*\/\s*export\s+(?:const|function|class)\s+(\w+)/g,
  ))
    documented.add(m[1]);
}

// Whether the code before `at` ends in a JSDoc block (`/** … */`).
function jsdocBefore(source: string, at: number) {
  const before = source.slice(0, at).trimEnd();
  if (!before.endsWith('*/')) return false;
  return before.startsWith('/**', before.lastIndexOf('/*'));
}

// The page's intro: its own (a JSDoc on the meta, or `docs.description.component`), or the TSDoc
// of the library component it names. A wrapper declared in the story file has none.
function hasIntro(source: string) {
  if (/description:\s*\{\s*component:/.test(source)) return true;
  const meta = /^const meta\b/m.exec(source);
  if (!meta) return false;
  if (jsdocBefore(source, meta.index)) return true;
  const component = /\n\s+component:\s*(\w+)/.exec(
    source.slice(meta.index),
  )?.[1];
  if (!component) return false;
  if (new RegExp(`(?:const|function)\\s+${component}\\b`).test(source))
    return false;
  return documented.has(component);
}

// The stories without a description: a JSDoc on the export, or `docs.description.story`.
function undescribed(source: string) {
  const stories = [...source.matchAll(/^export const (\w+)\s*[:=]/gm)];
  return stories
    .filter((m, i) => {
      if (jsdocBefore(source, m.index)) return false;
      const body = source.slice(m.index, stories[i + 1]?.index);
      return !/description:\s*\{\s*story:/.test(body);
    })
    .map(m => m[1]);
}

describe('Storybook Docs pages', () => {
  test('every page has an intro', () => {
    const missing = storyFiles.filter(
      file => !hasIntro(readFileSync(file, 'utf-8')),
    );
    expect(missing).toEqual([]);
  });

  test('every story has a description', () => {
    const missing = storyFiles.flatMap(file =>
      undescribed(readFileSync(file, 'utf-8')).map(
        story => `${file}: ${story}`,
      ),
    );
    expect(missing).toEqual([]);
  });
});
