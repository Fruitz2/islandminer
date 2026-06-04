const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Keypair } = require('@solana/web3.js');
const { loadLocalEnv, parseEnvFile } = require('../server/load-local-env');

const ROOT = process.cwd();
const KEY_DIR = path.join(ROOT, '.keys');

function writeKeypair(name, keypair) {
  const file = path.join(KEY_DIR, `${name}.json`);
  if (fs.existsSync(file)) {
    const existing = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, 'utf8'))));
    return { file, keypair: existing, created: false };
  }

  fs.writeFileSync(file, JSON.stringify(Array.from(keypair.secretKey)), { mode: 0o600 });
  return { file, keypair, created: true };
}

function replaceAll(file, replacements) {
  let text = fs.readFileSync(file, 'utf8');
  for (const [from, to] of replacements) {
    text = text.split(from).join(to);
  }
  fs.writeFileSync(file, text);
}

function patchProgramId(programId) {
  const lib = path.join(ROOT, 'programs/pete_staking/src/lib.rs');
  const anchor = path.join(ROOT, 'Anchor.toml');

  let libText = fs.readFileSync(lib, 'utf8');
  libText = libText.replace(/declare_id!\("[1-9A-HJ-NP-Za-km-z]{32,44}"\);/, `declare_id!("${programId}");`);
  fs.writeFileSync(lib, libText);

  let anchorText = fs.readFileSync(anchor, 'utf8');
  anchorText = anchorText.replace(/pete_staking = "[1-9A-HJ-NP-Za-km-z]{32,44}"/g, `pete_staking = "${programId}"`);
  fs.writeFileSync(anchor, anchorText);
}

function updateLocalEnv(values) {
  const file = path.join(ROOT, '.env.local');
  const current = parseEnvFile(file);
  const merged = { ...current, ...values };
  const keys = [
    'SOLANA_NETWORK',
    'STAKING_PROGRAM_ID',
    'PETE_MINT',
    'ADMIN_PUBLIC_KEY',
    'DISTRIBUTOR_PUBLIC_KEY',
    'HELIUS_API_KEY',
    'HELIUS_RPC_URL',
    'BIRDEYE_API_KEY',
    'DISTRIBUTOR_PRIVATE_KEY',
    'ADMIN_PRIVATE_KEY',
    'CRON_SECRET',
    'DISTRIBUTOR_SOL_RESERVE',
    'MIN_REWARD_SOL'
  ];
  const lines = [
    '# Local secrets for Palm Beach Pete staking.',
    '# This file is gitignored. Do not paste these values into public code.',
    ''
  ];
  for (const key of keys) lines.push(`${key}=${merged[key] || ''}`);
  fs.writeFileSync(file, `${lines.join('\n')}\n`, { mode: 0o600 });
}

fs.mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
loadLocalEnv();

const wallets = [
  writeKeypair('creator', Keypair.generate()),
  writeKeypair('distributor', Keypair.generate()),
  writeKeypair('admin', Keypair.generate()),
  writeKeypair('pete_staking-keypair', Keypair.generate())
];

const program = wallets.find((entry) => entry.file.endsWith('pete_staking-keypair.json')).keypair;
const admin = wallets.find((entry) => entry.file.endsWith('admin.json')).keypair;
const distributor = wallets.find((entry) => entry.file.endsWith('distributor.json')).keypair;

const placeholder = 'PeteStaking1111111111111111111111111111111';
const programId = program.publicKey.toBase58();
replaceAll(path.join(ROOT, 'programs/pete_staking/src/lib.rs'), [[placeholder, programId]]);
replaceAll(path.join(ROOT, 'Anchor.toml'), [[placeholder, programId]]);
patchProgramId(programId);

updateLocalEnv({
  SOLANA_NETWORK: process.env.SOLANA_NETWORK || 'mainnet-beta',
  STAKING_PROGRAM_ID: programId,
  ADMIN_PUBLIC_KEY: admin.publicKey.toBase58(),
  DISTRIBUTOR_PUBLIC_KEY: distributor.publicKey.toBase58(),
  ADMIN_PRIVATE_KEY: '.keys/admin.json',
  DISTRIBUTOR_PRIVATE_KEY: '.keys/distributor.json',
  CRON_SECRET: process.env.CRON_SECRET || crypto.randomBytes(24).toString('hex'),
  DISTRIBUTOR_SOL_RESERVE: process.env.DISTRIBUTOR_SOL_RESERVE || '0.02',
  MIN_REWARD_SOL: process.env.MIN_REWARD_SOL || '0.001'
});

for (const entry of wallets) {
  const label = path.basename(entry.file, '.json');
  console.log(`${entry.created ? 'Created' : 'Using existing'} ${label}: ${entry.keypair.publicKey.toBase58()}`);
}
console.log('Updated ignored .env.local with public wallet IDs and local key paths.');
console.log('Private keys are stored only in .keys/, which is gitignored.');
