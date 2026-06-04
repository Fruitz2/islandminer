const { env, getCluster, sendJson } = require('../server/env');

module.exports = async function handler(req, res) {
  const configured = Boolean(env('STAKING_PROGRAM_ID') && env('PETE_MINT'));
  let pdas = null;

  if (configured) {
    try {
      const { derivePdas } = require('../server/staking');
      const derived = derivePdas();
      pdas = {
        config: derived.config.toBase58(),
        stakeVault: derived.stakeVault.toBase58(),
        rewardVault: derived.rewardVault.toBase58()
      };
    } catch (_) {
      pdas = null;
    }
  }

  sendJson(res, 200, {
    ok: true,
    cluster: getCluster(),
    rpcMode: 'server-proxy',
    stakingConfigured: configured,
    programId: env('STAKING_PROGRAM_ID'),
    peteMint: env('PETE_MINT'),
    adminPublicKey: env('ADMIN_PUBLIC_KEY'),
    distributorPublicKey: env('DISTRIBUTOR_PUBLIC_KEY'),
    pdas
  });
};
