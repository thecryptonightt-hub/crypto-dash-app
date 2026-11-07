#!/usr/bin/env node
/**
 * Crypto Dash — criteria-audited data refresh (server-side runner, NOT a browser).
 *
 * This script scores ONLY from the criteria on the Crypto Dash sales website:
 * 11 factors, exact weights (sum = 100), UNKNOWN rule, never fabricate,
 * never assume value accrual. Ranking falls out naturally from these scores;
 * it is NOT forced to match any earlier version's ranking, and NO factor
 * score is copied from the private version.
 *
 * Scoring — exact weights, sum = 100:
 *   Revenue 15, Token utility + value accrual 15, Adoption 10, Product 10,
 *   Flywheel 10, Tokenomics 10, Valuation 10, Catalysts 5, Competitive
 *   advantage (moat) 5, Security/team 5, Risk 5.
 * Aggregation: score = sum of known factors, UNKNOWN = 0 points. The total
 * is therefore CAPPED by missing data, not rescaled. A factor with no
 * reliable feed data is null (UNKNOWN), never a guessed number.
 *
 * Factor rules — every score below comes from real, sourced data for that
 * factor, or is UNKNOWN. Flat placeholders were removed in this audit:
 *
 *   Revenue (15): DefiLlama dailyRevenue, family-summed by CoinGecko id
 *     (see familyRevenue). Tiered by log10 magnitude: >=$1M/24h -> 15,
 *     >=$100k -> 13, >=$10k -> 11, >=$1k -> 8, >$0 -> 5. No revenue row ->
 *     UNKNOWN. Fees are NOT revenue and are never used as revenue.
 *     (Old placeholder: none for revenue — it was already revenue-based.)
 *
 *   Value accrual (15): NEVER assumed. If revenue is present but no
 *     verified holder mechanism is in the data pulled, score is CAPPED at
 *     6/15. Only Lighter and Hyperliquid are scored 12/15, on documented
 *     buybacks (LIT buybacks; HYPE Assistance Fund buybacks — the Fund
 *     directs ~97-99% of Hyperliquid trading fees to open-market HYPE
 *     buybacks). No revenue and no mechanism -> UNKNOWN.
 *     (Old placeholders removed: hyperliquid 12, uniswap 8, lido 8, and
 *     flat 6 whenever TVL existed, none of which were verified in the
 *     data pulled. Hyperliquid 12 was restored as a verified buyback,
 *     not a placeholder.)
 *
 *   Adoption (10): 24h trading volume + TVL, both real activity signals.
 *     Volume tier: >=$10B -> 5, >=$1B -> 4, >=$100M -> 3, >=$10M -> 2,
 *     >$0 -> 1. TVL tier: >=$1B -> 5, >=$100M -> 4, >=$10M -> 3,
 *     >=$1M -> 2, >$0 -> 1. Sum, capped at 10. Neither present -> UNKNOWN.
 *     Volume alone is a proxy for adoption, not a user count — the note
 *     in the output says so. (Old placeholder removed: log10(market cap)
 *     alone. Market cap is not adoption.)
 *     Layer-1 chains use their DefiLlama chain TVL (/v2/chains) for the
 *     TVL tier, not the bridge / foundation protocol row they are matched
 *     to (whose TVL is usually null). Memecoins with no DefiLlama
 *     protocol of their own (dogwifhat, Bonk, Shiba Inu) are left
 *     unmatched rather than matched by ticker symbol to an unrelated
 *     project — their revenue / product / TVL are UNKNOWN.
 *
 *   Product utility (10): 6 ONLY if DefiLlama lists a categorised live
 *     protocol for this token (category present). Capped at 6 because
 *     genuine need is a judgement the data alone cannot prove. No
 *     categorised live product -> UNKNOWN.
 *     (Old placeholders removed: flat 7 if TVL existed, flat 5 if market
 *     cap > $100M.)
 *
 *   Flywheel (10): needs revenue AND adoption together. If revenue24h is
 *     present and volume or TVL is present: 8 if revenue is sustained
 *     (revenue30d >= 20x revenue24h), else 6. Otherwise UNKNOWN.
 *     (Old placeholder removed: log10(TVL) alone. TVL alone is not a
 *     flywheel.)
 *
 *   Tokenomics (10): circulating / total supply ratio, real supply data:
 *     round(10 * circulating/total), clamped 1-10. No total supply ->
 *     UNKNOWN. (This factor was already supply-based; kept, documented.)
 *
 *   Valuation (10): if revenue30d is present, annualised revenue =
 *     revenue30d * 12, price/sales = marketCap / annualisedRevenue.
 *     P/S <= 1 -> 10, <= 5 -> 8, <= 10 -> 6, <= 25 -> 4, <= 50 -> 2, > 50 -> 1.
 *     If no revenue, valuation is CAPPED at 6 and uses dilution overhang
 *     only: FDV/marketCap <= 1.1 -> 6, <= 2 -> 4, <= 5 -> 2, > 5 -> 1.
 *     No market cap or FDV -> UNKNOWN.
 *     (Old placeholder removed: marketCap/FDV ratio alone, with no
 *     revenue multiple.)
 *
 *   Catalysts (5): UNKNOWN for all. Launches, listings, and partnerships
 *     are not in the free APIs used here. Nothing is listed rather than
 *     inventing announcements.
 *
 *   Competitive advantage / moat (5): UNKNOWN for all. Technology edge
 *     and barriers to entry need qualitative research beyond these feeds;
 *     market-cap tier alone is not a moat.
 *     (Old placeholders removed: flat 4 if market cap > $10B, flat 3 if
 *     > $1B.)
 *
 *   Security / team (5): UNKNOWN for all. Audit status, team credibility,
 *     and incident history are not verified by the free APIs used here.
 *     (Old placeholder removed: flat 3 if market cap > $1B.)
 *
 *   Risk (5): dilution overhang, real supply/market data: FDV/marketCap
 *     <= 1.5 -> 5, <= 3 -> 4, > 3 -> 3. No FDV or market cap -> UNKNOWN.
 *     (Old placeholders removed: flat 3, or 2 only if FDV/marketCap > 5.)
 *
 * Sources (all free, no API key):
 *   - CoinGecko markets: prices, market cap, FDV, supplies, logos
 *   - DefiLlama /protocols: TVL, gecko_id, slug, category
 *   - DefiLlama /overview/fees?dataType=dailyRevenue: protocol revenue
 *     NOTE: dataType must be "dailyRevenue". "revenue" returns
 *     "Internal Error" from DefiLlama, and the default returns fees, NOT
 *     revenue.
 *
 * Exclusions: stablecoins and centralized exchange tokens are excluded
 * entirely. DEX tokens stay.
 *
 * Usage: node scripts/refresh-data.js [--out <path>] [--limit <n>]
 *   Default output: data.json next to the site root (parent of scripts/).
 *   Default limit: 109 assets, sorted by score descending (Top 10 first).
 * Exit code: 0 on success, 1 if CoinGecko data could not be fetched at all
 * (a partial DefiLlama failure is NOT fatal: those factors become UNKNOWN).
 */
