function normalizeLoginInput(value) {
  const trimmed = String(value || '').trim().toLowerCase();
  return trimmed.split('@')[0] || '';
}

function getEmailLocalPart(email) {
  return String(email || '').trim().toLowerCase().split('@')[0] || '';
}

function findUsersByLogin(users = [], login = '') {
  const normalizedLogin = normalizeLoginInput(login);
  if (!normalizedLogin) return [];
  return (Array.isArray(users) ? users : []).filter(user =>
    getEmailLocalPart(user?.email) === normalizedLogin
  );
}

function resolveUserByLogin(users = [], login = '') {
  const matches = findUsersByLogin(users, login);
  if (matches.length === 1) {
    return { user: matches[0], error: null, matches };
  }
  if (matches.length > 1) {
    return {
      user: null,
      error: 'Найдено несколько пользователей с таким логином. Обратитесь к администратору',
      matches,
    };
  }
  return { user: null, error: null, matches };
}

module.exports = {
  normalizeLoginInput,
  getEmailLocalPart,
  findUsersByLogin,
  resolveUserByLogin,
};
