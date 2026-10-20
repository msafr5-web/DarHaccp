// Vercel serverless entry point: serves the Express app compiled by `npm run vercel-build`.
const { createApp } = require('../dist/app');

module.exports = createApp();
