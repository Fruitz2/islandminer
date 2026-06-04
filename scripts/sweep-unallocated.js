const { LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { loadLocalEnv } = require('../server/load-local-env');
loadLocalEnv();

const { env, requiredKeypair } = require('../server/env');
const { buildSweepTransaction, connection } = require('../server/staking');

(async () => {
  const destination = process.argv[2] || env('ADMIN_PUBLIC_KEY');
  const amountSol = process.argv[3] ? Number(process.argv[3]) : 0;
  if (!destination) throw new Error('Usage: npm run staking:sweep -- DESTINATION_PUBLIC_KEY [amount_sol]');

  const admin = requiredKeypair('ADMIN_PRIVATE_KEY');
  const lamports = amountSol > 0 ? BigInt(Math.floor(amountSol * LAMPORTS_PER_SOL)) : 0n;
  const tx = await buildSweepTransaction(admin, destination, lamports);
  const conn = connection();
  const signature = await conn.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 3
  });

  console.log(`Swept unallocated/stuck SOL: ${signature}`);
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
