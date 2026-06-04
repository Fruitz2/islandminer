const fs = require('fs');
const path = require('path');
const bs58Module = require('bs58');

const bs58 = bs58Module.default || bs58Module;

const DEFAULT_ENV = {
  SOLANA_NETWORK: 'mainnet-beta',
  REWARD_MODE: 'holder-distribution',
  ADMIN_PUBLIC_KEY: '8GEiwuVVHykQTGHDPXjLXx2Szp3uRGXqX2ekrUu29TqB',
  DISTRIBUTOR_PUBLIC_KEY: '6ANEkZpZbzytNdk9tt6NcWCdKUTLDEF2tSYhw49hpfCr'
};

function env(name, fallback = '') {
  return process.env[name] || DEFAULT_ENV[name] || fallback;
}

function requiredEnv(name) {
  const value = env(name);
  if (!value) {
    const error = new Error(`Missing required env var: ${name}`);
    error.statusCode = 500;
    throw error;
  }
  return value;
}

function getCluster() {
  return env('SOLANA_NETWORK', 'mainnet-beta');
}

function getRpcUrl() {
  const direct = env('HELIUS_RPC_URL');
  if (direct) return direct;

  const key = env('HELIUS_API_KEY');
  if (key) return `https://mainnet.helius-rpc.com/?api-key=${key}`;

  return 'https://api.mainnet-beta.solana.com';
}

function parseKeypair(value) {
  if (!value) return null;
  const trimmed = value.trim();
  const { Keypair } = require('@solana/web3.js');

  if (trimmed.startsWith('[')) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(trimmed)));
  }

  const maybePath = path.resolve(process.cwd(), trimmed);
  if (fs.existsSync(maybePath)) {
    const raw = fs.readFileSync(maybePath, 'utf8');
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  }

  return Keypair.fromSecretKey(bs58.decode(trimmed));
}

function requiredKeypair(name) {
  const keypair = parseKeypair(requiredEnv(name));
  if (!keypair) {
    const error = new Error(`Invalid keypair env var: ${name}`);
    error.statusCode = 500;
    throw error;
  }
  return keypair;
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function sendError(res, error) {
  const status = error.statusCode || 500;
  sendJson(res, status, {
    ok: false,
    error: error.message || 'Unexpected server error'
  });
}

module.exports = {
  env,
  requiredEnv,
  getCluster,
  getRpcUrl,
  parseKeypair,
  requiredKeypair,
  sendJson,
  sendError
};
