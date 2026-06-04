const { sendJson, sendError } = require('../server/env');

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
  }

  try {
    const { connection } = require('../server/staking');
    const body = await readBody(req);
    if (!body.transaction) {
      const error = new Error('Missing signed transaction');
      error.statusCode = 400;
      throw error;
    }

    const signature = await connection().sendRawTransaction(Buffer.from(body.transaction, 'base64'), {
      skipPreflight: false,
      maxRetries: 3
    });

    sendJson(res, 200, {
      ok: true,
      signature
    });
  } catch (error) {
    sendError(res, error);
  }
};
