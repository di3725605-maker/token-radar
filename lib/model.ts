// Token Radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds
// pre-token protocols below the watchlist floor: the early rows the radar exists to find. A
// protocol is pre-token when its index entry records no token (no market cap, no CoinGecko id,
// no symbol); the snapshot's live-token protocols are kept apart and shown as the market's own
// values, never mixed into the ranked board.
//
// Implied value follows only from the snapshot's own figures, through three factors:
//
//   multiple   = the category's calibrated multiple: the median mcap/TVL of the snapshot's own
//                tokenized protocols in that category, shrunk toward the snapshot-wide median
//                (pseudo-count k = 6), clamped to [0.05, 0.60]. A category's own median is used
//                only when at least 3 tokenized comparators back it; a thinner category uses the
//                snapshot-wide median and says so. A category with no tokenized comparator at all
//                uses the snapshot-wide median too. No protocol name is ever special-cased: the
//                same function scores every row, and the multiples are recomputed from the
//                snapshot on every run. The minimum-comparator rule matters because mcap/TVL is
//                meaningless at tiny TVL: one $12M protocol with a 2.97 ratio must never set the
//                multiple for a $2.75B category.
//   growth     = 1 + 0.30 * clamp(change_7d, -60, 120) / 100, clamped to [0.70, 1.30]
//                (a 7-day spike is the noisiest signal in the snapshot, so its weight is 0.30
//                and its total effect is capped at about +/-30%).
//   maturity   = 0.60 + 0.40 * min(age_days, 1095) / 1095   (age_days unknown: 0.60)
//   implied    = max(1, round(tvl_usd * multiple * growth * maturity))
//
// The early set applies the watchlist's full exclusion rule, not just the starter's: no CEX,
// Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking or Restaked BTC category, no
// versioned name, no whole word wrapped/staked/staking, no exchange-name prefix. A liquid
// staking derivative or a CEX is not a launch candidate, however large its TVL.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** One calibrated category multiple, as the dashboard states it. */
export interface CategoryMultiple {
  category: string;
  n: number;
  raw_median: number | null;
  multiple: number;
  source: 'comparators' | 'global-fallback';
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  shrinkage_k: number;
  min_comparators: number;
  multiple_floor: number;
  multiple_cap: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  growth_min: number;
  growth_max: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  shrinkage_k: 6,
  min_comparators: 3,
  multiple_floor: 0.05,
  multiple_cap: 0.6,
  growth_weight: 0.3,
  growth_floor: -60,
  growth_cap: 120,
  growth_min: 0.7,
  growth_max: 1.3,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    multiple: number;
    multiple_source: 'comparators' | 'global-fallback';
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  multiple: number;
  multiple_source: 'comparators' | 'global-fallback';
  growth_multiplier: number;
  maturity_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  global_median: number;
  multiples: CategoryMultiple[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/**
 * The category multiples, calibrated from the snapshot's own tokenized protocols and recomputed
 * on every run. For each category, the median mcap/TVL of its tokenized protocols (mcap present,
 * TVL above zero) is shrunk toward the snapshot-wide median with pseudo-count k, then clamped.
 * A category's own median is trusted only when at least min_comparators tokenized protocols back
 * it; a thinner category uses the snapshot-wide median and says so, because a single small-TVL
 * comparator (a $12M protocol at 2.97x) must never set the multiple for a billion-dollar category.
 */
export function categoryMultiples(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): { multiples: CategoryMultiple[]; global_median: number } {
  const ratiosByCategory = new Map<string, number[]>();
  const allRatios: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    allRatios.push(ratio);
    const key = p.category ?? '(uncategorised)';
    const list = ratiosByCategory.get(key) ?? [];
    list.push(ratio);
    ratiosByCategory.set(key, list);
  }
  const globalMedian = allRatios.length > 0 ? median(allRatios) : 0.169;
  const globalMultiple = Math.min(model.multiple_cap, Math.max(model.multiple_floor, globalMedian));
  const categories = new Set<string>();
  for (const p of snapshot.protocols) {
    if (isPreToken(p)) categories.add(p.category ?? '(uncategorised)');
  }
  const multiples: CategoryMultiple[] = [];
  for (const category of [...categories].sort()) {
    const ratios = ratiosByCategory.get(category) ?? [];
    if (ratios.length < model.min_comparators) {
      multiples.push({
        category,
        n: ratios.length,
        raw_median: ratios.length > 0 ? Math.round(median(ratios) * 1e4) / 1e4 : null,
        multiple: globalMultiple,
        source: 'global-fallback',
      });
      continue;
    }
    const raw = median(ratios);
    const shrunk = (ratios.length * raw + model.shrinkage_k * globalMedian) / (ratios.length + model.shrinkage_k);
    multiples.push({
      category,
      n: ratios.length,
      raw_median: Math.round(raw * 1e4) / 1e4,
      multiple: Math.min(model.multiple_cap, Math.max(model.multiple_floor, shrunk)),
      source: 'comparators',
    });
  }
  return { multiples, global_median: Math.round(globalMedian * 1e4) / 1e4 };
}

/** The three multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  multiples: Map<string, CategoryMultiple>,
  globalMedian: number,
  model: ModelConstants = MODEL,
): { implied: number; multiple: number; multipleSource: 'comparators' | 'global-fallback'; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const key = protocol.category ?? '(uncategorised)';
  const record = multiples.get(key);
  const multiple = record !== undefined
    ? record.multiple
    : Math.min(model.multiple_cap, Math.max(model.multiple_floor, globalMedian));
  const multipleSource: 'comparators' | 'global-fallback' = record !== undefined ? record.source : 'global-fallback';
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = Math.min(
    model.growth_max,
    Math.max(model.growth_min, 1 + (growthPct / 100) * model.growth_weight),
  );
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor +
    (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult));
  return {
    implied,
    multiple,
    multipleSource,
    growthPct,
    growthMult,
    maturityMult,
    age,
  };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word wrapped, staked or staking anywhere in the name: a derivative of a token that trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** A name beginning with an exchange's name: a CEX product, not a launch candidate. */
const EXCHANGE_PREFIX = /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)\b/i;

