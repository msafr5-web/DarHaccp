// Vercel serverless entry: the Express API compiled from backend/ during the build.
// Served from the same project and domain as the web app (/api/v1), so no CORS is involved.
const { createApp } = require('../backend/dist/app');

module.exports = createApp();
