const { env, getCluster, sendJson } = require('../server/env');

module.exports = async function handler(req, res) {
  const configured = Boolean(env('PETE_MINT') && env('DISTRIBUTOR_PUBLIC_KEY'));

  sendJson(res, 200, {
    ok: true,
    mode: 'holder-distribution',
    cluster: getCluster(),
    rpcMode: 'server-proxy',
    stakingConfigured: configured,
    programId: '',
    peteMint: env('PETE_MINT'),
    adminPublicKey: env('ADMIN_PUBLIC_KEY'),
    distributorPublicKey: env('DISTRIBUTOR_PUBLIC_KEY'),
    pdas: null
  });
};
