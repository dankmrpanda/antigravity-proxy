/**
 * Regression test: start.sh must strip inline `# comments` when reading
 * values back out of .env.
 *
 * `.env.example` documents ports with trailing comments
 * (`API_PORT=4000     # Dashboard + REST API (HTTP)`). A naive
 * `cut -d= -f2` keeps the comment, so the dashboard wait-loop and the
 * browser URL ended up as `http://localhost:4000#Dashboard+RESTAPI(HTTP)`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const startSh = readFileSync(resolve(__dirname, '..', '..', 'start.sh'), 'utf-8');

test('start.sh strips inline comments when parsing API_PORT from .env', () => {
  const lookup = startSh.split('\n').find((l) => l.includes('API_PORT=$(grep'));
  assert.ok(lookup, 'start.sh must read API_PORT back out of .env for the health check');
  assert.ok(
    lookup.includes("#'") || lookup.includes('"#"') || /cut -d.?#/.test(lookup),
    `API_PORT lookup must cut at '#' so trailing comments don't leak into the URL: ${lookup.trim()}`,
  );
});