/** Categories the watchlist rule keeps off the board: exchanges, bridges and staking derivatives. */
const EXCLUDED_CATEGORIES = new Set([
  'CEX',
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
]);

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token and passing the watchlist's full exclusion rule. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const { multiples, global_median } = categoryMultiples(snapshot, model);
  const multipleByCategory = new Map(multiples.map((m) => [m.category, m]));
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped, passing the
  // watchlist's full exclusion rule. Never a replacement for a watchlist row: a chosen protocol
  // stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, multipleByCategory, global_median, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      multiple: round4(s.multiple),
      multiple_source: s.multipleSource,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** Gas for one transaction on a chain: Ethereum mainnet costs more than any other chain. */
function gasFor(chain: string): string {
  return chain.toLowerCase() === 'ethereum' ? 'about $8 of gas' : `about $2 to $4 of gas on ${chain}`;
}

/**
 * One category's farm triple: the main qualifying action, the weekly action that keeps the
 * position active, and the exit. Each is written for any protocol in the category, from the
 * protocol's own record only (name, chain, capital, hold); no vault, pool or points program is
 * ever named, because the snapshot names none.
 */
function planFor(
  p: SnapshotProtocol,
  capital: number,
  chain: string,
): { action: string; weekly: string; exit: string } {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const cap = `$${capital}`;
  if (c.includes('cdp')) {
    return {
      action: `Deposit ${cap} of collateral on ${name} (${chain}) and mint the protocol stablecoin against it at a safe ratio, well above the minimum.`,
      weekly: `Check the ${name} collateral ratio on ${chain}, top up collateral if the price moved, and confirm no stability fee accrued unpaid.`,
      exit: `Repay the stablecoin debt, withdraw the collateral and move the funds out.`,
    };
  }
  if (c.includes('lend')) {
    return {
      action: `Supply ${cap} of a major stablecoin into the base lending market on ${name} (${chain}), then borrow a small amount against it to establish a real position.`,
      weekly: `Claim any accrued supply interest on ${name} (${chain}) and re-supply it, or top up the position by a small amount to keep it active.`,
      exit: `Repay the borrow, withdraw the supply and move the funds out.`,
    };
  }
  if (c.includes('dex')) {
    return {
      action: `Provide ${cap} of liquidity to a major pair on ${name} (${chain}) within a sensible range, and keep the position narrow to limit impermanent loss.`,
      weekly: `Check the ${name} liquidity position on ${chain}, rebalance the range if it drifted out, and collect any fees.`,
      exit: `Remove the liquidity, swap back to the starting asset and move the funds out.`,
    };
  }
  if (c.includes('yield aggregator')) {
    return {
      action: `Deposit ${cap} into a single vault on ${name} (${chain}) that the aggregator routes to, and note the underlying strategy and any deposit fee before depositing.`,
      weekly: `Check the ${name} vault on ${chain} for strategy changes, share price, and whether the yield rate still justifies the fee.`,
      exit: `Withdraw the shares, unwrap if needed and move the funds out.`,
    };
  }
  if (c.includes('yield')) {
    return {
      action: `Deposit ${cap} into the base yield strategy on ${name} (${chain}) for a major asset, and note the current yield source before depositing.`,
      weekly: `Check the ${name} position on ${chain}, claim any yield, and re-deposit it or move it to a safer strategy if the rate dropped.`,
      exit: `Withdraw the position, unwrap if needed and move the funds out.`,
    };
  }
  if (c.includes('rwa')) {
    return {
      action: `Deposit ${cap} into the base real-world-asset product on ${name} (${chain}), such as a tokenized treasury or credit pool, and confirm any whitelist or lockup terms before depositing.`,
      weekly: `Check the ${name} position on ${chain} for accrued yield, redemption windows, and any lockup status.`,
      exit: `Redeem the position at the next window, unwrap if needed and move the funds out.`,
    };
  }
  if (c.includes('curator')) {
    return {
      action: `Deposit ${cap} into a curated vault on ${name} (${chain}) only after reading its curator terms and lockup note.`,
      weekly: `Check the ${name} vault on ${chain} for allocation changes, curator updates, and any withdrawal queue; withdraw if the risk note changes.`,
      exit: `Withdraw from the queue at the end of the hold and move the funds out.`,
    };
  }
  if (c.includes('allocator')) {
    return {
      action: `Deposit ${cap} into a diversified allocation on ${name} (${chain}), and note the share price and fees before depositing.`,
      weekly: `Check the ${name} vault on ${chain} for strategy rebalances, share price, and fee changes.`,
      exit: `Redeem the shares and move the funds out.`,
    };
  }
  if (c.includes('derivative')) {
    return {
      action: `Open a small hedged margin position of ${cap} on ${name} (${chain}), a perpetual with an offset spot leg, and set a stop so the loss is capped.`,
      weekly: `Check the ${name} margin position on ${chain} for funding costs and liquidation distance, and top up margin if it is close.`,
      exit: `Close the perpetual, close the spot leg and move the funds out.`,
    };
  }
  if (c.includes('liquidity manager')) {
    return {
      action: `Deposit ${cap} into a managed liquidity position on ${name} (${chain}), where the manager sets the range, and note the fee split and withdrawal rules.`,
      weekly: `Check the ${name} managed position on ${chain} for range drift, fees collected, and any manager rebalance.`,
      exit: `Withdraw the managed position and move the funds out.`,
    };
  }
  if (c.includes('basis')) {
    return {
      action: `Deposit ${cap} into a delta-neutral basis position on ${name} (${chain}), long spot and short perpetual, and confirm the funding rate and collateral rules before depositing.`,
      weekly: `Check the ${name} basis position on ${chain} for funding rate, collateral ratio, and any leg drift, and rebalance if needed.`,
      exit: `Close both legs of the basis position and move the funds out.`,
    };
  }
  if (c.includes('leveraged farm')) {
    return {
      action: `Open a leveraged farm position on ${name} (${chain}) with ${cap} of equity at a low leverage of 2x or less, and check the liquidation price before borrowing.`,
      weekly: `Check the ${name} leveraged position on ${chain} for health factor and liquidation distance, and repay or add collateral if it is close.`,
      exit: `Close the leveraged position, repay the borrow and move the funds out.`,
    };
  }
  if (c.includes('prediction')) {
    return {
      action: `Fund ${cap} on ${name} (${chain}) and place one market position on an outcome you can follow.`,
      weekly: `Check the ${name} market position on ${chain}, close it if it resolved, and place one new position.`,
      exit: `Close or resolve the open positions and withdraw the balance.`,
    };
  }
  if (c.includes('insurance')) {
    return {
      action: `Buy ${cap} of cover from ${name} (${chain}) and keep the policy active.`,
      weekly: `Check the ${name} policy on ${chain} for coverage status and any claim window.`,
      exit: `Let the policy lapse at the end of the hold, or claim if the covered event happened.`,
    };
  }
  if (c.includes('payment')) {
    return {
      action: `Route ${cap} of payments through ${name} (${chain}) and keep the receipts.`,
      weekly: `Make one payment through ${name} (${chain}) and check the limits and fees.`,
      exit: `Stop routing new payments and withdraw any remaining balance.`,
    };
  }
  if (c.includes('staking pool')) {
    return {
      action: `Stake ${cap} of the chain's staking asset through ${name} (${chain}) and keep the receipt.`,
      weekly: `Check the ${name} stake on ${chain} for rewards, and claim or restake them.`,
      exit: `Unstake the position and withdraw the asset.`,
    };
  }
  if (c.includes('anchor btc')) {
    return {
      action: `Mint ${cap} of the wrapped bitcoin asset on ${name} (${chain}) and hold it.`,
      weekly: `Check the ${name} position on ${chain} for the peg and the redemption window.`,
      exit: `Redeem the wrapped asset for bitcoin and move the funds out.`,
    };
  }
  return {
    action: `Deposit ${cap} of USDC into ${name} on ${chain} and keep the position open.`,
    weekly: `Make one qualifying action each week on ${name} (${chain}), such as a deposit, a borrow, a swap or a vote.`,
    exit: `Withdraw the position and move the funds out.`,
  };
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const plan = planFor(p, capital, chain);
  const gas = gasFor(chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: '$0 to set up',
      time: '15 minutes',
    },
    {
      text: plan.action,
      cost: `${gas} and $${capital} of capital`,
      time: '20 minutes to set up',
    },
    {
      text: plan.weekly,
      cost: `${gas} a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '5 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it. ${plan.exit}`,
      cost: 'nothing but the log',
      time: '10 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    multiple: row.model.multiple,
    multiple_source: row.model.multiple_source,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const { multiples, global_median } = categoryMultiples(snapshot, model);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    global_median,
    multiples,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
