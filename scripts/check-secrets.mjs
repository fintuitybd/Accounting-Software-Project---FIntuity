// High-confidence secret scan for tracked files. This is a release gate, not a replacement for a
// dedicated secret-scanning service. Values are never printed; only the file, line and pattern name.

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_FILE_BYTES = 2_000_000;
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.pdf',
  '.zip', '.gz', '.dump', '.backup', '.xlsx', '.xls', '.db', '.sqlite',
]);

const patterns = [
  { name: 'private key block', regex: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: 'AWS access key id', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub token', regex: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: 'Slack token', regex: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/ },
  { name: 'Stripe live secret key', regex: /\bsk_live_[A-Za-z0-9]{20,}\b/ },
  { name: 'Google API key', regex: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'JWT-like credential', regex: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/ },
  {
    name: 'non-local database URL with an embedded password',
    regex: /\bpostgres(?:ql)?:\/\/[^/\s:@]+:[^/\s@]+@([^/\s:]+)/g,
    allow: (match) => {
      const host = match[1] ?? '';
      return (
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host === '::1' ||
        host === 'postgres' ||
        host === 'db' ||
        host.endsWith('.test') ||
        host.endsWith('.local') ||
        host.endsWith('example.test') ||
        /replace-with-a-local-password|not-a-real-secret|ci_only/i.test(match[0] ?? '')
      );
    },
  },
];

function gitFiles() {
  const output = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });
  return output.split('\0').filter(Boolean);
}

const findings = [];
for (const relative of gitFiles()) {
  const extension = path.extname(relative).toLowerCase();
  if (BINARY_EXTENSIONS.has(extension)) continue;
  const absolute = path.join(root, relative);
  let size;
  try {
    size = statSync(absolute).size;
  } catch {
    continue;
  }
  if (size > MAX_FILE_BYTES) continue;
  let content;
  try {
    content = readFileSync(absolute, 'utf8');
  } catch {
    continue;
  }
  if (content.includes('\u0000')) continue;
  const lines = content.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    for (const pattern of patterns) {
      if (pattern.regex.lastIndex !== 0) pattern.regex.lastIndex = 0;
      const matches = pattern.regex.global ? Array.from(line.matchAll(pattern.regex)) : (pattern.regex.test(line) ? [null] : []);
      for (const match of matches) {
        if (match && pattern.allow?.(match)) continue;
        findings.push(`${relative}:${index + 1} — ${pattern.name}`);
      }
    }
  }
}

if (findings.length > 0) {
  console.error(`FAIL ${findings.length} high-confidence secret finding(s):`);
  for (const finding of findings) console.error(`  ${finding}`);
  process.exit(1);
}
console.log('PASS no high-confidence secrets in tracked files.');
