import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const destDir = path.join(rootDir, 'src-tauri', 'resources', 'debugpy');

console.log('Ensuring debugpy is bundled...');

if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}

// We only install if the actual debugpy module folder is missing
if (!fs.existsSync(path.join(destDir, 'debugpy'))) {
  try {
    console.log('Installing debugpy v1.8.20 via pip...');
    // Use python -m pip for maximum compatibility across OSs
    execSync(`python -m pip install debugpy==1.8.20 --target "${destDir}" --no-user`, { 
      stdio: 'inherit',
      cwd: rootDir 
    });
    console.log('debugpy successfully bundled.');
  } catch (err) {
    console.error('Failed to install debugpy. Error:', err.message);
    console.error('Make sure Python and pip are installed on your system.');
    process.exit(1);
  }
} else {
  console.log('debugpy is already present in resources.');
}
