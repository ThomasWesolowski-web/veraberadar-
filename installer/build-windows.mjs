// Baut den Windows-Installer: 1) Electron-App für Windows (x64) packen, 2) Installer mit NSIS erzeugen.
// Benötigt NSIS (makensis): Linux `apt install nsis`, Windows https://nsis.sourceforge.io
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });

run('npx', ['electron-builder', '--win', 'dir', '--x64']);

const srcDir = path.join(root, 'dist', 'win-unpacked');
if (!existsSync(path.join(srcDir, 'XRechnung-Generator.exe'))) throw new Error('Windows-Build fehlt: ' + srcDir);
const out = path.join(root, 'dist', `XRechnung-Generator-Setup-${version}.exe`);
const makensis = process.platform === 'win32' && !process.env.MAKENSIS
  ? 'C:\\Program Files (x86)\\NSIS\\makensis.exe'
  : process.env.MAKENSIS || 'makensis';
run(makensis, [`-DVERSION=${version}`, `-DSRCDIR=${srcDir}`, `-DOUTFILE=${out}`, path.join(root, 'installer', 'installer.nsi')]);
console.log('\nInstaller erstellt:', out);
