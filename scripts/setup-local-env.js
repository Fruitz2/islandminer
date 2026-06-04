const fs = require('fs');
const path = require('path');
const { parseEnvFile } = require('../server/load-local-env');

const ROOT = process.cwd();
const BUNDLER_ENV_FILES = [
  '/home/nebryx/Documents/Dev/CascadeProjects/BundlerBot/.env',
  '/home/nebryx/Documents/Dev/CascadeProjects/BundlerBot/server/.env'
];

function readBundlerEnv() {
  const merged = {};
  for (const file of BUNDLER_ENV_FILES) {
    if (!fs.existsSync(file)) continue;
    Object.assign(merged, parseEnvFile(file));
  }
  return merged;
}

function readExistingLocalEnv() {
  return parseEnvFile(path.join(ROOT, '.env.local'));
}

function writeEnv(values) {
  const order = [
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

  for (const key of order) {
    lines.push(`${key}=${values[key] || ''}`);
  }

  const out = path.join(ROOT, '.env.local');
  fs.writeFileSync(out, `${lines.join('\n')}\n`, { mode: 0o600 });
  console.log('Wrote ignored local env file: .env.local');
}

const bundler = readBundlerEnv();
const existing = readExistingLocalEnv();

const heliusKey = existing.HELIUS_API_KEY || bundler.HELIUS_API_KEY || '';
const values = {
  SOLANA_NETWORK: existing.SOLANA_NETWORK || bundler.SOLANA_NETWORK || 'mainnet-beta',
  STAKING_PROGRAM_ID: existing.STAKING_PROGRAM_ID || '',
  PETE_MINT: existing.PETE_MINT || '',
  ADMIN_PUBLIC_KEY: existing.ADMIN_PUBLIC_KEY || '',
  DISTRIBUTOR_PUBLIC_KEY: existing.DISTRIBUTOR_PUBLIC_KEY || '',
  HELIUS_API_KEY: heliusKey,
  HELIUS_RPC_URL: existing.HELIUS_RPC_URL || bundler.RPC_URL || (heliusKey ? `https://mainnet.helius-rpc.com/?api-key=${heliusKey}` : ''),
  BIRDEYE_API_KEY: existing.BIRDEYE_API_KEY || bundler.BIRDEYE_API_KEY || '',
  DISTRIBUTOR_PRIVATE_KEY: existing.DISTRIBUTOR_PRIVATE_KEY || (fs.existsSync('.keys/distributor.json') ? '.keys/distributor.json' : ''),
  ADMIN_PRIVATE_KEY: existing.ADMIN_PRIVATE_KEY || (fs.existsSync('.keys/admin.json') ? '.keys/admin.json' : ''),
  CRON_SECRET: existing.CRON_SECRET || '',
  DISTRIBUTOR_SOL_RESERVE: existing.DISTRIBUTOR_SOL_RESERVE || '0.02',
  MIN_REWARD_SOL: existing.MIN_REWARD_SOL || '0.001'
};

writeEnv(values);