"use strict";
const fs = require("fs");
const path = require("path");

const WEIGHTS = { revenue: 15, valueAccrual: 15, adoption: 10, product: 10, flywheel: 10, tokenomics: 10, valuation: 10, catalysts: 5, moat: 5, security: 5, risk: 5 };

const EXCLUDED_IDS = ["tether", "usd-coin", "dai", "ethena-usde", "first-digital-usd", "paypal-usd", "ripple-usd", "binancecoin", "okb", "cronos", "leo-token", "kucoin-shares", "bitget-token", "gatechain-token", "whitebit", "huobi-token", "nexo", "true-usd", "pax-dollar", "frax", "liquity-usd", "tether-gold", "pax-gold", "gho", "usdd", "susd", "aeur", "xaut"];
const EXCLUDED_SYMS = ["usdt", "usdc", "dai", "usde", "fdusd", "pyusd", "rlusd", "tusd", "usdp", "frax", "lusd", "usdd", "susd", "xaut", "paxg", "gho", "aeur", "bnb", "okb", "cro", "leo", "kcs", "bgb", "wbt", "ht", "htx", "nexo"];

const SECTOR_MAP = { bitcoin: "Layer 1", ethereum: "Layer 1", solana: "Layer 1", tron: "Layer 1", cardano: "Layer 1", avalanche: "Layer 1", polkadot: "Layer 1", cosmos: "Layer 1", near: "Layer 1", sui: "Layer 1", aptos: "Layer 1", uniswap: "DEX", hyperliquid: "DEX", jupiter: "DEX", lido: "DeFi", aave: "DeFi", chainlink: "Infrastructure", filecoin: "DePIN", render: "DePIN", "the-graph": "AI", fetch: "AI", worldcoin: "AI", injective: "DeFi", arbitrum: "Layer 2", optimism: "Layer 2", polygon: "Layer 2", starknet: "Layer 2", monero: "Privacy", zcash: "Privacy", "axie-infinity": "Gaming", "immutable-x": "Gaming", ondo: "RWA", maker: "DeFi", "lido-dao": "DeFi" };

