const fs = require('fs');
const path = require('path');
const {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction
} = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const { env, getRpcUrl, requiredKeypair } = require('./env');

const DEFAULT_LEDGER = {
  version: 1,
  mode: 'holder-distribution',
  updatedAt: null,
  peteMint: '',
  distributorPublicKey: '',
  tokenDecimals: 6,
  totals: {
    totalDistributedLamports: '0',
    distributionCount: 0,
    recipientCount: 0
  },
  lastDistribution: null,
  distributions: []
};

function connection() {
  return new Connection(getRpcUrl(), 'confirmed');
}

function ledgerPath() {
  return path.resolve(process.cwd(), env('REWARD_LEDGER_PATH', 'data/rewards.json'));
}

function readLedger() {
  const file = ledgerPath();
  if (!fs.existsSync(file)) return { ...DEFAULT_LEDGER };

  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      ...DEFAULT_LEDGER,
      ...parsed,
      totals: {
        ...DEFAULT_LEDGER.totals,
        ...(parsed.totals || {})
      },
      distributions: Array.isArray(parsed.distributions) ? parsed.distributions : []
    };
  } catch (_) {
    return { ...DEFAULT_LEDGER };
  }
}

function writeLedger(ledger) {
  const file = ledgerPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(ledger, null, 2)}\n`);
}

function lamportsToSol(lamports) {
  return Number(BigInt(lamports || 0n)) / LAMPORTS_PER_SOL;
}

function solToLamports(sol) {
  return BigInt(Math.floor(Number(sol || 0) * LAMPORTS_PER_SOL));
}

function parseCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function decimalToRaw(amount, decimals) {
  const text = String(amount || '0').trim();
  if (!/^\d+(\.\d+)?$/.test(text)) return 0n;
  const [whole, fraction = ''] = text.split('.');
  const safeFraction = fraction.slice(0, decimals).padEnd(decimals, '0');
  return BigInt(`${whole}${safeFraction}`.replace(/^0+/, '') || '0');
}

function rawToDecimal(raw, decimals, maxFraction = 2) {
  const value = BigInt(raw || 0n);
  const base = 10n ** BigInt(decimals || 0);
  const whole = value / base;
  const fraction = value % base;
  if (!fraction || !decimals || !maxFraction) return whole.toString();
  const text = fraction
    .toString()
    .padStart(decimals, '0')
    .slice(0, maxFraction)
    .replace(/0+$/, '');
  return text ? `${whole}.${text}` : whole.toString();
}

function holderMinRaw(decimals) {
  const explicitRaw = env('MIN_HOLDER_TOKEN_RAW');
  if (explicitRaw && /^\d+$/.test(explicitRaw)) return BigInt(explicitRaw);
  return decimalToRaw(env('MIN_HOLDER_TOKENS', '0'), decimals);
}

async function getMintInfo(conn, mint) {
  const account = await conn.getAccountInfo(mint, 'confirmed');
  if (!account) throw new Error('PETE mint account was not found on mainnet');

  let decimals = 6;
  try {
    const parsed = await conn.getParsedAccountInfo(mint, 'confirmed');
    decimals = parsed.value &&
      parsed.value.data &&
      parsed.value.data.parsed &&
      parsed.value.data.parsed.info &&
      parsed.value.data.parsed.info.decimals;
  } catch (_) {}

  return {
    tokenProgram: account.owner || TOKEN_PROGRAM_ID,
    decimals: Number.isInteger(decimals) ? decimals : 6
  };
}

async function getHolderSnapshot(mintAddress, conn = connection()) {
  const mint = new PublicKey(mintAddress);
  const { tokenProgram, decimals } = await getMintInfo(conn, mint);
  const excluded = new Set([
    '11111111111111111111111111111111',
    ...parseCsv(env('EXCLUDED_HOLDERS')),
    ...parseCsv(env('EXCLUDED_HOLDER_WALLETS'))
  ]);
  const allowOffCurve = env('ALLOW_OFF_CURVE_HOLDERS', 'false').toLowerCase() === 'true';
  const minRaw = holderMinRaw(decimals);
  const accounts = await conn.getProgramAccounts(tokenProgram, {
    filters: [{ memcmp: { offset: 0, bytes: mint.toBase58() } }],
    dataSlice: { offset: 0, length: 72 }
  });
  const byOwner = new Map();

  for (const entry of accounts) {
    const data = entry.account.data;
    if (!data || data.length < 72) continue;

    const owner = new PublicKey(data.subarray(32, 64));
    const ownerText = owner.toBase58();
    if (!allowOffCurve && !PublicKey.isOnCurve(owner.toBytes())) continue;
    if (excluded.has(ownerText)) continue;

    const amount = data.readBigUInt64LE(64);
    if (amount <= 0n) continue;

    byOwner.set(ownerText, (byOwner.get(ownerText) || 0n) + amount);
  }

  const holders = Array.from(byOwner.entries())
    .map(([owner, rawAmount]) => ({ owner, rawAmount }))
    .filter((holder) => holder.rawAmount >= minRaw)
    .sort((a, b) => (a.rawAmount === b.rawAmount ? 0 : a.rawAmount > b.rawAmount ? -1 : 1));
  const totalRaw = holders.reduce((total, holder) => total + holder.rawAmount, 0n);

  return {
    mint: mint.toBase58(),
    tokenProgram: tokenProgram.toBase58(),
    decimals,
    holders,
    totalRaw,
    minRaw
  };
}

function buildPayouts(snapshot, amountLamports) {
  const minPayoutLamports = BigInt(env('MIN_PAYOUT_LAMPORTS', '5000'));
  const payouts = [];
  let distributedLamports = 0n;

  if (!snapshot.totalRaw || snapshot.totalRaw <= 0n) {
    return { payouts, distributedLamports, dustLamports: amountLamports };
  }

  for (const holder of snapshot.holders) {
    const lamports = amountLamports * holder.rawAmount / snapshot.totalRaw;
    if (lamports < minPayoutLamports) continue;

    payouts.push({
      owner: holder.owner,
      tokenRaw: holder.rawAmount.toString(),
      lamports
    });
    distributedLamports += lamports;
  }

  return {
    payouts,
    distributedLamports,
    dustLamports: amountLamports - distributedLamports
  };
}

async function sendPayouts(conn, distributor, payouts) {
  const batchSize = Math.max(1, Math.min(20, Number(env('DISTRIBUTION_BATCH_SIZE', '12')) || 12));
  const signatures = [];

  for (let i = 0; i < payouts.length; i += batchSize) {
    const chunk = payouts.slice(i, i + batchSize);
    const tx = new Transaction();
    tx.feePayer = distributor.publicKey;
    tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;

    for (const payout of chunk) {
      tx.add(SystemProgram.transfer({
        fromPubkey: distributor.publicKey,
        toPubkey: new PublicKey(payout.owner),
        lamports: Number(payout.lamports)
      }));
    }

    const signature = await sendAndConfirmTransaction(conn, tx, [distributor], {
      commitment: 'confirmed',
      maxRetries: 3
    });
    signatures.push({
      signature,
      recipients: chunk.length,
      lamports: chunk.reduce((total, payout) => total + payout.lamports, 0n).toString()
    });
  }

  return signatures;
}

function recordDistribution(result) {
  const ledger = readLedger();
  const now = new Date().toISOString();
  const previousTotal = BigInt(ledger.totals.totalDistributedLamports || '0');
  const entry = {
    id: now.replace(/[-:.TZ]/g, '').slice(0, 14),
    createdAt: now,
    peteMint: result.peteMint,
    distributorPublicKey: result.distributorPublicKey,
    tokenDecimals: result.tokenDecimals,
    eligibleHolderCount: result.eligibleHolderCount,
    recipientCount: result.recipientCount,
    eligibleTokenRaw: result.eligibleTokenRaw,
    eligibleToken: result.eligibleToken,
    amountLamports: result.amountLamports,
    amountSol: result.amountSol,
    dustLamports: result.dustLamports,
    reserveSol: result.reserveSol,
    signatures: result.signatures
  };

  ledger.updatedAt = now;
  ledger.peteMint = result.peteMint;
  ledger.distributorPublicKey = result.distributorPublicKey;
  ledger.tokenDecimals = result.tokenDecimals;
  ledger.totals = {
    totalDistributedLamports: (previousTotal + BigInt(result.amountLamports)).toString(),
    distributionCount: Number(ledger.totals.distributionCount || 0) + 1,
    recipientCount: Number(ledger.totals.recipientCount || 0) + result.recipientCount
  };
  ledger.lastDistribution = entry;
  ledger.distributions = [entry, ...ledger.distributions].slice(0, Number(env('LEDGER_MAX_DISTRIBUTIONS', '100')) || 100);
  writeLedger(ledger);
  return ledger;
}

async function distributeHolderRewards(options = {}) {
  const dryRun = Boolean(options.dryRun);
  const mint = env('PETE_MINT');
  if (!mint) {
    return {
      ok: true,
      distributed: false,
      reason: 'PETE_MINT is not set yet'
    };
  }

  if (!env('DISTRIBUTOR_PRIVATE_KEY')) {
    return {
      ok: true,
      distributed: false,
      reason: 'DISTRIBUTOR_PRIVATE_KEY is not set yet'
    };
  }

  const distributor = requiredKeypair('DISTRIBUTOR_PRIVATE_KEY');
  const conn = connection();
  const reserveSol = Number(env('DISTRIBUTOR_SOL_RESERVE', '0.02'));
  const minRewardSol = Number(env('MIN_REWARD_SOL', '0.001'));
  const reserveLamports = solToLamports(reserveSol);
  const minRewardLamports = solToLamports(minRewardSol);
  const balance = BigInt(await conn.getBalance(distributor.publicKey, 'confirmed'));

  if (balance <= reserveLamports + minRewardLamports) {
    return {
      ok: true,
      distributed: false,
      reason: 'Distributor balance is below reward threshold',
      distributorPublicKey: distributor.publicKey.toBase58(),
      balanceSol: lamportsToSol(balance),
      reserveSol,
      minRewardSol
    };
  }

  const snapshot = await getHolderSnapshot(mint, conn);
  if (!snapshot.holders.length || snapshot.totalRaw <= 0n) {
    return {
      ok: true,
      distributed: false,
      reason: 'No eligible holders found',
      peteMint: mint,
      distributorPublicKey: distributor.publicKey.toBase58(),
      balanceSol: lamportsToSol(balance),
      eligibleHolderCount: 0
    };
  }

  const amountLamports = balance - reserveLamports;
  const { payouts, distributedLamports, dustLamports } = buildPayouts(snapshot, amountLamports);
  if (!payouts.length || distributedLamports <= 0n) {
    return {
      ok: true,
      distributed: false,
      reason: 'All holder payouts are below MIN_PAYOUT_LAMPORTS',
      peteMint: mint,
      distributorPublicKey: distributor.publicKey.toBase58(),
      eligibleHolderCount: snapshot.holders.length,
      balanceSol: lamportsToSol(balance)
    };
  }

  const signatures = dryRun ? [] : await sendPayouts(conn, distributor, payouts);
  const result = {
    ok: true,
    dryRun,
    distributed: !dryRun,
    peteMint: mint,
    distributorPublicKey: distributor.publicKey.toBase58(),
    tokenDecimals: snapshot.decimals,
    eligibleHolderCount: snapshot.holders.length,
    recipientCount: payouts.length,
    eligibleTokenRaw: snapshot.totalRaw.toString(),
    eligibleToken: rawToDecimal(snapshot.totalRaw, snapshot.decimals, 2),
    amountLamports: distributedLamports.toString(),
    amountSol: lamportsToSol(distributedLamports),
    dustLamports: dustLamports.toString(),
    reserveSol,
    signatures
  };

  if (!dryRun) recordDistribution(result);
  return result;
}

async function getWalletTokenBalance(conn, wallet, mintAddress, decimals) {
  if (!wallet || !mintAddress) return null;
  const owner = new PublicKey(wallet);
  const mint = new PublicKey(mintAddress);
  const response = await conn.getParsedTokenAccountsByOwner(owner, { mint });
  const raw = response.value.reduce((total, entry) => {
    const amount = entry.account.data.parsed.info.tokenAmount.amount;
    return total + BigInt(amount);
  }, 0n);
  return {
    raw: raw.toString(),
    ui: rawToDecimal(raw, decimals, 2)
  };
}

async function holderRewardStats(wallet) {
  const conn = connection();
  const ledger = readLedger();
  const mint = env('PETE_MINT') || ledger.peteMint || '';
  const distributorPublicKey = env('DISTRIBUTOR_PUBLIC_KEY') || ledger.distributorPublicKey || '';
  const configured = Boolean(mint && distributorPublicKey);
  const totalDistributedLamports = BigInt(ledger.totals.totalDistributedLamports || '0');
  let distributorBalance = 0n;
  let walletBalance = null;

  if (distributorPublicKey) {
    try {
      distributorBalance = BigInt(await conn.getBalance(new PublicKey(distributorPublicKey), 'confirmed'));
    } catch (_) {
      distributorBalance = 0n;
    }
  }

  if (wallet && mint) {
    try {
      walletBalance = await getWalletTokenBalance(conn, wallet, mint, ledger.tokenDecimals || 6);
    } catch (_) {
      walletBalance = null;
    }
  }

  return {
    ok: true,
    mode: 'holder-distribution',
    stakingConfigured: configured,
    stakingInitialized: configured,
    stakingEnabled: configured,
    paused: false,
    programId: '',
    peteMint: mint,
    adminPublicKey: '',
    distributorPublicKey,
    pdas: null,
    tokenDecimals: ledger.tokenDecimals || 6,
    totals: {
      totalStakedRaw: ledger.lastDistribution ? ledger.lastDistribution.eligibleTokenRaw : '0',
      totalStaked: ledger.lastDistribution ? ledger.lastDistribution.eligibleToken : '0',
      eligibleHolderCount: ledger.lastDistribution ? ledger.lastDistribution.eligibleHolderCount : 0,
      recipientCount: ledger.lastDistribution ? ledger.lastDistribution.recipientCount : 0,
      distributionCount: Number(ledger.totals.distributionCount || 0),
      rewardVaultSol: lamportsToSol(distributorBalance),
      allocatedUnclaimedSol: lamportsToSol(distributorBalance),
      unallocatedSol: lamportsToSol(distributorBalance),
      totalFundedSol: lamportsToSol(totalDistributedLamports),
      totalClaimedSol: lamportsToSol(totalDistributedLamports)
    },
    wallet: wallet ? {
      address: wallet,
      peteBalanceRaw: walletBalance ? walletBalance.raw : null,
      peteBalance: walletBalance ? walletBalance.ui : null,
      stakedRaw: '0',
      staked: 'not required',
      claimableLamports: '0',
      claimableSol: 0
    } : null,
    publicLedger: {
      updatedAt: ledger.updatedAt,
      lastDistribution: ledger.lastDistribution,
      distributions: ledger.distributions.slice(0, 10)
    },
    price: { priceUsd: 0, source: 'unavailable', fetchedAt: new Date().toISOString() }
  };
}

async function attachPrice(stats, fetchSolPriceUsd) {
  const price = await fetchSolPriceUsd();
  stats.price = price;
  stats.totals.totalFundedUsd = stats.totals.totalFundedSol * price.priceUsd;
  stats.totals.totalClaimedUsd = stats.totals.totalClaimedSol * price.priceUsd;
  stats.totals.allocatedUnclaimedUsd = stats.totals.allocatedUnclaimedSol * price.priceUsd;
  if (stats.wallet) {
    stats.wallet.claimableUsd = 0;
  }
  return stats;
}

module.exports = {
  connection,
  distributeHolderRewards,
  getHolderSnapshot,
  holderRewardStats,
  attachPrice,
  lamportsToSol,
  readLedger,
  writeLedger,
  rawToDecimal
};
