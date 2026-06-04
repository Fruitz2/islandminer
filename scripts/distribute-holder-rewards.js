const { loadLocalEnv } = require('../server/load-local-env');
loadLocalEnv();

const { distributeHolderRewards } = require('../server/holder-rewards');

(async () => {
  const dryRun = process.argv.includes('--dry-run');
  const result = await distributeHolderRewards({ dryRun });

  if (!result.distributed && !result.dryRun) {
    console.log(`Skipped: ${result.reason}`);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (dryRun) {
    console.log('Dry run complete. No SOL was sent and the ledger was not updated.');
  } else {
    console.log(`Distributed ${result.amountSol.toFixed(6)} SOL to ${result.recipientCount} holders.`);
  }
  console.log(JSON.stringify(result, null, 2));
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
