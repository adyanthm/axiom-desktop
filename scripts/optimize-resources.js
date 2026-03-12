import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const resourcesDir = path.join(rootDir, 'src-tauri', 'resources');

console.log('Optimizing bundled resources...');

let deletedSize = 0;
let deletedCount = 0;

function optimizeDirectory(dir) {
  if (!fs.existsSync(dir)) return;

  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      optimizeDirectory(fullPath);
    } else {
      if (file.endsWith('.pdb') || file.endsWith('.map')) {
        const size = stat.size;
        fs.unlinkSync(fullPath);
        deletedSize += size;
        deletedCount++;
      }
    }
  }
}

if (fs.existsSync(resourcesDir)) {
  optimizeDirectory(resourcesDir);
  const mbSaved = (deletedSize / (1024 * 1024)).toFixed(2);
  console.log(`Resource optimization complete.`);
  console.log(`Deleted ${deletedCount} junk files (.pdb, .map). Removed ${mbSaved} MB of bloat.`);
} else {
  console.log('No resources folder found to optimize.');
}
