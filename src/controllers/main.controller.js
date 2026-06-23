function main(_req, res) {
  res.json({
    controller: 'main',
    message: 'Flow main controller is responding.',
    status: 'ok',
  });
}

module.exports = { main };