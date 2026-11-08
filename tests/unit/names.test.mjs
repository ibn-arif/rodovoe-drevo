import { test } from 'node:test';
import assert from 'node:assert/strict';
import { norm, validateName } from '../../js/names.js';

test('norm treats I, l, 1 and ӏ as the palochka', () => {
  const target = norm('ХӀасан');
  assert.equal(norm('ХIасан'), target);
  assert.equal(norm('Хlасан'), target);
  assert.equal(norm('Х1асан'), target);
  assert.equal(norm('хӏасан'), target);
});

test('norm treats ё as е', () => {
  assert.equal(norm('Алёна'), norm('Алена'));
});

test('validateName', () => {
  assert.deepEqual(validateName('  Али '), { ok: true, value: 'Али' });
  assert.deepEqual(validateName('   '), { ok: false, error: 'Введите имя' });
  assert.deepEqual(validateName('а'.repeat(101)), { ok: false, error: 'Слишком длинное имя' });
  assert.deepEqual(validateName('Али\nРасул'), { ok: false, error: 'Имя в одну строку' });
  assert.equal(validateName('а'.repeat(100)).ok, true);
});

test('validateName rejects invisible and control-character names', () => {
  for (const bad of ['\u00a0\u200b', 'Али\u000b', 'Али\u2028Расул', '\u200b\u200b']) assert.equal(validateName(bad).ok, false, JSON.stringify(bad));
  assert.deepEqual(validateName('\u00a0Али\u00a0'), { ok: true, value: 'Али' });
});
