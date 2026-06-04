const { loadLocalEnv } = require('../server/load-local-env');
loadLocalEnv();

const { requiredEnv, requiredKeypair } = require('../server/env');
const { buildInitializeTransaction, connection } = require('../server/staking');

(async () => {
  const admin = requiredKeypair('ADMIN_PRIVATE_KEY');
  const mint = requiredEnv('PETE_MINT');
  const tx = await buildInitializeTransaction(admin.publicKey.toBase58(), mint);
  tx.sign(admin);

  const conn = connection();
  const signature = await conn.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 3
  });

  console.log(`Initialized staking config: ${signature}`);
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
