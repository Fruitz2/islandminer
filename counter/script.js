(function () {
  'use strict';

  var state = {
    mainSol: 0,
    mainUsd: 0,
    claimedSol: 0,
    claimedUsd: 0,
    unclaimedSol: 0,
    unclaimedUsd: 0,
    vaultSol: 0
  };

  function el(id) {
    return document.getElementById(id);
  }

  function setText(id, value) {
    var node = el(id);
    if (node) node.textContent = value;
  }

  function fmtSol(value, digits) {
    return Number(value || 0).toLocaleString(undefined, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function fmtUsd(value) {
    return Number(value || 0).toLocaleString(undefined, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function short(value) {
    if (!value) return 'not configured';
    return value.length > 18 ? value.slice(0, 8) + '...' + value.slice(-8) : value;
  }

  function animateValue(key, target, render) {
    var start = Number(state[key] || 0);
    var end = Number(target || 0);
    if (Math.abs(start - end) < 0.000001) {
      render(end);
      return;
    }

    var begun = performance.now();
    var duration = 900;

    function frame(now) {
      var t = Math.min(1, (now - begun) / duration);
      var eased = 1 - Math.pow(1 - t, 3);
      var value = start + (end - start) * eased;
      render(value);
      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        state[key] = end;
        render(end);
      }
    }

    requestAnimationFrame(frame);
  }

  function statusLabel(data) {
    if (!data.stakingConfigured) return 'AWAITING ENV';
    if (!data.stakingInitialized) return 'AWAITING INIT';
    if (data.paused) return 'PAUSED';
    if (data.stakingEnabled) return 'LIVE';
    return 'SYNCING';
  }

  function narrative(data) {
    if (!data.stakingConfigured) {
      return 'The vault is staged. Once the token mint and staking program are configured in Vercel, this page starts reading live reward data.';
    }
    if (!data.stakingInitialized) {
      return 'The program ID is known and the fee vault is standing by. After launch, the admin initializes the staking config with the final $PETE mint.';
    }
    if (data.totals.totalFundedSol > 0) {
      return 'Creator-fee SOL has entered the vault. Stakers can claim their share from the program while this counter keeps the public record visible.';
    }
    return 'The staking vault is live. The next creator-fee sweep from the distributor wallet will move the public counter for the first time.';
  }

  function render(data) {
    var label = statusLabel(data);
    var live = el('live-state');
    if (live) {
      live.classList.toggle('ready', data.stakingEnabled);
      var strong = live.querySelector('strong');
      if (strong) strong.textContent = label;
    }

    animateValue('mainSol', data.totals.totalFundedSol, function (value) {
      setText('main-sol', fmtSol(value, 4));
    });
    animateValue('mainUsd', data.totals.totalFundedUsd || 0, function (value) {
      setText('main-usd', fmtUsd(value));
    });
    animateValue('claimedSol', data.totals.totalClaimedSol || 0, function (value) {
      setText('claimed-sol', fmtSol(value, 4) + ' SOL');
    });
    animateValue('claimedUsd', data.totals.totalClaimedUsd || 0, function (value) {
      setText('claimed-usd', fmtUsd(value));
    });
    animateValue('unclaimedSol', data.totals.allocatedUnclaimedSol || 0, function (value) {
      setText('unclaimed-sol', fmtSol(value, 4) + ' SOL');
    });
    animateValue('unclaimedUsd', data.totals.allocatedUnclaimedUsd || 0, function (value) {
      setText('unclaimed-usd', fmtUsd(value));
    });
    animateValue('vaultSol', data.totals.rewardVaultSol || 0, function (value) {
      setText('vault-sol', fmtSol(value, 4) + ' SOL');
    });

    setText('total-staked', data.totals.totalStaked || '0');
    setText('price-line', 'SOL/USD ' + fmtUsd(data.price.priceUsd || 0) + ' via ' + String(data.price.source || 'unknown').toUpperCase());
    setText('last-updated', 'Last update: ' + new Date().toLocaleTimeString());
    setText('mode-line', label);
    setText('narrative-copy', narrative(data));
    setText('program-id', short(data.programId));
    setText('reward-vault', data.pdas && data.pdas.rewardVault ? short(data.pdas.rewardVault) : 'not configured');
    setText('distributor', data.distributorPublicKey ? short(data.distributorPublicKey) : 'not configured');
    setText('price-source', String(data.price.source || 'pending').toUpperCase());
    setText('rpc-line', data.ok ? 'online' : 'waiting');
  }

  function renderError(error) {
    var live = el('live-state');
    if (live) {
      live.classList.remove('ready');
      var strong = live.querySelector('strong');
      if (strong) strong.textContent = 'OFFLINE';
    }
    setText('mode-line', 'Telemetry unavailable');
    setText('narrative-copy', error && error.message ? error.message : 'The public telemetry route did not answer. The page will keep retrying.');
    setText('last-updated', 'Last update failed: ' + new Date().toLocaleTimeString());
  }

  async function refresh() {
    try {
      var response = await fetch('/api/stats', { cache: 'no-store' });
      var data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'Stats unavailable');
      render(data);
    } catch (error) {
      renderError(error);
    }
  }

  refresh();
  setInterval(refresh, 5000);
})();
