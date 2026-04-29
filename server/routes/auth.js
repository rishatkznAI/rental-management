const { normalizeRole } = require('../lib/role-groups');

function registerAuthRoutes(app, deps) {
  const {
    readData,
    writeData,
    verifyPassword,
    hashPassword,
    needsPasswordRehash,
    createSession,
    requireAuth,
    destroySession,
    deleteSessionsForUserIds,
    auditLog,
    getRoleAccessSummary,
    nowIso = () => new Date().toISOString(),
  } = deps;

  const LOGIN_WINDOW_MS = 15 * 60 * 1000;
  const LOGIN_MAX_ATTEMPTS = 10;
  const loginAttempts = new Map();

  function loginAttemptKey(req, email) {
    const forwardedFor = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const ip = forwardedFor || req.ip || req.socket?.remoteAddress || 'unknown';
    return `${ip}:${String(email || '').trim().toLowerCase()}`;
  }

  function getLoginAttempt(req, email) {
    const key = loginAttemptKey(req, email);
    const now = Date.now();
    const current = loginAttempts.get(key);
    if (!current || current.expiresAt <= now) {
      const fresh = { count: 0, expiresAt: now + LOGIN_WINDOW_MS };
      loginAttempts.set(key, fresh);
      return { key, attempt: fresh };
    }
    return { key, attempt: current };
  }

  function recordFailedLogin(req, email) {
    const { attempt } = getLoginAttempt(req, email);
    attempt.count += 1;
  }

  function clearLoginAttempts(req, email) {
    loginAttempts.delete(loginAttemptKey(req, email));
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function rejectLogin(req, res, email, status = 401, auditMetadata = {}) {
    recordFailedLogin(req, email);
    auditLog?.(req, {
      action: 'login.fail',
      entityType: 'auth',
      entityId: String(email || '').trim().toLowerCase() || null,
      metadata: auditMetadata,
    });
    await sleep(Number(process.env.LOGIN_FAILURE_DELAY_MS || 250));
    return res.status(status).json({ ok: false, error: 'Неверный email или пароль' });
  }

  function buildSessionUser(user) {
    const rawRole = user.role;
    const normalizedRole = normalizeRole(rawRole);
    return {
      userId: user.id,
      userName: user.name,
      userRole: normalizedRole,
      rawRole,
      normalizedRole,
      permissions: typeof getRoleAccessSummary === 'function' ? getRoleAccessSummary(normalizedRole) : undefined,
      email: user.email,
      profilePhoto: user.profilePhoto || undefined,
      ownerId: user.ownerId || undefined,
      ownerName: user.ownerName || undefined,
    };
  }

  function isBotOnlyCarrierAccount(user) {
    const role = String(user?.role || '').trim().toLowerCase();
    const isCarrierRole = role === 'перевозчик' || role === 'carrier';
    if (!isCarrierRole) return false;
    // IMPORTANT: carrier users are expected to work through MAX only. Frontend login would
    // expose broader screens than the carrier delivery DTO allows.
    return user.botOnly !== false && user.allowFrontendLogin !== true && user.frontendAccess !== true;
  }

  app.post('/api/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body || {};
      if (!email || !password) {
        return rejectLogin(req, res, email, 401, { reason: 'missing_credentials' });
      }

      const { attempt } = getLoginAttempt(req, email);
      if (attempt.count >= LOGIN_MAX_ATTEMPTS) {
        return res.status(429).json({ ok: false, error: 'Слишком много попыток входа. Попробуйте позже.' });
      }

      const users = readData('users') || [];
      const normalizedEmail = String(email).trim().toLowerCase();
      const user = users.find(
        item => String(item.email || '').trim().toLowerCase() === normalizedEmail
      );

      if (!user) {
        return rejectLogin(req, res, email, 401, { reason: 'invalid_credentials' });
      }

      if (user.status !== 'Активен') {
        return rejectLogin(req, res, email, 401, { reason: 'inactive_account' });
      }

      if (isBotOnlyCarrierAccount(user)) {
        return rejectLogin(req, res, email, 401, { reason: 'carrier_bot_only' });
      }

      if (!verifyPassword(password, user.password)) {
        return rejectLogin(req, res, email, 401, { reason: 'invalid_credentials' });
      }

      clearLoginAttempts(req, email);

      if (typeof needsPasswordRehash === 'function' && needsPasswordRehash(user.password)) {
        const userIndex = users.findIndex(item => item.id === user.id);
        if (userIndex >= 0) {
          users[userIndex] = {
            ...users[userIndex],
            password: hashPassword(String(password)),
          };
          writeData('users', users);
        }
      }

      const token = createSession(user);
      console.log(`[AUTH] Вход: ${user.name} (${user.role})`);
      auditLog?.({ ...req, user: buildSessionUser(user) }, {
        action: 'login.success',
        entityType: 'auth',
        entityId: user.id,
        after: { userId: user.id, email: user.email, role: user.role },
      });

      return res.json({
        ok: true,
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: normalizeRole(user.role),
          rawRole: user.role,
          normalizedRole: normalizeRole(user.role),
          permissions: typeof getRoleAccessSummary === 'function' ? getRoleAccessSummary(user.role) : undefined,
          profilePhoto: user.profilePhoto || undefined,
          ownerId: user.ownerId || undefined,
          ownerName: user.ownerName || undefined,
        },
      });
    } catch (err) {
      console.error('[AUTH] login error:', err.message);
      return res.status(500).json({ ok: false, error: 'Internal server error' });
    }
  });

  app.get('/api/auth/me', requireAuth, (req, res) => {
    const users = readData('users') || [];
    const user = users.find(item => item.id === req.user.userId);
    if (!user || user.status !== 'Активен') {
      const auth = req.headers['authorization'];
      if (auth?.startsWith('Bearer ')) {
        destroySession(auth.slice(7));
      }
      return res.status(401).json({ ok: false, error: 'Аккаунт отключён или удалён' });
    }
    res.json({ ok: true, user: buildSessionUser(user) });
  });

  app.patch('/api/auth/profile', requireAuth, (req, res) => {
    const users = readData('users') || [];
    const idx = users.findIndex(item => item.id === req.user.userId);
    if (idx === -1) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }

    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : users[idx].name;
    const profilePhoto = typeof req.body?.profilePhoto === 'string' && req.body.profilePhoto.trim()
      ? req.body.profilePhoto.trim()
      : undefined;

    if (!name) {
      return res.status(400).json({ ok: false, error: 'Имя не может быть пустым' });
    }

    users[idx] = {
      ...users[idx],
      name,
      profilePhoto,
    };
    writeData('users', users);
    return res.json({ ok: true, user: buildSessionUser(users[idx]) });
  });

  app.post('/api/auth/change-password', requireAuth, (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ ok: false, error: 'Текущий и новый пароль обязательны' });
    }
    if (String(newPassword).trim().length < 4) {
      return res.status(400).json({ ok: false, error: 'Новый пароль должен быть не короче 4 символов' });
    }

    const users = readData('users') || [];
    const idx = users.findIndex(item => item.id === req.user.userId);
    if (idx === -1) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }
    if (!verifyPassword(currentPassword, users[idx].password)) {
      return res.status(400).json({ ok: false, error: 'Текущий пароль введён неверно' });
    }

    users[idx] = {
      ...users[idx],
      password: hashPassword(String(newPassword)),
      tokenVersion: (Number(users[idx].tokenVersion) || 0) + 1,
      passwordChangedAt: nowIso(),
    };
    writeData('users', users);
    deleteSessionsForUserIds([req.user.userId]);
    auditLog?.(req, {
      action: 'password.change',
      entityType: 'users',
      entityId: req.user.userId,
      before: { tokenVersion: req.user.tokenVersion || 0 },
      after: { tokenVersion: users[idx].tokenVersion, passwordChangedAt: users[idx].passwordChangedAt },
    });
    return res.json({ ok: true });
  });

  app.post('/api/auth/logout', requireAuth, (req, res) => {
    const token = req.headers['authorization'].slice(7);
    destroySession(token);
    auditLog?.(req, {
      action: 'logout',
      entityType: 'auth',
      entityId: req.user.userId,
    });
    res.json({ ok: true });
  });

  app.post('/api/auth/logout-user/:userId', requireAuth, (req, res) => {
    if (req.user?.userRole !== 'Администратор') {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    const count = deleteSessionsForUserIds([req.params.userId]);
    auditLog?.(req, {
      action: 'sessions.revoke',
      entityType: 'users',
      entityId: req.params.userId,
      after: { revokedSessions: count },
    });
    return res.json({ ok: true, count });
  });
}

module.exports = {
  registerAuthRoutes,
};
