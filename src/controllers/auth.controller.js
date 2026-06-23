function authInfo(_req, res) {
  res.json({
    controller: 'auth',
    message: 'Auth controller is online.',
    endpoints: {
      login: 'POST /api/auth/login',
      logout: 'POST /api/auth/logout',
    },
  });
}

function login(req, res) {
  const username = String(req.body?.username || '').trim();

  if (!username) {
    res.status(400).json({ error: 'username is required' });
    return;
  }

  res.json({
    controller: 'auth',
    action: 'login',
    user: username,
    authenticated: true,
  });
}

function logout(_req, res) {
  res.json({
    controller: 'auth',
    action: 'logout',
    authenticated: false,
  });
}

module.exports = {
  authInfo,
  login,
  logout,
};