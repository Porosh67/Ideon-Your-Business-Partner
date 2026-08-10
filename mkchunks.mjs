// Generates per-group copies of run-navtest.mjs with a fresh chromium per chunk.
// The full-suite run keeps crashing the browser under accumulated page load, so
// we split it: each chunk runs 1-2 groups in its own node process + browser.
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync('/app/run-navtest.mjs', 'utf8');
const patched = src.replace(
  'chromium.launch({ headless: true })',
  'chromium.launch({ headless: true, args: ["--disable-dev-shm-usage", "--no-sandbox"] })',
);

const GROUPS_BLOCK_START = 'const groups = [';
const GROUPS_BLOCK_END = '];';

const chunks = {
  'chunk-b': `const groups = [
  () => groupB('http://localhost:5173', 1, 'dev'),
  () => groupB('http://localhost:4173', 1, 'build'),
];`,
  'chunk-c': `const groups = [
  () => groupC('http://localhost:5173', 'dev'),
  () => groupC('http://localhost:4173', 'build'),
];`,
  'chunk-d': `const groups = [
  () => groupD('http://localhost:5173', 2, 'dev'),
  () => groupD('http://localhost:4173', 1, 'build'),
];`,
  'chunk-e': `const groups = [
  () => groupE('http://localhost:5173', 'dev'),
  () => groupE('http://localhost:4173', 'build'),
];`,
};

for (const [name, groupsBlock] of Object.entries(chunks)) {
  const start = patched.indexOf(GROUPS_BLOCK_START);
  const end = patched.indexOf(GROUPS_BLOCK_END, start) + GROUPS_BLOCK_END.length;
  const out = patched.slice(0, start) + groupsBlock + '\n' + patched.slice(end);
  writeFileSync(`/app/${name}.mjs`, out);
  console.log(`wrote /app/${name}.mjs`);
}
