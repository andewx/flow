const { createApp } = require('./src/app');

const port = Number(process.env.PORT || 3000);
const app = createApp();

app.listen(port, () => {
  console.log(`Flow is running at http://localhost:${port}`);
});