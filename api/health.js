const { sendJson } = require('../server/env');

module.exports = async function handler(req, res) {
  sendJson(res, 200, {
    ok: true,
    service: 'pete-holder-rewards',
    time: new Date().toISOString()
  });
};
