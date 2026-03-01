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
      if (src.includes('typeshed-fallback') && childItemName === 'stubs') {
        return; // Skip the massive stubs directory to prevent Tauri stack overflow
      }
      if (childItemName === 'typeshed-fallback') {
           // Create typeshed-fallback first
           const typeshedDest = path.join(dest, childItemName);
           if (!fs.existsSync(typeshedDest)) fs.mkdirSync(typeshedDest, { recursive: true });
           
           // Copy only what we explicitly need from typeshed-fallback
           copyRecursiveSync(path.join(src, childItemName, 'stdlib'), path.join(typeshedDest, 'stdlib'));
           
           // Copy the root files inside typeshed-fallback 
           const typeshedFiles = ['LICENSE', 'README.md', 'commit.txt'];
           typeshedFiles.forEach(file => {
               if (fs.existsSync(path.join(src, childItemName, file))) {
                   fs.copyFileSync(path.join(src, childItemName, file), path.join(typeshedDest, file));
               }
           });
           return;
      }
      copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
    });
  } else {
    // Only copy if file doesn't exist or is different (simple size check)
    // Actually, force copy to ensure we always have the latest, it's fast enough.
    if(exists) {
        fs.copyFileSync(src, dest);
    }
  }
}

console.log('Copying internal Pyright resources to src-tauri...');

if (fs.existsSync(srcDir)) {
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    
    // Copy the root JS files
    const mainFiles = ['pyright-langserver.js', 'pyright-internal.js', 'vendor.js'];
    mainFiles.forEach(file => {
        fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
    });

    // Handle typeshed fallback specifically to avoid massive bloat
    const typeshedSrc = path.join(srcDir, 'typeshed-fallback');
    if (fs.existsSync(typeshedSrc)) {
         copyRecursiveSync(typeshedSrc, path.join(destDir, 'typeshed-fallback'));
    }
    
    console.log('Pyright resources successfully bundled.');
} else {
    console.warn('WARN: Pyright node_modules not found. Building without autocompletion server assets.');
}
