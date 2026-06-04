const { env, sendJson, sendError } = require('../../server/env');

function requireCronAuth(req) {
  const secret = env('CRON_SECRET');
  if (!secret) return;

  const actual = req.headers.authorization || '';
  const expected = `Bearer ${secret}`;
  if (actual !== expected) {
    const error = new Error('Unauthorized cron request');
    error.statusCode = 401;
    throw error;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
  }

  try {
    const { distributeHolderRewards } = require('../../server/holder-rewards');
    requireCronAuth(req);
    sendJson(res, 200, await distributeHolderRewards());
  } catch (error) {
    sendError(res, error);
  }
};
