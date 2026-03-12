import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const srcDir = path.join(rootDir, 'node_modules', 'pyright', 'dist');
const destDir = path.join(rootDir, 'src-tauri', 'resources', 'pyright');

function copyRecursiveSync(src, dest) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();
  if (isDirectory) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(src).forEach(function(childItemName) {
      // Skip the massive and unnecessary directories
      if (childItemName === 'stubs' || childItemName === 'typeshed-fallback-old') return;
      copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
    });
  } else {
    fs.copyFileSync(src, dest);
  }
}

console.log('Copying internal Pyright resources to src-tauri...');

if (fs.existsSync(srcDir)) {
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    
    // Copy everything from dist except stubs to ensure all internals are present
    copyRecursiveSync(srcDir, destDir);
    
    console.log('Pyright resources successfully bundled.');
} else {
    console.warn('WARN: Pyright node_modules not found.');
}