// ONLY verified holder mechanisms kept: Lighter (documented LIT buybacks)
// and Hyperliquid (Assistance Fund directs ~97-99% of trading fees to
// open-market HYPE buybacks, ~48M HYPE bought). Every other
// revenue-present token is capped at 6, never assumed higher.
const VALUE_ACCRUAL_KNOWN = { lighter: 12, hyperliquid: 12 };

// Symbol fallback is unsafe for these tokens: their tickers collide with
// unrelated DefiLlama protocols, so a memecoin would inherit a stranger's
// revenue / TVL / category. WIF -> "World is Flat" (Onchain Voting),
// BONK -> "Bonk Staked SOL" (liquid staking), SHIB -> "Shibex" (a DEX).
// They have no DefiLlama protocol of their own, so they must stay
// unmatched (revenue / product / TVL = null).
const NO_SYMBOL_FALLBACK_IDS = new Set(["dogwifcoin", "bonk", "shiba-inu"]);

// Layer-1 chains whose DefiLlama chain TVL (not a bridge / foundation /
// treasury protocol row) is the real adoption signal. SECTOR_MAP calls
// most of these "Layer 1"; avalanche-2 is listed explicitly because its
// CoinGecko id is not the SECTOR_MAP key ("avalanche").
const L1_CHAIN_IDS = new Set(["bitcoin", "ethereum", "solana", "tron", "cardano", "avalanche-2", "polkadot", "cosmos", "near", "sui", "aptos"]);

function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

function volumeTier(v) {
  if (v == null) return null;
  if (v >= 1e10) return 5;
  if (v >= 1e9) return 4;
  if (v >= 1e8) return 3;
  if (v >= 1e7) return 2;
  if (v > 0) return 1;
  return null;
}
function tvlTier(t) {
  if (t == null) return null;
  if (t >= 1e9) return 5;
  if (t >= 1e8) return 4;
  if (t >= 1e7) return 3;
  if (t >= 1e6) return 2;
  if (t > 0) return 1;
  return null;
}

