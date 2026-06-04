const els = {
  mode: document.getElementById('staking-mode'),
  walletBtn: document.getElementById('wallet-btn'),
  walletLabel: document.querySelector('#wallet-btn .cb-label'),
  walletStatus: document.getElementById('wallet-status'),
  position: document.getElementById('gs-position'),
  positionNote: document.getElementById('gs-position-note'),
  stepAuth: document.getElementById('step-auth'),
  stepDeploy: document.getElementById('step-deploy'),
  stepClaim: document.getElementById('step-claim'),
  stakeInput: document.getElementById('stake-input'),
  stakeBtn: document.getElementById('stake-btn'),
  unstakeBtn: document.getElementById('unstake-btn'),
  claimBtn: document.getElementById('claim-btn'),
  peteBalance: document.getElementById('pete-bal'),
  peteStaked: document.getElementById('pete-staked'),
  claimableSol: document.getElementById('sol-claimable'),
  claimableUsd: document.getElementById('claimable-usd'),
  message: document.getElementById('stake-message'),
  totalFundedSol: document.getElementById('total-funded-sol'),
  totalFundedUsd: document.getElementById('total-funded-usd'),
  fundedNote: document.getElementById('funded-note'),
  priceNote: document.getElementById('price-note'),
  totalStaked: document.getElementById('total-staked-pete'),
  poolNote: document.getElementById('pool-note'),
  poolLive: document.getElementById('pool-live'),
  poolSummary: document.getElementById('pool-summary'),
  rpcStatus: document.getElementById('rpc-status'),
  priceSource: document.getElementById('price-source'),
  rewardVault: document.getElementById('reward-vault-address'),
  vaultBalance: document.getElementById('vault-balance'),
  distributor: document.getElementById('distributor-address'),
  claimedTotal: document.getElementById('claimed-total'),
  vaultState: document.getElementById('vault-state')
};

let connectedPubkey = null;
let currentStats = null;
let busy = false;

