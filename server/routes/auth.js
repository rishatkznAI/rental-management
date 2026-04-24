function registerAuthRoutes(app, deps) {
  const {
    readData,
    writeData,
    verifyPassword,
    hashPassword,
    createSession,
    requireAuth,
    destroySession,
    deleteSessionsForUserIds,
  } = deps;

  function buildSessionUser(user) {
    return {
      userId: user.id,
      userName: user.name,
      userRole: user.role,
      email: user.email,
      profilePhoto: user.profilePhoto || undefined,
      ownerId: user.ownerId || undefined,
      ownerName: user.ownerName || undefined,
    };
  }

  app.post('/api/auth/login', (req, res) => {
    try {
      const { email, password } = req.body || {};
      if (!email || !password) {
        return res.status(400).json({ ok: false, error: 'email and password required' });
      }

      const users = readData('users') || [];
      const normalizedEmail = String(email).trim().toLowerCase();
      const user = users.find(
        item => String(item.email || '').trim().toLowerCase() === normalizedEmail
      );

      if (!user) {
        return res.status(401).json({ ok: false, error: 'Пользователь с таким email не найден' });
      }

      if (user.status !== 'Активен') {
        return res.status(403).json({ ok: false, error: 'Аккаунт деактивирован. Обратитесь к администратору' });
      }

      if (!verifyPassword(password, user.password)) {
        return res.status(401).json({ ok: false, error: 'Неверный пароль' });
      }

      const token = createSession(user);
      console.log(`[AUTH] Вход: ${user.name} (${user.role})`);

      return res.json({
        ok: true,
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          profilePhoto: user.profilePhoto || undefined,
          ownerId: user.ownerId || undefined,
          ownerName: user.ownerName || undefined,
        },
      });
    } catch (err) {
      console.error('[AUTH] login error:', err.message);
      return res.status(500).json({ ok: false, error: err.message });
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
    };
    writeData('users', users);
    return res.json({ ok: true });
  });

  app.post('/api/auth/logout', requireAuth, (req, res) => {
    const token = req.headers['authorization'].slice(7);
    destroySession(token);
    res.json({ ok: true });
  });

  app.post('/api/auth/logout-user/:userId', requireAuth, (req, res) => {
    if (req.user?.userRole !== 'Администратор') {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    const count = deleteSessionsForUserIds([req.params.userId]);
    return res.json({ ok: true, count });
  });
}

module.exports = {
  registerAuthRoutes,
};