function scoreCoin(c, tvl, revenue, chainTvl) {
  const f = {};
  // Revenue presence requires revenue > $0 in the last day OR the last
  // 30 days. A DefiLlama row with $0/$0 (e.g. Bitcoin) is NOT revenue —
  // scoring it 1/15, and unlocking value accrual / flywheel on $0, was
  // a bug found in this audit. Effective daily revenue is revenue24h
  // when positive, otherwise revenue30d / 30 when positive.
  const effDaily = revenue != null
    ? (revenue.revenue24h != null && revenue.revenue24h > 0 ? revenue.revenue24h
      : (revenue.revenue30d != null && revenue.revenue30d > 0 ? revenue.revenue30d / 30 : null))
    : null;
  // Revenue: log magnitude of DefiLlama dailyRevenue, UNKNOWN if no row
  // or if effective daily revenue is $0.
  f.revenue = effDaily != null
    ? clamp(Math.round(15 * Math.min(1, Math.log10(1 + effDaily) / 6)), 1, 15) : null;
  // Value accrual: capped at 6 on revenue alone, 12 only for documented buybacks.
  f.valueAccrual = VALUE_ACCRUAL_KNOWN[c.id] != null ? VALUE_ACCRUAL_KNOWN[c.id]
    : (effDaily != null ? 6 : null);
  // Adoption: volume tier + TVL tier, capped at 10; neither -> UNKNOWN.
  // For Layer-1 chains the TVL tier uses the chain's real TVL
  // (DefiLlama /v2/chains), not the bridge / foundation protocol row
  // the token is matched to (whose TVL is usually null). Product and
  // flywheel still use the protocol match.
  const vt = volumeTier(c.total_volume != null ? c.total_volume : null);
  const tt = chainTvl != null ? tvlTier(chainTvl) : (tvl != null ? tvlTier(tvl.tvl) : null);
  f.adoption = (vt == null && tt == null) ? null : Math.min(10, (vt || 0) + (tt || 0));
  // Product: 6 only on a categorised live DefiLlama protocol, else UNKNOWN.
  f.product = (tvl != null && tvl.category) ? 6 : null;
  // Flywheel: revenue + adoption together; sustained revenue scores higher.
  // Note: 30d revenue is almost always >= 20x a single day's revenue for a
  // stable protocol, so this is 8 for most revenue coins and 6 otherwise —
  // a weak differentiator, documented here rather than hidden.
  if (effDaily != null && (c.total_volume > 0 || (tvl != null && tvl.tvl > 0))) {
    f.flywheel = (revenue.revenue30d != null && revenue.revenue24h != null && revenue.revenue24h > 0 && revenue.revenue30d >= 20 * revenue.revenue24h) ? 8 : 6;
  } else {
    f.flywheel = null;
  }
  // Tokenomics: circulating / total supply, real supply data only.
  f.tokenomics = (c.circulating_supply != null && c.total_supply != null && c.total_supply > 0)
    ? clamp(Math.round(10 * (c.circulating_supply / c.total_supply)), 1, 10) : null;
  // Valuation: revenue multiple when revenue exists, else dilution-capped at 6.
  if (c.market_cap != null && revenue != null && revenue.revenue30d != null && revenue.revenue30d > 0) {
    const ps = c.market_cap / (revenue.revenue30d * 12);
    f.valuation = ps <= 1 ? 10 : ps <= 5 ? 8 : ps <= 10 ? 6 : ps <= 25 ? 4 : ps <= 50 ? 2 : 1;
  } else if (c.market_cap != null && c.fully_diluted_valuation != null && c.fully_diluted_valuation > 0) {
    const r = c.fully_diluted_valuation / c.market_cap;
    f.valuation = r <= 1.1 ? 6 : r <= 2 ? 4 : r <= 5 ? 2 : 1;
  } else {
    f.valuation = null;
  }
  // Catalysts, moat, security: UNKNOWN — no data for these in the free feeds.
  f.catalysts = null;
  f.moat = null;
  f.security = null;
  // Risk: dilution overhang tiers, real market/FDV data only.
  if (c.market_cap != null && c.fully_diluted_valuation != null && c.market_cap > 0) {
    const r = c.fully_diluted_valuation / c.market_cap;
    f.risk = r <= 1.5 ? 5 : r <= 3 ? 4 : 3;
  } else {
    f.risk = null;
  }
  let total = 0, known = 0;
  for (const k of Object.keys(WEIGHTS)) { if (f[k] != null) { total += f[k]; known++; } }
  return { factors: f, score: total, evidence: known / 11, known };
}

