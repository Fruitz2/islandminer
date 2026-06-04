const { LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { loadLocalEnv } = require('../server/load-local-env');
loadLocalEnv();

const { requiredKeypair } = require('../server/env');
const { buildFundRewardsTransaction, connection, lamportsToSol } = require('../server/staking');

(async () => {
  const amountSol = Number(process.argv[2] || '0');
  if (!Number.isFinite(amountSol) || amountSol <= 0) {
    throw new Error('Usage: npm run staking:fund -- 0.1');
  }

  const distributor = requiredKeypair('DISTRIBUTOR_PRIVATE_KEY');
  const lamports = BigInt(Math.floor(amountSol * LAMPORTS_PER_SOL));
  const tx = await buildFundRewardsTransaction(distributor, lamports);
  const conn = connection();
  const signature = await conn.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 3
  });

  console.log(`Funded ${lamportsToSol(lamports)} SOL rewards: ${signature}`);
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
