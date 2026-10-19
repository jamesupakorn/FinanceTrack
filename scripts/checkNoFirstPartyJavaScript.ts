import { readdirSync } from 'node:fs';
import path from 'node:path';

const excludedDirectories = new Set([
  '.git',
  '.next',
  '.vercel',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'public',
]);
const legacyExtensions = new Set(['.js', '.jsx', '.mjs', '.cjs']);

function findLegacyFiles(directory: string, rootDirectory: string, matches: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) {
        findLegacyFiles(entryPath, rootDirectory, matches);
      }
      continue;
    }
    if (entry.isFile() && legacyExtensions.has(path.extname(entry.name))) {
      matches.push(path.relative(rootDirectory, entryPath));
    }
  }
  return matches;
}

const rootDirectory = path.resolve(__dirname, '..');
const legacyFiles = findLegacyFiles(rootDirectory, rootDirectory);

if (legacyFiles.length > 0) {
  console.error('First-party JavaScript files remain:');
  legacyFiles.forEach(file => console.error(`- ${file}`));
  process.exitCode = 1;
} else {
  console.log('No first-party JavaScript files found.');
}