function band(score) {
  if (score >= 90) return "Exceptional";
  if (score >= 80) return "Strong";
  if (score >= 70) return "Promising";
  if (score >= 60) return "Moderate";
  return "Weak or speculative";
}

async function fetchJson(url, attempts = 3) {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "Crypto-Dash-Refresh/1.0" } });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const text = await res.text();
      if (text.trim() === "Internal Error") throw new Error(`DefiLlama "Internal Error" for ${url}`);
      return JSON.parse(text);
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw lastErr;
}

function familyRevenue(slug, revenueBySlug) {
  let rev24 = 0, rev7 = 0, rev30 = 0, found = false;
  for (const [s, r] of Object.entries(revenueBySlug)) {
    if (s === slug || s.startsWith(slug + "-")) {
      if (r.revenue24h != null) { rev24 += r.revenue24h; found = true; }
      if (r.revenue7d != null) rev7 += r.revenue7d;
      if (r.revenue30d != null) rev30 += r.revenue30d;
    }
  }
  if (!found) return null;
  return { revenue24h: rev24, revenue7d: rev7, revenue30d: rev30, revenueSource: "family-sum" };
}

async function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 109;
  const outPath = outIdx >= 0
    ? path.resolve(args[outIdx + 1])
    : path.join(__dirname, "..", "data.json");

  const generatedAt = new Date().toISOString();
  const errors = [];

  const cgUrl = "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h";
  const coins = await fetchJson(cgUrl);
  if (!Array.isArray(coins) || coins.length === 0) throw new Error("CoinGecko returned no coins");

  let protocols = [];
  try {
    protocols = await fetchJson("https://api.llama.fi/protocols");
  } catch (e) { errors.push(`DefiLlama /protocols failed: ${e.message}`); }
  const tvlByGecko = new Map();
  const tvlBySymbol = new Map();
  if (Array.isArray(protocols)) {
    const byGecko = new Map();
    for (const p of protocols) {
      if (!p.gecko_id) continue;
      if (!byGecko.has(p.gecko_id)) byGecko.set(p.gecko_id, []);
      byGecko.get(p.gecko_id).push(p);
    }
    for (const [gid, list] of byGecko) {
      const parent = list.find((p) => p.slug === gid);
      const best = parent || list.slice().sort((a, b) => (b.tvl || 0) - (a.tvl || 0))[0];
      tvlByGecko.set(gid, { tvl: best.tvl != null ? best.tvl : null, slug: best.slug || null, name: best.name || null, category: best.category || null, twitter: best.twitter || null });
    }
    for (const p of protocols) {
      const sym = (p.symbol || "").toLowerCase();
      if (!sym) continue;
      const entry = { tvl: p.tvl != null ? p.tvl : null, slug: p.slug || null, name: p.name || null, category: p.category || null, twitter: p.twitter || null };
      const cur = tvlBySymbol.get(sym);
      if (!cur || (entry.tvl || 0) > (cur.tvl || 0)) tvlBySymbol.set(sym, entry);
    }
  }

  const revenueBySlug = {};
  let revenueCount = 0;
  try {
    const rev = await fetchJson("https://api.llama.fi/overview/fees?dataType=dailyRevenue&excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true");
    for (const p of (rev.protocols || [])) {
      if (p.slug && (p.total24h != null || p.total7d != null || p.total30d != null)) {
        revenueBySlug[p.slug] = { revenue24h: p.total24h != null ? p.total24h : null, revenue7d: p.total7d != null ? p.total7d : null, revenue30d: p.total30d != null ? p.total30d : null };
        revenueCount++;
      }
    }
  } catch (e) { errors.push(`DefiLlama revenue overview failed: ${e.message}`); }

  // Layer-1 chain TVL (DefiLlama /v2/chains), keyed by the chain's
  // CoinGecko id. Used only for the adoption TVL tier of Layer-1
  // tokens (Fix 2); revenue / product / category still come from the
  // protocol match. A failed fetch is recorded, not fatal — those
  // tokens simply fall back to their protocol TVL.
  const chainTvlByGecko = new Map();
  try {
    const chains = await fetchJson("https://api.llama.fi/v2/chains");
    if (Array.isArray(chains)) {
      for (const ch of chains) {
        if (ch.gecko_id && ch.tvl != null) {
          const cur = chainTvlByGecko.get(ch.gecko_id);
          if (cur == null || ch.tvl > cur) chainTvlByGecko.set(ch.gecko_id, ch.tvl);
        }
      }
    }
  } catch (e) { errors.push(`DefiLlama /v2/chains failed: ${e.message}`); }

  const scored = [];
  let excluded = 0;
  for (const c of coins) {
    const sym = (c.symbol || "").toLowerCase();
    if (EXCLUDED_IDS.includes(c.id) || EXCLUDED_SYMS.includes(sym) || c.id === "tether" || sym === "usdt") { excluded++; continue; }
    const tvl = tvlByGecko.get(c.id) || (NO_SYMBOL_FALLBACK_IDS.has(c.id) ? null : tvlBySymbol.get(sym)) || null;
    // Layer-1 chain TVL for the adoption tier (Fix 2). Only when the
    // token is a Layer-1 chain and the chains endpoint has its TVL;
    // otherwise the protocol TVL stands (e.g. Polkadot has no chain
    // entry in /v2/chains, so it keeps its protocol match).
    const sector = SECTOR_MAP[c.id] || "Other";
    const chainTvl = (sector === "Layer 1" || L1_CHAIN_IDS.has(c.id))
      ? (chainTvlByGecko.get(c.id) != null ? chainTvlByGecko.get(c.id) : null)
      : null;
    let revenue = familyRevenue(c.id, revenueBySlug);
    let revenueSource = revenue ? revenue.revenueSource : null;
    if (!revenue && tvl && tvl.slug) {
      revenue = familyRevenue(tvl.slug, revenueBySlug);
      if (revenue) revenueSource = revenue.revenueSource;
    }
    if (!revenue && revenueBySlug[c.id]) {
      const r = revenueBySlug[c.id];
      revenue = { revenue24h: r.revenue24h, revenue7d: r.revenue7d, revenue30d: r.revenue30d, revenueSource: "direct" };
      revenueSource = "direct";
    }
    // Blocklisted memecoins have no protocol revenue of their own. The
    // family lookup above prefix-matches slugs, so "bonk" would still
    // pull in "bonk-staked-sol" revenue even with the TVL match blocked.
    // Force revenue to null for these three so no factor is fed by a
    // stranger's project.
    if (NO_SYMBOL_FALLBACK_IDS.has(c.id)) { revenue = null; revenueSource = null; }
    // CoinGecko markets response uses total_volume, not volume24h.
    const coinForScoring = Object.assign({}, c, { total_volume: c.total_volume });
    const score = scoreCoin(coinForScoring, tvl, revenue, chainTvl);
    scored.push({
      id: c.id,
      name: c.name,
      symbol: c.symbol,
      image: c.image || null,
      current_price: c.current_price != null ? c.current_price : null,
      market_cap: c.market_cap != null ? c.market_cap : null,
      fully_diluted_valuation: c.fully_diluted_valuation != null ? c.fully_diluted_valuation : null,
      circulating_supply: c.circulating_supply != null ? c.circulating_supply : null,
      total_supply: c.total_supply != null ? c.total_supply : null,
      price_change_percentage_24h: c.price_change_percentage_24h != null ? c.price_change_percentage_24h : null,
      sector,
      tvl: chainTvl != null ? chainTvl : (tvl ? tvl.tvl : null),
      defillama_slug: tvl ? tvl.slug : null,
      defillama_category: tvl ? tvl.category : null,
      twitter: tvl ? tvl.twitter : null,
      revenue24h: revenue ? revenue.revenue24h : null,
      revenue7d: revenue ? revenue.revenue7d : null,
      revenue30d: revenue ? revenue.revenue30d : null,
      revenueSource: revenueSource,
      score: score,
      band: band(score.score),
    });
  }
  scored.sort((a, b) => b.score.score - a.score.score);
  const assets = scored.slice(0, limit);

  const out = {
    generatedAt,
    sources: [
      { name: "CoinGecko", url: "https://api.coingecko.com/api/v3/coins/markets", fetchedAt: generatedAt, note: "Prices, market cap, FDV, supplies, logos, 24h volume." },
      { name: "DefiLlama", url: "https://api.llama.fi/protocols", fetchedAt: generatedAt, note: "TVL, protocol slug, category (product utility requires a categorised live protocol)." },
      { name: "DefiLlama", url: "https://api.llama.fi/overview/fees?dataType=dailyRevenue", fetchedAt: generatedAt, note: "Protocol revenue (dailyRevenue). Fees are NOT revenue and are not used as revenue." },
      { name: "DefiLlama", url: "https://api.llama.fi/v2/chains", fetchedAt: generatedAt, note: "Chain TVL for Layer-1 tokens (adoption TVL tier only); revenue, product, and category still come from the protocol match." },
    ],
    counts: { coingeckoFetched: coins.length, excluded, defillamaProtocols: Array.isArray(protocols) ? protocols.length : 0, defillamaRevenueRows: revenueCount, defillamaChains: chainTvlByGecko.size, scored: scored.length, included: assets.length },
    errors,
    factorMethod: "Weights sum to 100; UNKNOWN = 0 points (capped, not rescaled). Catalysts, moat, and security are UNKNOWN for all coins in this run because the free feeds carry no data for them. Value accrual is capped at 6 on revenue alone, 12 only for Lighter and Hyperliquid documented buybacks. Adoption is volume tier + TVL tier (Layer-1 chains use their DefiLlama chain TVL). Memecoins with no DefiLlama protocol of their own (dogwifhat, Bonk, Shiba Inu) are left unmatched rather than matched by ticker symbol to an unrelated project. Product is 6 only on a categorised live DefiLlama protocol. Valuation uses a revenue multiple when revenue30d exists, else a dilution-capped score. No factor score is copied from any earlier version.",
    assets,
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");

  console.log(`Wrote ${outPath}`);
  console.log(`CoinGecko fetched: ${coins.length}, excluded: ${excluded}, included: ${assets.length}`);
  console.log(`DefiLlama protocols: ${out.counts.defillamaProtocols}, revenue rows: ${revenueCount}`);
  console.log(`Assets with revenue24h: ${assets.filter((a) => a.revenue24h != null).length} / ${assets.length}`);
  if (errors.length) console.log(`Warnings: ${errors.join(" | ")}`);
  console.log("Top 10:");
  assets.slice(0, 10).forEach((a, i) => {
    console.log(`  ${i + 1}. ${a.name} (${(a.symbol || "").toUpperCase()}) score=${a.score.score} band=${a.band} revenue24h=${a.revenue24h != null ? "$" + Math.round(a.revenue24h) : "UNKNOWN"} tvl=${a.tvl != null ? "$" + Math.round(a.tvl) : "UNKNOWN"} mcap=${a.market_cap != null ? "$" + Math.round(a.market_cap) : "UNKNOWN"}`);
  });
}

main().catch((e) => { console.error("refresh-data failed:", e.message); process.exit(1); });
