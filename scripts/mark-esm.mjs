// The package is CommonJS; `dist/esm` (the browser entries `./manifest` and `./vue`) is ES modules. Node's ES
// module loader (and Vitest, which loads installed packages with it) needs full relative paths, while the
// sources import `./host`: give every relative import in `dist/esm` its `.js` (or `/index.js` for a folder).
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ESM_DIR = fileURLToPath(new URL('../dist/esm', import.meta.url));

// from './x', import('./x'), import './x', export … from './x'
const RELATIVE_IMPORT = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]*)\2/g;

const files = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });

const withExtension = (file, specifier) => {
  if (/\.(?:m?js|json)$/.test(specifier)) return specifier;
  const target = resolve(dirname(file), specifier);
  if (existsSync(`${target}.js`)) return `${specifier}.js`;
  if (existsSync(join(target, 'index.js'))) return `${specifier}/index.js`;
  throw new Error(`${file}: can't resolve "${specifier}"`);
};

for (const file of files(ESM_DIR).filter((f) => /\.(?:js|d\.ts)$/.test(f))) {
  const code = readFileSync(file, 'utf8');
  const rewritten = code.replace(
    RELATIVE_IMPORT,
    (_, keyword, quote, specifier) => `${keyword}${quote}${withExtension(file, specifier)}${quote}`,
  );
  if (rewritten !== code) writeFileSync(file, rewritten);
}

writeFileSync(join(ESM_DIR, 'package.json'), '{ "type": "module" }\n');
