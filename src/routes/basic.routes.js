const indexController = require('../controllers/index.controller');
const mainController = require('../controllers/main.controller');
const authController = require('../controllers/auth.controller');

function registerBasicRoutes(app) {
  app.get('/api/index', indexController.index);
  app.get('/api/main', mainController.main);
  app.get('/api/auth', authController.authInfo);
  app.post('/api/auth/login', authController.login);
  app.post('/api/auth/logout', authController.logout);
}

module.exports = { registerBasicRoutes };