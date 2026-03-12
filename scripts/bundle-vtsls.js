import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const rootDir    = path.resolve(__dirname, '..');
const destDir    = path.join(rootDir, 'src-tauri', 'resources', 'vtsls');

console.log('Building Robust (Flat) vtsls resources...');

// Packages VTSLS needs to function
const packages = [
  '@vtsls/language-server',
  '@vtsls/language-service',
  '@vtsls/vscode-fuzzy',
  'vscode-languageserver',
  'vscode-languageserver-protocol',
  'vscode-languageserver-textdocument',
  'vscode-languageserver-types',
  'vscode-jsonrpc',
  'vscode-uri',
  '@vscode/l10n',
  'jsonc-parser',
  'semver',
  'typescript'
];

function copyDirRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    // Skip nested node_modules to keep it flat and short!
    if (entry.name === 'node_modules') continue;
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// 1. Clear destination
if (fs.existsSync(destDir)) fs.rmSync(destDir, { recursive: true, force: true });
fs.mkdirSync(destDir, { recursive: true });

// 2. Flatten all packages into ONE node_modules folder
const nmDest = path.join(destDir, 'node_modules');
for (const pkg of packages) {
  const src = path.join(rootDir, 'node_modules', pkg);
  const dest = path.join(nmDest, pkg);
  console.log(`  - Copying ${pkg}...`);
  copyDirRecursive(src, dest);
}

// 3. Create a clean entry point next to the flattened node_modules
const entryPoint = `require('./node_modules/@vtsls/language-server/dist/main.js');`;
fs.writeFileSync(path.join(destDir, 'vtsls-entry.cjs'), entryPoint);

console.log('vtsls Robust bundle prepared.');