function short(value) {
  if (!value) return '';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function formatSol(value) {
  return `${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4
  })} SOL`;
}

function formatUsd(value) {
  return Number(value || 0).toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function setText(el, value) {
  if (el) el.textContent = value;
}

function setDisabled(el, disabled) {
  if (el) el.disabled = disabled;
}

function setStepState(el, active) {
  if (!el) return;
  el.classList.toggle('active', active);
  el.classList.toggle('disabled', !active);
}

function setMessage(value, tone = '') {
  if (!els.message) return;
  els.message.textContent = value;
  els.message.dataset.tone = tone;
}

function getProvider() {
  const sol = window.solana;
  if (sol && sol.isPhantom) return sol;
  const phantom = window.phantom && window.phantom.solana;
  if (phantom && phantom.isPhantom) return phantom;
  return null;
}

function renderDisconnected() {
  connectedPubkey = null;
  setText(els.walletStatus, 'NODE UNAUTHORIZED');
  if (els.walletStatus) els.walletStatus.classList.remove('connected');
  setText(els.walletLabel, 'CONNECT PHANTOM');
  setText(els.position, 'NOT AUTHORIZED');
  if (els.position) {
    els.position.classList.add('red');
    els.position.classList.remove('cyan');
  }
  setText(els.positionNote, 'connect a node to begin');
  renderStats(currentStats);
}

function renderConnected(pubkey) {
  connectedPubkey = pubkey;
  setText(els.walletStatus, `WALLET AUTHORIZED: ${short(pubkey)}`);
  if (els.walletStatus) els.walletStatus.classList.add('connected');
  setText(els.walletLabel, 'DISCONNECT');
  setText(els.position, short(pubkey));
  if (els.position) {
    els.position.classList.remove('red');
    els.position.classList.add('cyan');
  }
  setText(els.positionNote, 'authorized / reading holder balance');
}

function statusCopy(stats) {
  if (!stats || !stats.stakingConfigured) return ['NEEDS ENV', 'AWAITING CONFIGURATION'];
  if (stats.paused) return ['PAUSED', 'PAUSED BY ADMIN'];
  if (stats.stakingEnabled) return ['LIVE', 'LIVE'];
  return ['SYNCING', 'SYNCING'];
}

function renderStats(stats) {
  currentStats = stats || currentStats;
  const data = currentStats;
  const connected = Boolean(connectedPubkey);
  const enabled = Boolean(data && data.stakingEnabled);
  const [mode, vaultState] = statusCopy(data);

  setText(els.mode, mode);
  setText(els.vaultState, vaultState);
  if (els.vaultState) {
    els.vaultState.classList.toggle('cyan', enabled);
    els.vaultState.classList.toggle('red', !enabled);
  }

  setText(els.totalFundedSol, data ? Number(data.totals.totalFundedSol || 0).toFixed(4) : '0.0000');
  setText(els.totalFundedUsd, data && data.totals.totalFundedUsd ? formatUsd(data.totals.totalFundedUsd) : '$0.00');
  setText(els.totalStaked, data ? String(data.totals.eligibleHolderCount || 0) : '0');
  setText(els.fundedNote, data && data.totals.totalFundedSol > 0 ? 'creator-fee SOL paid' : 'awaiting first fee sweep');
  setText(els.priceNote, data && data.price ? `${data.price.source.toUpperCase()} / ${formatUsd(data.price.priceUsd)}` : 'live SOL/USD pending');
  setText(els.poolNote, data && data.stakingInitialized ? `${data.totals.distributionCount || 0} payout runs` : 'snapshot not initialized');

  setText(els.poolLive, enabled ? 'LIVE' : 'OFFLINE');
  if (els.poolLive) els.poolLive.classList.toggle('online', enabled);
  setText(els.poolSummary, enabled
    ? 'Creator-fee SOL is paid directly from the distributor wallet to eligible $PETE holders on the hourly snapshot.'
    : 'The fee vault is waiting for the token mint and private distributor wallet to be configured.');
  setText(els.rpcStatus, data ? 'ONLINE' : 'WAITING');
  setText(els.priceSource, data && data.price ? data.price.source.toUpperCase() : 'PENDING');
  setText(els.rewardVault, data && data.distributorPublicKey ? data.distributorPublicKey : 'not configured');
  setText(els.vaultBalance, data ? `${formatSol(data.totals.rewardVaultSol)} HELD` : '0.0000 SOL HELD');
  setText(els.distributor, data && data.distributorPublicKey ? data.distributorPublicKey : 'distributor wallet not configured');
  setText(els.claimedTotal, data ? `${formatSol(data.totals.totalClaimedSol)} PAID` : '0.0000 SOL PAID');

  if (connected && data && data.wallet) {
    setText(els.peteBalance, data.wallet.peteBalance || '0');
    setText(els.peteStaked, 'none');
    setText(els.claimableSol, 'automatic');
    setText(els.claimableUsd, 'direct payout');
    setText(els.positionNote, `${data.wallet.peteBalance || '0'} $PETE held`);
  } else {
    setText(els.peteBalance, '--');
    setText(els.peteStaked, 'none');
    setText(els.claimableSol, 'automatic');
    setText(els.claimableUsd, 'direct payout');
  }

  setStepState(els.stepAuth, !connected);
  setStepState(els.stepDeploy, connected);
  setStepState(els.stepClaim, connected);
  setDisabled(els.stakeInput, true);
  setDisabled(els.stakeBtn, true);
  setDisabled(els.unstakeBtn, true);
  setDisabled(els.claimBtn, true);

  if (!data) {
    setMessage('fee vault telemetry unavailable', 'warn');
  } else if (!data.stakingConfigured) {
    setMessage('set PETE_MINT after launch', 'warn');
  } else if (data.paused) {
    setMessage('holder rewards are paused', 'warn');
  } else if (!connected) {
    setMessage('connect Phantom to inspect your $PETE balance');
  } else {
    setMessage('no staking required; payouts are automatic', 'ok');
  }
}

async function fetchStats() {
  const query = connectedPubkey ? `?wallet=${encodeURIComponent(connectedPubkey)}` : '';
  const response = await fetch(`/api/stats${query}`, { cache: 'no-store' });
  const json = await response.json();
  if (!response.ok || !json.ok) throw new Error(json.error || 'Stats unavailable');
  renderStats(json);
}

async function connectWallet() {
  const provider = getProvider();
  if (!provider) {
    window.open('https://phantom.com/', '_blank', 'noopener');
    setMessage('Phantom not detected', 'warn');
    return;
  }

  if (connectedPubkey) {
    if (provider.disconnect) await provider.disconnect();
    renderDisconnected();
    return;
  }

  const response = await provider.connect();
  const pubkey = response && response.publicKey
    ? response.publicKey.toString()
    : provider.publicKey && provider.publicKey.toString();
  if (pubkey) {
    renderConnected(pubkey);
    await fetchStats();
  }
}

function bindWalletEvents() {
  const provider = getProvider();
  if (!provider || !provider.on) return;

  provider.on('connect', (publicKey) => {
    const pk = publicKey ? publicKey.toString() : provider.publicKey && provider.publicKey.toString();
    if (pk) {
      renderConnected(pk);
      fetchStats().catch(() => {});
    }
  });
  provider.on('disconnect', renderDisconnected);
  provider.on('accountChanged', (publicKey) => {
    if (publicKey) {
      renderConnected(publicKey.toString());
      fetchStats().catch(() => {});
    } else {
      renderDisconnected();
    }
  });
}

if (els.walletBtn) els.walletBtn.addEventListener('click', () => connectWallet().catch((error) => setMessage(error.message, 'warn')));

bindWalletEvents();
fetchStats().catch((error) => {
  setMessage(error.message || 'fee vault telemetry unavailable', 'warn');
  renderStats(null);
});

const provider = getProvider();
if (provider && provider.connect) {
  provider.connect({ onlyIfTrusted: true }).then((response) => {
    const pk = response && response.publicKey
      ? response.publicKey.toString()
      : provider.publicKey && provider.publicKey.toString();
    if (pk) {
      renderConnected(pk);
      fetchStats().catch(() => {});
    }
  }).catch(() => {});
}

window.setInterval(() => {
  fetchStats().catch(() => {});
}, 30000);
