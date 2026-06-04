const SOL_MINT = 'So11111111111111111111111111111111111111112';

async function fetchSolPriceUsd() {
  const birdeyeKey = process.env.BIRDEYE_API_KEY;

  if (birdeyeKey) {
    const response = await fetch(`https://public-api.birdeye.so/defi/price?address=${SOL_MINT}`, {
      headers: {
        'X-API-KEY': birdeyeKey,
        'x-chain': 'solana'
      }
    });

    if (response.ok) {
      const json = await response.json();
      const value = json && json.data && Number(json.data.value);
      if (Number.isFinite(value) && value > 0) {
        return {
          priceUsd: value,
          source: 'birdeye',
          fetchedAt: new Date().toISOString()
        };
      }
    }
  }

  const fallback = await fetch(`https://lite-api.jup.ag/price/v3?ids=${SOL_MINT}`);
  if (!fallback.ok) {
    throw new Error('Unable to fetch live SOL/USD price');
  }

  const json = await fallback.json();
  const value = Number(json && json[SOL_MINT] && json[SOL_MINT].usdPrice);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('SOL/USD price response was invalid');
  }

  return {
    priceUsd: value,
    source: 'jupiter',
    fetchedAt: new Date().toISOString()
  };
}

module.exports = {
  SOL_MINT,
  fetchSolPriceUsd
};
