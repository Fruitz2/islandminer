const crypto = require('crypto');
const {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  LAMPORTS_PER_SOL
} = require('@solana/web3.js');
const {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync
} = require('@solana/spl-token');
const { env, getRpcUrl, requiredEnv } = require('./env');

const SCALE = 1_000_000_000_000n;
const ZERO_PUBKEY = '11111111111111111111111111111111';

function connection() {
  return new Connection(getRpcUrl(), 'confirmed');
}

function publicKeyFromEnv(name) {
  const value = env(name);
  if (!value) return null;
  return new PublicKey(value);
}

function programId() {
  return new PublicKey(requiredEnv('STAKING_PROGRAM_ID'));
}

function peteMint() {
  return new PublicKey(requiredEnv('PETE_MINT'));
}

function derivePdas(program = programId()) {
  const [config] = PublicKey.findProgramAddressSync([Buffer.from('config')], program);
  const [stakeVault] = PublicKey.findProgramAddressSync([Buffer.from('stake_vault')], program);
  const [rewardVault] = PublicKey.findProgramAddressSync([Buffer.from('reward_vault')], program);
  return { config, stakeVault, rewardVault };
}

function derivePosition(owner, program = programId()) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('position'), new PublicKey(owner).toBuffer()],
    program
  )[0];
}

