const { sendJson, sendError } = require('../server/env');
const { fetchSolPriceUsd } = require('../server/price');

module.exports = async function handler(req, res) {
  try {
    const price = await fetchSolPriceUsd();
    sendJson(res, 200, {
      ok: true,
      ...price
    });
  } catch (error) {
    sendError(res, error);
  }
};
