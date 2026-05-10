import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendClientContact,
  appendClientNote,
  validateClientContactDraft,
  validateClientNoteDraft,
} from '../src/app/lib/clientRailActions.js';

test('adding a contact keeps existing client contacts', () => {
  const client = {
    id: 'C-1',
    contacts: [{ id: 'old', name: 'Иван', phone: '+7 900' }],
  };
  const validation = validateClientContactDraft({
    name: 'Мария',
    role: 'Бухгалтер',
    phone: '+7 901',
    email: 'maria@example.test',
  });

  assert.equal(validation.ok, true);
  const updated = appendClientContact(client, validation.value);

  assert.equal(updated.contacts.length, 2);
  assert.equal(updated.contacts[0].name, 'Иван');
  assert.equal(updated.contacts[1].name, 'Мария');
  assert.equal(updated.contacts[1].role, 'Бухгалтер');
});

test('empty contact and malformed email are rejected', () => {
  assert.deepEqual(validateClientContactDraft({ name: ' ', phone: '', email: '' }), {
    ok: false,
    field: 'name',
    message: 'Укажите имя, телефон или email.',
  });

  const invalidEmail = validateClientContactDraft({ name: 'Иван', email: 'not-an-email' });
  assert.equal(invalidEmail.ok, false);
  assert.equal(invalidEmail.field, 'email');
});

test('empty note is rejected and valid note appends without replacing old text', () => {
  assert.equal(validateClientNoteDraft('   ').ok, false);

  const validation = validateClientNoteDraft('Позвонить бухгалтеру');
  assert.equal(validation.ok, true);

  const updated = appendClientNote(
    { id: 'C-1', notes: 'Старое примечание' },
    validation.value,
    { author: 'Офис', createdAt: '2026-05-10T09:00:00.000Z' },
  );

  assert.match(updated.notes, /Старое примечание/);
  assert.match(updated.notes, /\[2026-05-10\] Офис:/);
  assert.match(updated.notes, /Позвонить бухгалтеру/);
});
