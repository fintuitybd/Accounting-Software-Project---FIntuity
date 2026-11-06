// Performance budget gate for the production build. Run after `npm run build`.
//
// Budgets are gzip transfer sizes for JavaScript/CSS chunks. The demo shell is intentionally large
// and is never loaded by server-backed mode; it still has a ceiling so demo-only work cannot grow
// without a review. The XLSX parser is lazy and only downloads when an import/export is opened.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assetsDir = path.join(root, 'dist', 'assets');

const budgets = [
  { pattern: /^index-.*\.js$/, label: 'application entry', maxKb: 130 },
  { pattern: /^App-.*\.js$/, label: 'auth route entry', maxKb: 70 },
  { pattern: /^MarketingApp-.*\.js$/, label: 'marketing entry', maxKb: 30 },
  { pattern: /^ErpShell-.*\.js$/, label: 'authenticated shell entry', maxKb: 10 },
  { pattern: /^ProductionShell-.*\.js$/, label: 'production shell', maxKb: 25 },
  { pattern: /^xlsx-.*\.js$/, label: 'lazy XLSX engine', maxKb: 160 },
  { pattern: /^DemoShell-.*\.js$/, label: 'isolated demo shell', maxKb: 450 },
  { pattern: /^index-.*\.css$/, label: 'application CSS', maxKb: 35 },
  { pattern: /.*\.js$/, label: 'any other JavaScript chunk', maxKb: 60 },
];

function gzipKb(file) {
  return gzipSync(readFileSync(file), { level: 9 }).length / 1024;
}

let files;
try {
  files = readdirSync(assetsDir).filter((name) => /\.(js|css)$/.test(name));
} catch {
  console.error('FAIL dist/assets is missing. Run `npm run build` first.');
  process.exit(1);
}

const failures = [];
const rows = [];
for (const file of files.sort()) {
  const sizeKb = gzipKb(path.join(assetsDir, file));
  const budget = budgets.find((candidate) => candidate.pattern.test(file));
  if (!budget) continue;
  const pass = sizeKb <= budget.maxKb;
  rows.push({ file, sizeKb, budget, pass });
  if (!pass) failures.push(`${file} is ${sizeKb.toFixed(2)} KB gzip; budget is ${budget.maxKb} KB (${budget.label}).`);
}

for (const row of rows.sort((a, b) => b.sizeKb - a.sizeKb)) {
  const marker = row.pass ? 'PASS' : 'FAIL';
  console.log(
    `${marker} ${row.file.padEnd(44)} ${row.sizeKb.toFixed(2).padStart(8)} KB gzip  / ${String(row.budget.maxKb).padStart(4)} KB  ${row.budget.label}`,
  );
}

if (failures.length > 0) {
  console.error('');
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exit(1);
}
console.log(`\nBundle budgets met for ${rows.length} chunk(s).`);
