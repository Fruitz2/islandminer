const { env, requiredKeypair, sendJson, sendError } = require('../../server/env');

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
    const { LAMPORTS_PER_SOL } = require('@solana/web3.js');
    const { buildFundRewardsTransaction, connection, lamportsToSol } = require('../../server/staking');
    requireCronAuth(req);

    const distributor = requiredKeypair('DISTRIBUTOR_PRIVATE_KEY');
    const reserveSol = Number(env('DISTRIBUTOR_SOL_RESERVE', '0.02'));
    const minRewardSol = Number(env('MIN_REWARD_SOL', '0.001'));
    const reserveLamports = BigInt(Math.floor(reserveSol * LAMPORTS_PER_SOL));
    const minRewardLamports = BigInt(Math.floor(minRewardSol * LAMPORTS_PER_SOL));
    const conn = connection();
    const balance = BigInt(await conn.getBalance(distributor.publicKey));

    if (balance <= reserveLamports + minRewardLamports) {
      return sendJson(res, 200, {
        ok: true,
        funded: false,
        reason: 'Distributor balance is below reward threshold',
        distributor: distributor.publicKey.toBase58(),
        balanceSol: lamportsToSol(balance),
        reserveSol,
        minRewardSol
      });
    }

    const amount = balance - reserveLamports;
    const tx = await buildFundRewardsTransaction(distributor, amount);
    const signature = await conn.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      maxRetries: 3
    });

    sendJson(res, 200, {
      ok: true,
      funded: true,
      signature,
      amountSol: lamportsToSol(amount),
      distributor: distributor.publicKey.toBase58()
    });
  } catch (error) {
    sendError(res, error);
  }
};
