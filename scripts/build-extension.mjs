import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT_DIR = process.cwd();
const EXTENSION_DIR = path.join(ROOT_DIR, 'extension');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const OUTPUT_ZIP = path.join(DIST_DIR, 'hark-extension.zip');
const MANIFEST_PATH = path.join(EXTENSION_DIR, 'manifest.json');

console.log('📦 Starting Hark Chrome Extension build & packaging...');

// 1. Verify extension directory and manifest
if (!fs.existsSync(EXTENSION_DIR)) {
  console.error(`❌ Error: Extension directory not found at ${EXTENSION_DIR}`);
  process.exit(1);
}

if (!fs.existsSync(MANIFEST_PATH)) {
  console.error(`❌ Error: manifest.json not found at ${MANIFEST_PATH}`);
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
  console.log(`✅ Loaded manifest: "${manifest.name}" v${manifest.version}`);
} catch (err) {
  console.error('❌ Failed to parse manifest.json:', err);
  process.exit(1);
}

// 2. Ensure dist directory exists
if (!fs.existsSync(DIST_DIR)) {
  fs.mkdirSync(DIST_DIR, { recursive: true });
}

// 3. Remove previous zip if present
if (fs.existsSync(OUTPUT_ZIP)) {
  fs.unlinkSync(OUTPUT_ZIP);
}

// 4. Archive extension directory contents into dist/hark-extension.zip
console.log('🗜️  Archiving extension files into dist/hark-extension.zip...');
let buildSuccess = false;

// Strategy A: bsdtar / tar (built-in on Windows 10/11, macOS, and Linux)
try {
  execSync(`tar -a -c -f "${OUTPUT_ZIP}" -C "${EXTENSION_DIR}" .`, { stdio: 'pipe' });
  buildSuccess = true;
} catch (err) {
  console.warn('⚠️  tar command failed, attempting fallback archiving...');
}

// Strategy B: PowerShell Compress-Archive (Windows fallback)
if (!buildSuccess && process.platform === 'win32') {
  try {
    execSync(
      `powershell -Command "Compress-Archive -Path '${EXTENSION_DIR}/*' -DestinationPath '${OUTPUT_ZIP}' -Force"`,
      { stdio: 'pipe' }
    );
    buildSuccess = true;
  } catch (err) {
    console.error('❌ PowerShell Compress-Archive failed:', err);
  }
}

// Strategy C: zip command (Unix fallback)
if (!buildSuccess && process.platform !== 'win32') {
  try {
    execSync(`cd "${EXTENSION_DIR}" && zip -r "${OUTPUT_ZIP}" .`, { stdio: 'pipe' });
    buildSuccess = true;
  } catch (err) {
    console.error('❌ zip command failed:', err);
  }
}

if (!buildSuccess || !fs.existsSync(OUTPUT_ZIP)) {
  console.error('❌ Failed to build extension zip archive.');
  process.exit(1);
}

// 5. Verify and display stats
const stats = fs.statSync(OUTPUT_ZIP);
const sizeKB = (stats.size / 1024).toFixed(2);

console.log('\n🎉 Build Succeeded!');
console.log('----------------------------------------------------');
console.log(`Extension Name:   ${manifest.name}`);
console.log(`Version:          ${manifest.version}`);
console.log(`Output File:      ${path.relative(ROOT_DIR, OUTPUT_ZIP)}`);
console.log(`Archive Size:     ${sizeKB} KB (${stats.size} bytes)`);
console.log('Ready for Chrome Web Store distribution or local install!');
console.log('----------------------------------------------------\n');
