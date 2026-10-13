import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canTransition, isManualTransition, maskId, MATTER_STATUSES, MATTER_TRANSITIONS } from './domain';
import { createClientSchema, npwpSchema } from './schemas';

test('status berkas mengikuti state diagram', () => {
  assert.ok(canTransition('intake', 'documents'));
  assert.ok(canTransition('review', 'drafting'));
  assert.ok(!canTransition('intake', 'signed'), 'tidak boleh lompat ke signed');
  assert.ok(!canTransition('signed', 'cancelled'), 'akta bernomor tidak bisa dibatalkan');
  assert.ok(!canTransition('done', 'intake'));
});

test('status akhir tidak punya transisi keluar', () => {
  assert.deepEqual(MATTER_TRANSITIONS.done, []);
  assert.deepEqual(MATTER_TRANSITIONS.cancelled, []);
  for (const s of MATTER_STATUSES) {
    for (const t of MATTER_TRANSITIONS[s]) assert.ok(MATTER_STATUSES.includes(t));
  }
});

test('transisi sistem tidak bisa dilakukan manual', () => {
  assert.ok(!isManualTransition('scheduled', 'signed'));
  assert.ok(!isManualTransition('review', 'scheduled'));
  assert.ok(isManualTransition('intake', 'documents'));
  assert.ok(isManualTransition('signed', 'filing'));
});

test('NIK disamarkan', () => {
  assert.equal(maskId('3171012345670001'), '3171********0001');
  assert.equal(maskId(null), null);
});

test('validasi klien', () => {
  assert.ok(!createClientSchema.safeParse({ type: 'person', fullName: 'Budi' }).success, 'NIK wajib');
  assert.ok(
    createClientSchema.safeParse({ type: 'person', fullName: 'Budi', nik: '3171012345670001' }).success,
  );
  assert.ok(createClientSchema.safeParse({ type: 'company', fullName: 'PT Maju' }).success);
  assert.equal(npwpSchema.parse('01.234.567.8-901.000'), '012345678901000');
});
