# PETE Staking Setup

This repo is safe to push public. Real API keys and private keys live only in Vercel env vars or the ignored local files `.env.local` and `.keys/`.

## Generated Local Wallets

- Creator wallet for Pump.fun launch: `7kTwz1Eyc1D1r4p4xnjJwCyrJuVJFPoZSAsrcvBvurZA`
- Distributor wallet for fee sweeps: `6ANEkZpZbzytNdk9tt6NcWCdKUTLDEF2tSYhw49hpfCr`
- Admin/recovery wallet: `8GEiwuVVHykQTGHDPXjLXx2Szp3uRGXqX2ekrUu29TqB`
- Staking program ID: `BxXchZ6JkP4ybA74BfA1itf7fGv6XqFtwnwSDX6JaCsj`

Private keys are in `.keys/*.json`. That folder is gitignored. Back it up somewhere private before using real funds.

## Lazy Launch Flow

1. Launch `$PETE` on Pump.fun using the creator wallet above, or set your Pump creator/fee recipient to that wallet.
2. Put the final `$PETE` mint address into `.env.local` as `PETE_MINT=...`.
3. Deploy the staking program:

```bash
anchor build
anchor deploy --program-keypair .keys/pete_staking-keypair.json
npm run staking:init
```

4. Set these Vercel env vars from `.env.local`:

```bash
STAKING_PROGRAM_ID
PETE_MINT
ADMIN_PUBLIC_KEY
DISTRIBUTOR_PUBLIC_KEY
HELIUS_API_KEY
HELIUS_RPC_URL
BIRDEYE_API_KEY
DISTRIBUTOR_PRIVATE_KEY
CRON_SECRET
DISTRIBUTOR_SOL_RESERVE
MIN_REWARD_SOL
```

For Vercel, do not use `.keys/distributor.json` as the env value. That path only works locally. Use the base58 private key from `~/Desktop/epstein private keys.txt` for:

```bash
DISTRIBUTOR_PRIVATE_KEY
```

Keep `ADMIN_PRIVATE_KEY` local unless you intentionally add an admin-only recovery endpoint later. The current deployed app does not need it.

5. Manually send claimed Pump.fun creator-fee SOL to the distributor wallet.
6. GitHub Actions calls `/api/cron/distribute` every hour and funds the reward vault.

Vercel only hosts the website and API endpoint. The hourly scheduler lives in `.github/workflows/hourly-distribute.yml`, so the project does not need Vercel Cron or Render. GitHub Actions needs these repository secrets:

```bash
CRON_SECRET
DISTRIBUTE_URL
```

If the scheduler is disabled or you want to fund manually, run:

```bash
npm run staking:fund -- 0.1
```

## Recovery

The admin wallet can sweep unallocated or accidentally stuck SOL without touching SOL already owed to stakers:

```bash
npm run staking:sweep -- YOUR_DESTINATION_WALLET
```

## Security Rules

- Do not commit `.env.local`.
- Do not commit `.keys/`.
- Do not prefix secrets with `VITE_`.
- Rotate any GitHub token pasted into chat.
