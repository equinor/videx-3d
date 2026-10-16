import fs from 'node:fs';
import path from 'node:path';

export function verify(data, ...deps) {
  for (let i = 0; i < deps.length; i++) {
    const dep = deps[i];
    if (!data[dep]) {
      throw Error('Missing dependency: ' + dep + '!');
    }
  }
}

export function groupBy(array, groupBy) {
  return array.reduce((grouped, d) => {
    const key = groupBy(d);
    let group = grouped[key];
    if (!group) {
      group = [];
      grouped[key] = group;
    }

    group.push(d);

    return grouped;
  }, {});
}

/**
 * Remove every file under `dir` but keep the folders. Deleting a folder the
 * Storybook dev server watches leaves its watcher spinning on Windows (~3 cores
 * until restarted).
 */
export function emptyDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) emptyDir(entryPath);
    else fs.rmSync(entryPath, { force: true });
  }
}
