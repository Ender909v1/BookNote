// Gives BookNote a new version number (a timestamp) in app.js and version.json.
// Open/installed copies of the app compare their version with version.json on the
// website and update themselves when it changes. Run automatically by the git
// pre-commit hook in tools/hooks (enable once with: git config core.hooksPath tools/hooks).
import { readFileSync, writeFileSync } from 'node:fs';

const d = new Date();
const pad = n => String(n).padStart(2, '0');
const version = `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

const app = readFileSync('app.js', 'utf8');
const next = app.replace(/const APP_VERSION = '[^']*';/, `const APP_VERSION = '${version}';`);
if (next === app) throw new Error('APP_VERSION line not found in app.js');
writeFileSync('app.js', next);
writeFileSync('version.json', JSON.stringify({ version }, null, 2) + '\n');
console.log('BookNote version', version);
