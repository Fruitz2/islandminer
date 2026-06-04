const { loadLocalEnv } = require('../server/load-local-env');
loadLocalEnv();

const { distributeHolderRewards } = require('../server/holder-rewards');

(async () => {
  const result = await distributeHolderRewards({ dryRun: process.argv.includes('--dry-run') });
  console.log(JSON.stringify(result, null, 2));
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