function discriminator(name) {
  return crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

function u64(value) {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(BigInt(value));
  return out;
}

function instructionData(name, args = []) {
  return Buffer.concat([discriminator(name), ...args]);
}

function readPubkey(buffer, offset) {
  return [new PublicKey(buffer.subarray(offset, offset + 32)).toBase58(), offset + 32];
}

function readU8(buffer, offset) {
  return [buffer.readUInt8(offset), offset + 1];
}

function readBool(buffer, offset) {
  return [buffer.readUInt8(offset) !== 0, offset + 1];
}

function readU64(buffer, offset) {
  return [buffer.readBigUInt64LE(offset), offset + 8];
}

function readU128(buffer, offset) {
  const low = buffer.readBigUInt64LE(offset);
  const high = buffer.readBigUInt64LE(offset + 8);
  return [(high << 64n) + low, offset + 16];
}

function decodeConfig(data) {
  if (!data || data.length < 8 + 189) return null;
  let offset = 8;
  let admin;
  let mint;
  let stakeVault;
  let rewardVault;
  let bump;
  let stakeVaultBump;
  let rewardVaultBump;
  let tokenDecimals;
  let paused;
  let totalStaked;
  let rewardPerTokenAccumulated;
  let allocatedUnclaimedLamports;
  let unallocatedRewardsLamports;
  let totalFundedLamports;
  let totalClaimedLamports;

  [admin, offset] = readPubkey(data, offset);
  [mint, offset] = readPubkey(data, offset);
  [stakeVault, offset] = readPubkey(data, offset);
  [rewardVault, offset] = readPubkey(data, offset);
  [bump, offset] = readU8(data, offset);
  [stakeVaultBump, offset] = readU8(data, offset);
  [rewardVaultBump, offset] = readU8(data, offset);
  [tokenDecimals, offset] = readU8(data, offset);
  [paused, offset] = readBool(data, offset);
  [totalStaked, offset] = readU64(data, offset);
  [rewardPerTokenAccumulated, offset] = readU128(data, offset);
  [allocatedUnclaimedLamports, offset] = readU64(data, offset);
  [unallocatedRewardsLamports, offset] = readU64(data, offset);
  [totalFundedLamports, offset] = readU64(data, offset);
  [totalClaimedLamports] = readU64(data, offset);

  return {
    admin,
    peteMint: mint,
    stakeVault,
    rewardVault,
    bump,
    stakeVaultBump,
    rewardVaultBump,
    tokenDecimals,
    paused,
    totalStaked,
    rewardPerTokenAccumulated,
    allocatedUnclaimedLamports,
    unallocatedRewardsLamports,
    totalFundedLamports,
    totalClaimedLamports
  };
}

function decodePosition(data) {
  if (!data || data.length < 8 + 65) return null;
  let offset = 8;
  let owner;
  let amountStaked;
  let rewardDebt;
  let pendingRewardsLamports;
  let bump;

  [owner, offset] = readPubkey(data, offset);
  [amountStaked, offset] = readU64(data, offset);
  [rewardDebt, offset] = readU128(data, offset);
  [pendingRewardsLamports, offset] = readU64(data, offset);
  [bump] = readU8(data, offset);

  if (owner === ZERO_PUBKEY) return null;

  return {
    owner,
    amountStaked,
    rewardDebt,
    pendingRewardsLamports,
    bump
  };
}

function rawToDecimal(raw, decimals, maxFraction = 4) {
  const value = BigInt(raw || 0);
  const base = 10n ** BigInt(decimals || 0);
  const whole = value / base;
  const frac = value % base;
  if (decimals === 0 || frac === 0n || maxFraction === 0) return whole.toString();
  const fracText = frac.toString().padStart(decimals, '0').slice(0, maxFraction).replace(/0+$/, '');
  return fracText ? `${whole}.${fracText}` : whole.toString();
}

function decimalToRaw(amount, decimals) {
  const text = String(amount || '').trim();
  if (!/^\d+(\.\d+)?$/.test(text)) {
    const error = new Error('Amount must be a positive number');
    error.statusCode = 400;
    throw error;
  }

  const [whole, fraction = ''] = text.split('.');
  if (fraction.length > decimals) {
    const error = new Error(`Amount has too many decimals for this token`);
    error.statusCode = 400;
    throw error;
  }

  const rawText = `${whole}${fraction.padEnd(decimals, '0')}`.replace(/^0+/, '') || '0';
  const raw = BigInt(rawText);
  if (raw <= 0n) {
    const error = new Error('Amount must be greater than zero');
    error.statusCode = 400;
    throw error;
  }
  return raw;
}

function lamportsToSol(lamports) {
  return Number(lamports || 0n) / LAMPORTS_PER_SOL;
}

async function getConfig(connectionInstance = connection()) {
  const configured = Boolean(env('STAKING_PROGRAM_ID') && env('PETE_MINT'));
  if (!configured) {
    return {
      configured: false,
      exists: false,
      pdas: null,
      data: null
    };
  }

  const program = programId();
  const pdas = derivePdas(program);
  const account = await connectionInstance.getAccountInfo(pdas.config);
  return {
    configured: true,
    exists: Boolean(account),
    pdas,
    data: account ? decodeConfig(account.data) : null
  };
}

async function getMintDecimals(connectionInstance, mintPublicKey) {
  const parsed = await connectionInstance.getParsedAccountInfo(mintPublicKey);
  const decimals = parsed.value &&
    parsed.value.data &&
    parsed.value.data.parsed &&
    parsed.value.data.parsed.info &&
    parsed.value.data.parsed.info.decimals;
  if (!Number.isInteger(decimals)) throw new Error('Unable to read PETE mint decimals');
  return decimals;
}

async function getTokenBalance(connectionInstance, owner, mintPublicKey) {
  const response = await connectionInstance.getParsedTokenAccountsByOwner(owner, { mint: mintPublicKey });
  return response.value.reduce((total, entry) => {
    const amount = entry.account.data.parsed.info.tokenAmount.amount;
    return total + BigInt(amount);
  }, 0n);
}

function claimableFor(config, position) {
  if (!config || !position) return 0n;
  let accrued = 0n;
  if (position.amountStaked > 0n) {
    const delta = config.rewardPerTokenAccumulated - position.rewardDebt;
    accrued = position.amountStaked * delta / SCALE;
  }
  return position.pendingRewardsLamports + accrued;
}

async function stakingStats(wallet) {
  const conn = connection();
  const priceSafe = { priceUsd: 0, source: 'unavailable', fetchedAt: new Date().toISOString() };
  const configState = await getConfig(conn);
  const mintKey = configState.data ? new PublicKey(configState.data.peteMint) : publicKeyFromEnv('PETE_MINT');
  let tokenDecimals = configState.data ? configState.data.tokenDecimals : 6;
  let rewardVaultBalance = 0n;
  let walletTokenBalance = null;
  let positionData = null;
  let claimableLamports = 0n;

  if (mintKey && !configState.data) {
    try {
      tokenDecimals = await getMintDecimals(conn, mintKey);
    } catch (_) {}
  }

  if (configState.pdas) {
    try {
      rewardVaultBalance = BigInt(await conn.getBalance(configState.pdas.rewardVault));
    } catch (_) {
      rewardVaultBalance = 0n;
    }
  }

  if (wallet && mintKey) {
    const owner = new PublicKey(wallet);
    walletTokenBalance = await getTokenBalance(conn, owner, mintKey);

    if (configState.configured) {
      const position = derivePosition(owner);
      const account = await conn.getAccountInfo(position);
      positionData = account ? decodePosition(account.data) : null;
      claimableLamports = claimableFor(configState.data, positionData);
    }
  }

  return {
    ok: true,
    stakingConfigured: configState.configured,
    stakingInitialized: configState.exists,
    stakingEnabled: Boolean(configState.configured && configState.exists && configState.data && !configState.data.paused),
    paused: Boolean(configState.data && configState.data.paused),
    programId: env('STAKING_PROGRAM_ID') || '',
    peteMint: mintKey ? mintKey.toBase58() : '',
    adminPublicKey: env('ADMIN_PUBLIC_KEY') || (configState.data && configState.data.admin) || '',
    distributorPublicKey: env('DISTRIBUTOR_PUBLIC_KEY') || '',
    pdas: configState.pdas ? {
      config: configState.pdas.config.toBase58(),
      stakeVault: configState.pdas.stakeVault.toBase58(),
      rewardVault: configState.pdas.rewardVault.toBase58()
    } : null,
    tokenDecimals,
    totals: {
      totalStakedRaw: configState.data ? configState.data.totalStaked.toString() : '0',
      totalStaked: rawToDecimal(configState.data ? configState.data.totalStaked : 0n, tokenDecimals, 2),
      rewardVaultSol: lamportsToSol(rewardVaultBalance),
      allocatedUnclaimedSol: lamportsToSol(configState.data ? configState.data.allocatedUnclaimedLamports : 0n),
      unallocatedSol: lamportsToSol(configState.data ? configState.data.unallocatedRewardsLamports : 0n),
      totalFundedSol: lamportsToSol(configState.data ? configState.data.totalFundedLamports : 0n),
      totalClaimedSol: lamportsToSol(configState.data ? configState.data.totalClaimedLamports : 0n)
    },
    wallet: wallet ? {
      address: wallet,
      peteBalanceRaw: walletTokenBalance === null ? null : walletTokenBalance.toString(),
      peteBalance: walletTokenBalance === null ? null : rawToDecimal(walletTokenBalance, tokenDecimals, 2),
      stakedRaw: positionData ? positionData.amountStaked.toString() : '0',
      staked: rawToDecimal(positionData ? positionData.amountStaked : 0n, tokenDecimals, 2),
      claimableLamports: claimableLamports.toString(),
      claimableSol: lamportsToSol(claimableLamports)
    } : null,
    price: priceSafe
  };
}

async function attachPrice(stats, fetchSolPriceUsd) {
  const price = await fetchSolPriceUsd();
  stats.price = price;
  stats.totals.totalFundedUsd = stats.totals.totalFundedSol * price.priceUsd;
  stats.totals.totalClaimedUsd = stats.totals.totalClaimedSol * price.priceUsd;
  stats.totals.allocatedUnclaimedUsd = stats.totals.allocatedUnclaimedSol * price.priceUsd;
  if (stats.wallet) {
    stats.wallet.claimableUsd = stats.wallet.claimableSol * price.priceUsd;
  }
  return stats;
}

async function buildUserTransaction(type, wallet, amount) {
  const conn = connection();
  const owner = new PublicKey(wallet);
  const configState = await getConfig(conn);
  if (!configState.configured || !configState.exists || !configState.data) {
    const error = new Error('Staking program is not initialized yet');
    error.statusCode = 400;
    throw error;
  }
  if (configState.data.paused) {
    const error = new Error('Staking is paused');
    error.statusCode = 400;
    throw error;
  }

  const program = programId();
  const mint = new PublicKey(configState.data.peteMint);
  const pdas = configState.pdas;
  const position = derivePosition(owner, program);
  const userTokenAccount = getAssociatedTokenAddressSync(mint, owner);
  const tx = new Transaction();
  tx.feePayer = owner;
  tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;

  if (type === 'stake' || type === 'unstake') {
    const rawAmount = decimalToRaw(amount, configState.data.tokenDecimals);
    const keys = [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: pdas.config, isSigner: false, isWritable: true },
      { pubkey: position, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: userTokenAccount, isSigner: false, isWritable: true },
      { pubkey: pdas.stakeVault, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
    ];
    tx.add(new TransactionInstruction({
      programId: program,
      keys,
      data: instructionData(type, [u64(rawAmount)])
    }));
  } else if (type === 'claim') {
    tx.add(new TransactionInstruction({
      programId: program,
      keys: [
        { pubkey: owner, isSigner: true, isWritable: true },
        { pubkey: pdas.config, isSigner: false, isWritable: true },
        { pubkey: position, isSigner: false, isWritable: true },
        { pubkey: pdas.rewardVault, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
      ],
      data: instructionData('claim')
    }));
  } else {
    const error = new Error('Unsupported transaction type');
    error.statusCode = 400;
    throw error;
  }

  return tx;
}

async function buildInitializeTransaction(admin, mintAddress) {
  const conn = connection();
  const payer = new PublicKey(admin);
  const mint = new PublicKey(mintAddress);
  const pdas = derivePdas();
  const tx = new Transaction();
  tx.feePayer = payer;
  tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
  tx.add(new TransactionInstruction({
    programId: programId(),
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: pdas.config, isSigner: false, isWritable: true },
      { pubkey: pdas.stakeVault, isSigner: false, isWritable: true },
      { pubkey: pdas.rewardVault, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }
    ],
    data: instructionData('initialize')
  }));
  return tx;
}

