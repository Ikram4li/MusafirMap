import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, relative, basename } from 'node:path';

const root = process.cwd();
const key = (process.env.GOOGLE_MAPS_API_KEY || '').trim();
if (!/^AIza[A-Za-z0-9_-]{35}$/.test(key)) {
  console.error('Set GOOGLE_MAPS_API_KEY to a valid browser key in Cloudflare build settings.');
  process.exit(1);
}
const output = resolve(root, 'dist');
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
const entries = ['index.html', 'home', 'about', 'moreinfo', 'assets', 'map', 'manifest.json', 'pwabuilder-sw.js'];
for (const entry of entries) {
  const source = resolve(root, entry);
  if (!existsSync(source)) continue;
  cpSync(source, resolve(output, entry), {
    recursive: true,
    filter: path => !relative(source, path).split('/').includes('tests') &&
      !basename(path).endsWith('.md') && basename(path) !== 'google-config.js'
  });
}
mkdirSync(resolve(output, 'map'), { recursive: true });
writeFileSync(resolve(output, 'map/google-config.js'),
  '// Generated during deployment. Website and API restrictions remain required.\n' +
  'window.MUSAFIR_GOOGLE_KEY = ' + JSON.stringify(key) + ';\n');
console.log('Website built in dist. Google browser configuration generated.');
