import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const roots = ['src', 'test'];
const failures = [];

async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await visit(path);
    else if (/\.(ts|js|mjs)$/.test(entry.name)) {
      const source = await readFile(path, 'utf8');
      if (/[ \t]+$/m.test(source)) failures.push(`${path}: trailing whitespace`);
      if (/\b(eval|Function)\s*\(/.test(source)) failures.push(`${path}: dynamic code execution is forbidden`);
      if (/console\.log\s*\(/.test(source)) failures.push(`${path}: console.log is forbidden; use returned diagnostics`);
    }
  }
}

for (const root of roots) await visit(root);
if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
}
