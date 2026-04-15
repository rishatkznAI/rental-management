function registerAuthRoutes(app, deps) {
  const {
    readData,
    verifyPassword,
    createSession,
    requireAuth,
    destroySession,
  } = deps;

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
        },
      });
    } catch (err) {
      console.error('[AUTH] login error:', err.message);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/auth/me', requireAuth, (req, res) => {
    res.json({ ok: true, user: req.user });
  });

  app.post('/api/auth/logout', requireAuth, (req, res) => {
    const token = req.headers['authorization'].slice(7);
    destroySession(token);
    res.json({ ok: true });
  });
}

module.exports = {
  registerAuthRoutes,
};