async function buildFundRewardsTransaction(funder, amountLamports) {
  const conn = connection();
  const configState = await getConfig(conn);
  if (!configState.configured || !configState.exists || !configState.data) {
    const error = new Error('Staking program is not initialized yet');
    error.statusCode = 400;
    throw error;
  }

  const tx = new Transaction();
  tx.feePayer = funder.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
  tx.add(new TransactionInstruction({
    programId: programId(),
    keys: [
      { pubkey: funder.publicKey, isSigner: true, isWritable: true },
      { pubkey: configState.pdas.config, isSigner: false, isWritable: true },
      { pubkey: configState.pdas.rewardVault, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
    ],
    data: instructionData('fund_rewards', [u64(amountLamports)])
  }));
  tx.sign(funder);
  return tx;
}

async function buildSweepTransaction(admin, destination, amountLamports) {
  const conn = connection();
  const configState = await getConfig(conn);
  if (!configState.configured || !configState.exists || !configState.data) {
    const error = new Error('Staking program is not initialized yet');
    error.statusCode = 400;
    throw error;
  }

  const tx = new Transaction();
  tx.feePayer = admin.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
  tx.add(new TransactionInstruction({
    programId: programId(),
    keys: [
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      { pubkey: configState.pdas.config, isSigner: false, isWritable: true },
      { pubkey: configState.pdas.rewardVault, isSigner: false, isWritable: true },
      { pubkey: new PublicKey(destination), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
    ],
    data: instructionData('sweep_unallocated', [u64(BigInt(amountLamports || 0))])
  }));
  tx.sign(admin);
  return tx;
}

module.exports = {
  LAMPORTS_PER_SOL,
  connection,
  derivePdas,
  derivePosition,
  getConfig,
  stakingStats,
  attachPrice,
  buildUserTransaction,
  buildInitializeTransaction,
  buildFundRewardsTransaction,
  buildSweepTransaction,
  decimalToRaw,
  lamportsToSol,
  rawToDecimal
};
