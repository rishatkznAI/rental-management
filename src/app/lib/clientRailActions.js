function text(value) {
  return String(value || '').trim();
}

export function isLikelyEmail(value) {
  const email = text(value);
  if (!email) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validateClientContactDraft(draft = {}) {
  const name = text(draft.name);
  const phone = text(draft.phone);
  const email = text(draft.email);
  const role = text(draft.role);
  const comment = text(draft.comment);

  if (!name && !phone && !email) {
    return { ok: false, field: 'name', message: 'Укажите имя, телефон или email.' };
  }
  if (email && !isLikelyEmail(email)) {
    return { ok: false, field: 'email', message: 'Проверьте формат email.' };
  }
  return {
    ok: true,
    value: {
      id: draft.id || `contact-${Date.now()}`,
      name: name || phone || email,
      ...(role ? { role } : {}),
      ...(phone ? { phone } : {}),
      ...(email ? { email } : {}),
      ...(comment ? { comment } : {}),
    },
  };
}

export function appendClientContact(client = {}, contact) {
  const current = Array.isArray(client.contacts) ? client.contacts : [];
  return {
    ...client,
    contacts: [...current, contact],
  };
}

export function validateClientNoteDraft(value) {
  const note = text(value);
  if (!note) return { ok: false, field: 'note', message: 'Введите текст заметки.' };
  return { ok: true, value: note };
}

export function appendClientNote(client = {}, note, options = {}) {
  const createdAt = options.createdAt || new Date().toISOString();
  const author = text(options.author) || 'Система';
  const prefix = `[${createdAt.slice(0, 10)}] ${author}:`;
  const previous = text(client.notes);
  return {
    ...client,
    notes: previous ? `${previous}\n\n${prefix}\n${note}` : `${prefix}\n${note}`,
  };
}
