function index(_req, res) {
  res.json({
    controller: 'index',
    service: 'flow',
    now: new Date().toISOString(),
    routes: {
      main: '/api/main',
      auth: '/api/auth',
    },
  });
}

module.exports = { index };