// The package is CommonJS; `dist/esm` (the browser entries `./manifest` and `./vue`) is ES modules
import { writeFileSync } from 'node:fs';

writeFileSync(new URL('../dist/esm/package.json', import.meta.url), '{ "type": "module" }\n');
