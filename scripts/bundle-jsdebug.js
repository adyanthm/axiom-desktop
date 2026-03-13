import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const destDir = path.join(rootDir, 'src-tauri', 'resources', 'jsdebug');
const srcRepo = path.join(process.env.LOCALAPPDATA || process.env.HOME, 'AppData', 'Local', 'Temp', 'vscode-js-debug');

console.log('Bundling vscode-js-debug...');

// Check if already bundled
if (fs.existsSync(path.join(destDir, 'dist', 'src', 'dapDebugServer.js'))) {
  console.log('js-debug already bundled.');
  process.exit(0);
}

// Check if repo has been compiled
const distPath = path.join(srcRepo, 'dist', 'src', 'dapDebugServer.js');
if (!fs.existsSync(distPath)) {
  if (!fs.existsSync(srcRepo)) {
    console.log('Cloning vscode-js-debug...');
    execSync(`git clone --depth=1 https://github.com/microsoft/vscode-js-debug.git "${srcRepo}"`, { stdio: 'inherit' });
  }
  console.log('Installing js-debug dependencies...');
  execSync('npm install', { cwd: srcRepo, stdio: 'inherit' });
  console.log('Compiling js-debug standalone server (dapDebugServer)...');
  execSync('npx gulp dapDebugServer', { cwd: srcRepo, stdio: 'inherit' });
}

// Copy only the dist folder (not node_modules)
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src)) {
    if (entry === 'node_modules' || entry === '.git') continue;
    const srcPath = path.join(src, entry);
    const destPath = path.join(dest, entry);
    if (fs.statSync(srcPath).isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Copy dist directory and package.json
const distSrc = path.join(srcRepo, 'dist');
const distDest = path.join(destDir, 'dist');
console.log('Copying js-debug dist...');
copyDir(distSrc, distDest);

// Copy node_modules needed by the dist (js-debug is mostly self-contained but needs a few)
// Only copy what's absolutely needed at runtime
const runtimeDeps = ['source-map', 'acorn'];
const nmDest = path.join(destDir, 'node_modules');
fs.mkdirSync(nmDest, { recursive: true });
for (const dep of runtimeDeps) {
  const depSrc = path.join(srcRepo, 'node_modules', dep);
  if (fs.existsSync(depSrc)) {
    copyDir(depSrc, path.join(nmDest, dep));
    console.log(`  Copied runtime dep: ${dep}`);
  }
}

// Copy package.json so Node resolves the module correctly
fs.copyFileSync(path.join(srcRepo, 'package.json'), path.join(destDir, 'package.json'));

console.log('js-debug bundled successfully.');
