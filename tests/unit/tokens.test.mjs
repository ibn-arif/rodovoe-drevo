import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newToken, derive, hashToken, treeLink, readTokenFromHash } from '../../js/tokens.js';

test('newToken is 22 url-safe chars and random', () => {
  const a = newToken(), b = newToken();
  assert.match(a, /^[A-Za-z0-9_-]{22}$/);
  assert.notEqual(a, b);
});

test('derive is deterministic and differs per role', async () => {
  const o = 'owner-token-1234567890';
  const e1 = await derive(o, 'edit'), e2 = await derive(o, 'edit'), v = await derive(o, 'view');
  assert.equal(e1, e2);
  assert.notEqual(e1, v);
  assert.match(e1, /^[A-Za-z0-9_-]{22}$/);
});

test('hashToken matches SQL sha256 hex', async () => {
  assert.equal(await hashToken('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('links', () => {
  assert.equal(treeLink('abc', 'https://x.github.io/drevo/'), 'https://x.github.io/drevo/tree.html#t=abc');
  assert.equal(readTokenFromHash('#t=abc_-9'), 'abc_-9');
  assert.equal(readTokenFromHash('#t='), null);
  assert.equal(readTokenFromHash(''), null);
  assert.equal(readTokenFromHash('#t=abc%20'), 'abc');
});
