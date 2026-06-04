const { loadLocalEnv } = require('../server/load-local-env');
loadLocalEnv();

const { env, requiredKeypair } = require('../server/env');

(async () => {
  if (!env('PETE_MINT')) {
    console.log('PETE_MINT is not set yet; reward funding skipped.');
    return;
  }

  if (!env('DISTRIBUTOR_PRIVATE_KEY')) {
    console.log('DISTRIBUTOR_PRIVATE_KEY is not set; reward funding skipped.');
    return;
  }

  const { LAMPORTS_PER_SOL } = require('@solana/web3.js');
  const { buildFundRewardsTransaction, connection, lamportsToSol } = require('../server/staking');
  const distributor = requiredKeypair('DISTRIBUTOR_PRIVATE_KEY');
  const conn = connection();
  const amountArg = process.argv[2];
  let lamports;

  if (amountArg) {
    const amountSol = Number(amountArg);
    if (!Number.isFinite(amountSol) || amountSol <= 0) {
      throw new Error('Usage: npm run staking:fund -- 0.1');
    }
    lamports = BigInt(Math.floor(amountSol * LAMPORTS_PER_SOL));
  } else {
    const reserveSol = Number(env('DISTRIBUTOR_SOL_RESERVE', '0.02'));
    const minRewardSol = Number(env('MIN_REWARD_SOL', '0.001'));
    const reserveLamports = BigInt(Math.floor(reserveSol * LAMPORTS_PER_SOL));
    const minRewardLamports = BigInt(Math.floor(minRewardSol * LAMPORTS_PER_SOL));
    const balance = BigInt(await conn.getBalance(distributor.publicKey));

    if (balance <= reserveLamports + minRewardLamports) {
      console.log(`Distributor balance ${lamportsToSol(balance)} SOL is below reward threshold; skipped.`);
      return;
    }

    lamports = balance - reserveLamports;
  }

  const tx = await buildFundRewardsTransaction(distributor, lamports);
  const signature = await conn.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 3
  });

  console.log(`Funded ${lamportsToSol(lamports)} SOL rewards: ${signature}`);
})().catch((error) => {
  if (/Staking program is not initialized yet/.test(error.message || '')) {
    console.log('Staking program is not initialized yet; reward funding skipped.');
    return;
  }

  console.error(error.message);
  process.exit(1);
});
