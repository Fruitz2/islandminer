# PETE Holder Rewards Setup

This is the cheap setup. There is no staking program deployment and no 2.5 SOL program-rent deposit.

Creator-fee SOL goes to the distributor wallet. A GitHub Action runs every hour, snapshots `$PETE` holders, sends SOL directly to eligible holders, and commits `data/rewards.json` so the public counter updates.

## Public Wallets

- Pump.fun creator wallet: `7kTwz1Eyc1D1r4p4xnjJwCyrJuVJFPoZSAsrcvBvurZA`
- SOL distributor wallet: `6ANEkZpZbzytNdk9tt6NcWCdKUTLDEF2tSYhw49hpfCr`
- Admin/recovery wallet: `8GEiwuVVHykQTGHDPXjLXx2Szp3uRGXqX2ekrUu29TqB`

Private keys are in `.keys/*.json` and the desktop export. They are gitignored. Do not commit them.

## Required Envs

### GitHub Actions Secrets

Set these in `Fruitz2/islandminer` -> Settings -> Secrets and variables -> Actions -> Repository secrets.

```bash
PETE_MINT=PUT_FINAL_PUMP_FUN_TOKEN_MINT_HERE
DISTRIBUTOR_PRIVATE_KEY=BASE58_PRIVATE_KEY_FROM_DESKTOP_FILE
HELIUS_API_KEY=YOUR_HELIUS_KEY
```

That is the minimum.

Recommended optional secrets:

```bash
DISTRIBUTOR_SOL_RESERVE=0.02
MIN_REWARD_SOL=0.001
MIN_PAYOUT_LAMPORTS=5000
MIN_HOLDER_TOKENS=0
DISTRIBUTION_BATCH_SIZE=12
EXCLUDED_HOLDERS=
```

`HELIUS_RPC_URL` can be set instead of `HELIUS_API_KEY` if you already have the full URL.

### Vercel Envs

Set these in Vercel -> Project -> Settings -> Environment Variables.

```bash
PETE_MINT=PUT_FINAL_PUMP_FUN_TOKEN_MINT_HERE
HELIUS_API_KEY=YOUR_HELIUS_KEY
```

Optional:

```bash
HELIUS_RPC_URL=FULL_HELIUS_RPC_URL_IF_YOU_PREFER
```

Do not put `DISTRIBUTOR_PRIVATE_KEY` in Vercel. The website/API does not need it. Only GitHub Actions needs the private key.

## Launch Flow

1. Launch `$PETE` on Pump.fun.
2. Copy the final `$PETE` mint address.
3. Add `PETE_MINT` to GitHub Actions secrets.
4. Add `PETE_MINT` to Vercel env vars.
5. Make sure GitHub Actions has `DISTRIBUTOR_PRIVATE_KEY` and `HELIUS_API_KEY`.
6. Send Pump.fun creator-fee SOL to the distributor wallet:

```bash
6ANEkZpZbzytNdk9tt6NcWCdKUTLDEF2tSYhw49hpfCr
```

7. Wait for the hourly GitHub Action, or manually run `Hourly Reward Distribution` from the GitHub Actions tab.

The worker leaves `DISTRIBUTOR_SOL_RESERVE` in the distributor wallet and sends the rest to eligible holders.

## Local Test

Use dry-run first. It does not send SOL.

```bash
npm run rewards:dry-run
```

Real payout:

```bash
npm run rewards:distribute
```

## Counter

Public counter:

```bash
https://epsteinminer.xyz/counter/
```

The counter reads:

- `data/rewards.json` for historical distributed SOL
- Jupiter for latest SOL/USD
- the distributor wallet for SOL waiting for the next payout

## Recovery

There is no program vault. Any SOL not distributed stays in the distributor wallet. Import the distributor private key and send it out manually if needed.

## Security

- Rotate any GitHub token pasted into chat.
- Never commit `.env.local`.
- Never commit `.keys/`.
- Never put private keys in Vercel unless there is a very specific reason.
