#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { parseQwenSsePayload, upstreamErrorResponse, fetchUpstream } = require('../core.js');

const tests = [];
function test(name, fn) { tests.push([name, fn]); }

const sse = (events) => events.map((o) => `data: ${JSON.stringify(o)}\n\n`).join('') + 'data: [DONE]\n\n';

test('cumulative thinking_summary phases are not duplicated', () => {
  const payload = sse([
    { choices: [{ delta: { role: 'assistant', reasoning_content: 'A' } }] },
    { choices: [{ delta: { role: 'assistant', reasoning_content: 'AB' } }] },
    { choices: [{ delta: { role: 'assistant', reasoning_content: 'ABC' } }] },
  ]);
  assert.strictEqual(parseQwenSsePayload(payload).reasoning_content, 'ABC');
});

test('genuinely incremental reasoning still concatenates', () => {
  const payload = sse([
    { choices: [{ delta: { role: 'assistant', reasoning_content: 'A' } }] },
    { choices: [{ delta: { role: 'assistant', reasoning_content: 'B' } }] },
  ]);
  assert.strictEqual(parseQwenSsePayload(payload).reasoning_content, 'AB');
});

test('content is unaffected by the reasoning merge', () => {
  const payload = sse([
    { choices: [{ delta: { role: 'assistant', content: 'he' } }] },
    { choices: [{ delta: { role: 'assistant', content: 'llo' } }] },
  ]);
  assert.strictEqual(parseQwenSsePayload(payload).content, 'hello');
});

test('quota exhaustion maps to 429 rate_limit_error, not 502', () => {
  const r = upstreamErrorResponse({ message: "You've reached the upper limit for today's usage.", code: 'RateLimited' });
  assert.strictEqual(r.statusCode, 429);
  assert.strictEqual(JSON.parse(r.body).error.type, 'rate_limit_error');
});

test('other upstream errors still map to 502 api_error', () => {
  const r = upstreamErrorResponse({ message: 'Upstream WAF blocked the request.' });
  assert.strictEqual(r.statusCode, 502);
  assert.strictEqual(JSON.parse(r.body).error.type, 'api_error');
});

test('a network failure becomes a handled 502, never an uncaught throw', async () => {
  const resp = await fetchUpstream('http://127.0.0.1:1/nope', { method: 'POST' });
  assert.strictEqual(resp.ok, false);
  assert.strictEqual(resp.status, 502);
  assert.ok((await resp.text()).startsWith('Upstream request failed:'));
});

(async () => {
  console.log('core regression checks');
  let passed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
    } catch (err) {
      console.error(`\n  FAIL  ${name}\n`);
      console.error(err);
      process.exit(1);
    }
    passed += 1;
    console.log(`  ok  ${name}`);
  }
  console.log(`\n${passed} checks passed`);
})();
