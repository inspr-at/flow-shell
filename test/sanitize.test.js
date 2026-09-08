import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, sanitizeRef, sanitizeUrl, sanitizeText } from '../src/sanitize.js';

test('escapeHtml neutralizes markup', () => {
  assert.equal(escapeHtml('<script>"&\'</script>'), '&lt;script&gt;&quot;&amp;&#39;&lt;/script&gt;');
});

test('sanitizeRef accepts opaque refs only', () => {
  assert.equal(sanitizeRef('batch_42'), 'batch_42');
  assert.equal(sanitizeRef('../evil'), null);
  assert.equal(sanitizeRef(''), null);
});

test('sanitizeUrl allows http(s) only', () => {
  assert.equal(sanitizeUrl('https://example.test/health'), 'https://example.test/health');
  assert.equal(sanitizeUrl('javascript:alert(1)'), null);
});

test('sanitizeText trims and caps length', () => {
  assert.equal(sanitizeText('  hello   world  '), 'hello world');
  assert.equal(sanitizeText('x'.repeat(10), { maxLength: 3 }), 'xxx');
});
