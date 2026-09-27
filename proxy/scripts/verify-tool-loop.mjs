// Optional live regression: run after building and starting a test proxy.
// node scripts/verify-tool-loop.mjs https://localhost:8443 gpt-oss-120b-medium
import assert from 'node:assert/strict';
import http2 from 'node:http2';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { logger } from '../dist/logger.js';

const endpoint = new URL(process.argv[2] || 'https://localhost:8443');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname), 'Use a local test proxy');
const model = process.argv[3] || 'gpt-oss-120b-medium';
const directory = await mkdtemp(join(tmpdir(), 'antigravity-tool-verification-'));
const session = http2.connect(endpoint.origin, {
  servername: 'cloudcode-pa.googleapis.com',
  rejectUnauthorized: false, // Only the loopback test proxy; never used upstream.
});
session.on('error', () => {}); // Each request below reports session errors.
const conversation = `agent/verification-${randomUUID()}`;
const tools = [{ functionDeclarations: [{
  name: 'list_dir',
  description: 'List directory contents',
  parameters: {
    type: 'object',
    properties: {
      DirectoryPath: { type: 'string' },
      toolSummary: { type: 'string' },
      toolAction: { type: 'string' },
    },
    required: ['DirectoryPath', 'toolSummary', 'toolAction'],
  },
}] }];

function generate(contents, requestId, requestTools = tools) {
  return new Promise((resolve, reject) => {
    const req = session.request({ ':method': 'POST', ':path': '/v1internal:streamGenerateContent?alt=sse',
      'content-type': 'application/json' });
    let response = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { response += chunk; });
    req.setTimeout(60000, () => { req.close(); reject(new Error('Proxy request timed out')); });
    req.on('error', reject);
    req.on('end', () => {
      try {
        const events = response.split('\n').filter(line => line.startsWith('data:'))
          .map(line => JSON.parse(line.slice(5).trim()));
        assert.ok(events.length, 'Proxy must return SSE events');
        for (const event of events) {
          assert.ok(!event.error, event.error?.message);
          assert.notEqual(event.response?.candidates?.[0]?.finishReason, 'ERROR');
        }
        const parts = events.flatMap(event => event.response?.candidates?.[0]?.content?.parts || []);
        resolve(parts.filter(part => !part.thought));
      } catch (error) { reject(error); }
    });
    req.end(JSON.stringify({ project: 'aicode-consumers', requestId,
      request: { model, contents, tools: requestTools, generationConfig: { maxOutputTokens: 4096 } } }));
  });
}

try {
  const contents = [{ role: 'user', parts: [{ text:
    `Call list_dir exactly once for ${directory} using all required schema fields. After receiving the result, state whether it is empty without calling any tools again.`,
  }] }];
  const [parts] = await Promise.all([
    generate(contents, `${conversation}/1`),
    generate([{ role: 'user', parts: [{ text: 'Reply with only checkpoint.' }] }], `checkpoint/${randomUUID()}`, []),
  ]);
  const calls = parts.filter(part => part.functionCall).map(part => part.functionCall);
  assert.equal(calls.length, 1, 'Exactly one directory call must be emitted');
  assert.equal(calls[0].name, 'list_dir');
  assert.equal(calls[0].args.DirectoryPath, directory);
  for (const field of ['toolAction', 'toolSummary']) {
    assert.equal(typeof calls[0].args[field], 'string', `${field} must survive translation`);
    assert.ok(calls[0].args[field].length);
  }
  const files = await readdir(directory); // Execute only this known read-only fixture operation.
  assert.deepEqual(files, []);
  const answer = await generate([
    ...contents,
    { role: 'model', parts },
    { role: 'user', parts: [{ functionResponse: { name: 'list_dir', response: { output: 'Empty directory', files } } }] },
  ], `${conversation}/3`);
  assert.ok(!answer.some(part => part.functionCall), 'Model must finish without repeating the call');
  assert.match(answer.map(part => part.text || '').join(''), /empty/i);
  logger.info('[live-verification] PASS: concurrent checkpoint, required tool envelope, real directory read, and follow-up without a repeated call');
} finally {
  session.destroy();
}
