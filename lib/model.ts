// Token Radar's model, radar-5: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling), adds the
// pre-token protocols above the floor the watchlist misses (the found set, by TVL), and adds
// pre-token protocols below the watchlist floor (the early rows the radar exists to find). A
// protocol is pre-token when its index entry records no token (no market cap, no CoinGecko id,
// no symbol); the snapshot's live-token protocols are kept apart and shown as the market's own
// values, never mixed into the ranked board.
//
// Implied value follows only from the snapshot's own figures, through a curve fitted on the
// snapshot's own traded tokens — never from a hand-set multiple:
//
//   comps        = the traded tokens the curve is fit on: market cap at least $1M, TVL above
//                  zero, and a standalone token (no other protocol in the snapshot shares its
//                  symbol or CoinGecko id). Sentinels (market cap zero or negative) and micro-caps
//                  are excluded. 101 comps on the sealed snapshot.
//   curve        = a Huber log-log fit of log(market cap) on log(TVL) over the comps
//                  (IRLS, k = 1.345, robust to the ratio outliers): value_if_launches =
//                  A * TVL^b with A = 6220.36 and b = 0.4453 on the sealed snapshot. Ten times
//                  the TVL buys about 2.8 times the value, not ten. The fit is recomputed from
//                  the snapshot on every run; the constants are stamped into the output so the
//                  dashboard recomputes the same numbers.
//   odds         = the SURVIVOR launch odds (radar-5 change): the share of protocols that
//                  will ever launch given they are pre-token now, at the row's age —
//                  (L - F(t)) / (1 - F(t)), where F is a Weibull CDF fitted to the five
//                  age-bucket rates at the fixed asymptote L = 0.85 (tau = 693, k = 0.678 on
//                  the sealed snapshot), times the row's category ever-rate relative to the
//                  snapshot-wide rate, raised to 0.25, clamped to [0.05, 0.95]. The bucket
//                  rates stay visible beside every row as the comparison: they measure
//                  P(records a token | age t) in a cross-section, which is the WRONG estimand
//                  for a pre-token protocol — young pre-token protocols have the most launch
//                  runway left, old ones have had their chances. L cannot be identified from
//                  one snapshot (the fit improves monotonically as L rises); 0.85 is the
//                  central judgment case, and the Method tab shows the L = 0.80 / 0.85 / 0.90
//                  sensitivity (board totals $1.91B / $2.17B / $2.44B, FARM 41 / 47 / 51).
//                  A protocol with no listing date keeps the bucket-form fallback (the
//                  snapshot-wide rate as its bucket rate): the survivor form needs an age.
//   implied      = value_if_launches * odds, rounded, at least $1.
//   bands        = the held-out bands from the leave-one-out validation (lib/validate.ts):
//                  P25-P75 is implied / 2.71 ... implied * 2.71 and P10-P90 is implied / 6.40
//                  ... implied * 6.40 on the sealed snapshot. The band factors are stamped
//                  into the output with the hold rates they earned.
//
// A row's farm plan is costed to the dollar: slice, fees, forgone yield, net, net per hour,
// the ticket it pays from, break-even odds and a FARM / THIN / SKIP verdict (see farmEconomics).
// The verdict rule is radar-5's second change: FARM iff the expected net is positive at the
// row's own odds (equivalently odds > break-even odds). The old rule (FARM iff break-even
// odds <= 0.10) was a stress test, not the expected-value decision — it labelled a row SKIP
// even when the numbers said farming it pays. Break-even odds stay displayed on every row as
// the risk gauge, and the Method tab keeps the old rule's counts for comparison.
//
// What the model does NOT use, and why (the evidence is in lib/validate.ts and the fit report
// at ~/workspace/makefun/fit/radar4-fit-report.md, extended by the radar-5 fit at
// ~/workspace/makefun/round5/fit5.py): no category premium (it fails leave-one-out under
// every tested formulation), no 7-day growth term (its fitted sign is negative and it hurts
// out-of-sample — a crash-week artifact), and no age term in the value curve (age belongs in
// the odds, not in the value). The dashboard's Method tab shows the ablation table with the
// numbers, so the omissions are argued, not hidden.

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

/** One fitted size curve: value = A * TVL^b, fit on the comps. */
export interface SizeCurve {
  /** The multiplicative constant A. */
  a: number;
  /** The TVL exponent b. */
  b: number;
  /** How many comps the fit used. */
  comps: number;
  /** The log-scale R-squared of the OLS fit, for the Method tab (the fit report quotes it). */
  rSquaredOls: number;
  /** The log-scale R-squared of the final Huber fit. */
  rSquared: number;
}

/** One age-bucket point for the Weibull fit: median age, token rate, member count. */
export interface BucketPoint {
  medianAge: number;
  rate: number;
  n: number;
}

/** The launch-odds parameters, computed from the snapshot. */
export interface OddsParams {
  /** The snapshot-wide share of protocols recording a token. */
  overall: number;
  /** The age-bucket rates, in bucket order: <6mo, 6-12mo, 1-2y, 2-4y, >4y. */
  bucketRates: number[];
  /** The five bucket points (median age, rate, n) the Weibull CDF is fitted to. */
  bucketPoints: BucketPoint[];
  /** The per-category ever-rates, SHRUNK toward `overall` with pseudo-count K = 5. */
  categoryRates: Map<string, number>;
  /** The per-category ever-rates before shrinkage, for the Method tab. */
  categoryRawRates: Map<string, number>;
  /** The per-category member counts, for the Method tab. */
  categoryCounts: Map<string, number>;
  /** The shrinkage pseudo-count. */
  shrinkK: number;
  /** The exponent on the relative category rate. */
  exponent: number;
  /** The odds clamp. */
  min: number;
  max: number;
  /** The survivor form's asymptote L (the central judgment case). */
  survivorL: number;
  /** The Weibull scale fitted at L (days). */
  survivorTau: number;
  /** The Weibull shape fitted at L. */
  survivorK: number;
  /** The weighted squared error of the Weibull fit at L. */
  survivorSse: number;
}

/** The fitted model: the curve, the odds parameters, and the band factors. */
export interface FittedModel {
  curve: SizeCurve;
  odds: OddsParams;
  /** The P25-P75 band factor (the leave-one-out median miss). */
  band25: number;
  /** The P10-P90 band factor (the 80th percentile leave-one-out miss). */
  band90: number;
}

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-5';

/** The survivor form's central asymptote: L cannot be identified from one snapshot, so the
 *  central judgment case is stated with its sensitivity (L = 0.80 / 0.90) in the Method tab. */
export const SURVIVOR_L = 0.85;

/** How many pre-token protocols above the watchlist floor the found set carries, by TVL. */
export const FOUND_ROWS = 20;

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** The airdrop share of implied value a farm plan assumes. */
export const AIRDROP_SHARE = 0.1;

/** The ticket sizes the dashboard offers, in dollars. */
export const TICKETS = [500, 1_000, 5_000, 10_000];

/** The default ticket: the board's verdicts are struck at this size. */
export const DEFAULT_TICKET = 1_000;

/** The verdict thresholds on break-even launch odds (THIN/SKIP split; FARM is by net now). */
export const THIN_BE_MAX = 0.33;

/** The forgone yield rate (a 4% T-bill) the farm netting charges. */
export const FORGONE_RATE = 0.04;

/** The flat bridge/withdraw allowance inside the farm fees. */
export const FEE_ALLOWANCE_USD = 1.5;

/** Gas per transaction by first chain, in dollars (stated estimates, not measured). */
export const GAS_BY_CHAIN: Record<string, number> = {
  ethereum: 8.0,
  bittensor: 0.35,
  solana: 0.05,
  base: 0.05,
  arbitrum: 0.1,
  optimism: 0.05,
  avalanche: 0.1,
  'bnb chain': 0.1,
  bsc: 0.1,
  polygon: 0.05,
  sui: 0.05,
  'hyperliquid l1': 0.05,
  gnosis: 0.05,
  fantom: 0.05,
};
export const GAS_DEFAULT_USD = 0.5;

/** One row's costed farm economics at a ticket size. */
export interface FarmEconomics {
  ticket: number;
  share: number;
  holdDays: number;
  weeks: number;
  hours: number;
  nTx: number;
  feesUsd: number;
  forgoneUsd: number;
  sliceIfLaunchesUsd: number;
  sliceExpectedUsd: number;
  netUsd: number;
  netPerHourUsd: number;
  /** The smallest ticket at which the plan nets positive, or null when no ticket pays. */
  paysFromUsd: number | null;
  /** The launch odds at which the plan breaks even. */
  breakEvenOdds: number;
  /** The row's launch odds, for the netting line. */
  odds: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
}

/** One traded comp nearest a board row, for the detail view. */
export interface NearestComp {
  slug: string;
  name: string;
  tvl_usd: number;
  mcap_usd: number;
  model_usd: number;
  /** max(model/cap, cap/model): how far the curve misses this comp. */
  miss: number;
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
  /** Where the row came from: the watchlist, the found set, or the early set. */
  list: 'watchlist' | 'found' | 'early';
  age_days: number | null;
  /** The value if a token launches, before the odds. */
  value_if_launches_usd: number;
  /** The launch odds. */
  odds: number;
  implied_value_usd: number;
  band_p25_usd: number;
  band_p75_usd: number;
  band_p10_usd: number;
  band_p90_usd: number;
  /** The rank range over bootstrap refits (p10-p90). */
  rank_range_lo: number;
  rank_range_hi: number;
  model: {
    curve_a: number;
    curve_b: number;
    bucket_rate: number;
    category_rate: number;
    odds: number;
    age_days: number | null;
    /** The survivor odds before the category adjustment, or null when the row has no age. */
    survivor_rate: number | null;
    /** The bucket-form odds for the same row, for comparison in the detail view. */
    bucket_odds: number;
  };
  nearest_comps: NearestComp[];
  /** The farm economics at the default ticket and share. */
  farm: FarmEconomics;
  farm_steps: string[];
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

/** One group of the 758-protocol ledger. */
export interface LedgerGroup {
  label: string;
  count: number;
  reason: string;
}

/** One rung of the ablation ladder, for the Method tab. */
export interface AblationRow {
  rung: string;
  looMedianMiss: number;
  looWithin3x: number;
  walkForward50: number;
  walkForward60: number;
  walkForward70: number;
  walkForward80: number;
  walkForwardCutoff: number;
  walkForwardCutoff25: number;
  verdict: string;
}

/** One row of the launch-odds exponent bake-off, for the Method tab. */
export interface OddsBakeoffRow {
  exponent: number;
  looAccuracy: number;
  looBrier: number;
  sentoraRank: number;
  sentoraOdds: number;
  sentoraImplied: number;
  boardTotal: number;
}

/** The validation summary stamped into the output. */
export interface ValidationSummary {
  looMedianMiss: number;
  looWithin3x: number;
  walkForward50: number;
  walkForward60: number;
  walkForward70: number;
  walkForward80: number;
  walkForwardCutoff: number;
  walkForwardCutoff25: number;
  flatLooMedianMiss: number;
  flatWalkForward50: number;
  band25Hold: number;
  band90Hold: number;
  rankStabilityTop20: number;
  rankStabilityMedianWidth: number;
  rank1Polymarket: number;
  rank1Sentora: number;
  /** The survivor odds' proper-LOO accuracy/Brier (the cross-sectional test — see the
   *  Method tab for why this test measures the wrong estimand for survivor odds). */
  oddsLooAccuracy: number;
  oddsLooBrier: number;
  comps: number;
  rSquared: number;
  rSquaredOls: number;
}

/** One row of the fair comp-set comparison (fit report §2.2, fit4c): every candidate
 *  scored on the SAME sets, so a smaller set cannot win by dropping its hardest comps. */
export interface CompSetProbeRow {
  label: string;
  trainN: number;
  looAll101: number;
  wf50: number;
  wf70: number;
  wfCut: number;
  z: number;
}

/** One row of the survivor-form sensitivity (computed at build time): the Weibull CDF fit
 *  at a fixed asymptote L, the survivor odds it implies at three ages, and the board it
 *  produces. L = 0.85 is the shipped central case; the other two show what rides on it. */
export interface SurvivorProbeRow {
  asymptoteL: number;
  tau: number;
  k: number;
  weightedSse: number;
  odds56d: number;
  odds407d: number;
  odds1845d: number;
  boardTotal: number;
  farm1000: number;
  shipped: boolean;
}

/** One row of the small-n category-rule test (fit report §4.4, odds4b): proper-LOO
 *  accuracy/Brier per rule, and the board the rule produces. */
export interface SmallNRuleRow {
  rule: string;
  looAccuracy: number;
  looBrier: number;
  polymarketOdds: number;
  polymarketImplied: number;
  boardTotal: number;
}

/** One row of the farm-math sensitivity grid (computed at build time): one assumption
 *  changed at a time from the baseline; FARM counts at the $1,000 and $10,000 tickets. */
export interface FarmSensitivityRow {
  change: string;
  farm1000: number;
  farm10000: number;
  defensible: string;
}

/** One split-half validation of the Weibull launch-time CDF: fit F on half the dated
 *  protocols, score P(token) = F(age) on the other half (and vice versa), against the
 *  bucket rates on the same halves. */
export interface SplitHalfBrier {
  weibullF: number;
  bucket: number;
  nTest: number;
}

/** Everything the dashboard needs: the board, the live set, the model and its validation. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  found_size: number;
  early_size: number;
  live_size: number;
  total_implied_usd: number;
  curve_a: number;
  curve_b: number;
  odds_overall: number;
  odds_bucket_rates: number[];
  odds_exponent: number;
  /** The survivor form's fitted parameters (L = 0.85 central case). */
  survivor_l: number;
  survivor_tau: number;
  survivor_k: number;
  survivor_sse: number;
  band25: number;
  band90: number;
  validation: ValidationSummary;
  ablation: AblationRow[];
  odds_bakeoff: OddsBakeoffRow[];
  /** The fair comp-set probes, the survivor-form sensitivity and the small-n rule test. */
  comp_probes: CompSetProbeRow[];
  survivor_probes: SurvivorProbeRow[];
  small_n_rules: SmallNRuleRow[];
  /** The farm-math sensitivity grid, one assumption at a time. */
  farm_sensitivity: FarmSensitivityRow[];
  /** The split-half Brier of the Weibull F fit vs the bucket rates. */
  split_half_brier: SplitHalfBrier;
  /** How many of the top 20 stay top 20, and who takes rank 1 across refits. */
  rank1_counts: { slug: string; name: string; count: number }[];
  ledger: LedgerGroup[];
  /** The traded comps the curve is fit on, for the scatter. */
  comps: { slug: string; name: string; tvl_usd: number; mcap_usd: number }[];
  /** The per-category ever-rates, raw and shrunk (K = 5), for the Method tab. */
  odds_categories: { category: string; n: number; rate: number; shrunkRate: number }[];
  rows: BoardRow[];
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
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The p-th percentile (0-100) of a list, linear interpolation. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (rank - lo);
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records a token at all (market cap, CoinGecko id, or symbol). */
export function recordsToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null || p.gecko_id !== null || p.symbol !== null;
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return !recordsToken(p);
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

/** Whether a protocol is one the board may rank: pre-token and passing the watchlist's full exclusion rule. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** The first exclusion reason a set-aside protocol falls under, in ledger order. */
export function setAsideReason(p: SnapshotProtocol): string {
  if (p.category === 'CEX') return 'CEX';
  if (p.category === 'Liquid Staking') return 'Liquid Staking';
  if (p.category === 'Bridge') return 'Bridge';
  if (p.category === 'Canonical Bridge') return 'Canonical Bridge';
  if (VERSIONED.test(p.name)) return 'versioned name';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped/staked word';
  if (p.category === 'Liquid Restaking') return 'Liquid Restaking';
  if (p.category === 'Restaked BTC') return 'Restaked BTC';
  return 'other';
}

/**
 * The traded comps the curve is fit on: market cap at least $1M, TVL above zero, and a
 * standalone token — no other protocol in the snapshot shares its symbol or CoinGecko id.
 * Sentinels (market cap zero or negative) and micro-caps are excluded by the $1M floor.
 */
export function compSet(snapshot: Snapshot): SnapshotProtocol[] {
  const symbolCount = new Map<string, number>();
  const geckoCount = new Map<string, number>();
  for (const p of snapshot.protocols) {
    if (p.symbol !== null) symbolCount.set(p.symbol, (symbolCount.get(p.symbol) ?? 0) + 1);
    if (p.gecko_id !== null) geckoCount.set(p.gecko_id, (geckoCount.get(p.gecko_id) ?? 0) + 1);
  }
  return snapshot.protocols.filter((p) => {
    if (p.mcap_usd === null || p.mcap_usd < 1_000_000) return false;
    if (p.tvl_usd <= 0) return false;
    if (p.symbol !== null && (symbolCount.get(p.symbol) ?? 0) > 1) return false;
    if (p.gecko_id !== null && (geckoCount.get(p.gecko_id) ?? 0) > 1) return false;
    return true;
  });
}

/**
 * The Huber log-log fit of log(market cap) on log(TVL): ordinary least squares first, then
 * iteratively reweighted least squares (k = 1.345, scale from the median absolute deviation),
 * until the coefficients stop moving. Returns A = exp(intercept) and b = slope, with the
 * log-scale R-squared of the final fit.
 */
export function huberLogLogFit(comps: SnapshotProtocol[]): SizeCurve {
  const xs = comps.map((p) => Math.log(p.tvl_usd));
  const ys = comps.map((p) => Math.log(p.mcap_usd!));
  const n = xs.length;
  const mean = (v: number[]): number => v.reduce((a, b) => a + b, 0) / v.length;

  /** Weighted least squares of y on x with the given weights; returns [intercept, slope]. */
  function wls(weights: number[]): [number, number] {
    let sw = 0;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    for (let i = 0; i < n; i++) {
      const w = weights[i]!;
      sw += w;
      sx += w * xs[i]!;
      sy += w * ys[i]!;
      sxx += w * xs[i]! * xs[i]!;
      sxy += w * xs[i]! * ys[i]!;
    }
    const denom = sw * sxx - sx * sx;
    const slope = (sw * sxy - sx * sy) / denom;
    const intercept = (sy - slope * sx) / sw;
    return [intercept, slope];
  }

  let [intercept, slope] = wls(new Array<number>(n).fill(1));
  const yMean0 = mean(ys);
  let ssTot0 = 0;
  let ssResOls = 0;
  for (let i = 0; i < n; i++) {
    ssTot0 += (ys[i]! - yMean0) ** 2;
    ssResOls += (ys[i]! - (intercept + slope * xs[i]!)) ** 2;
  }
  const rSquaredOls = ssTot0 > 0 ? 1 - ssResOls / ssTot0 : 0;
  for (let iter = 0; iter < 100; iter++) {
    const residuals = xs.map((x, i) => ys[i]! - (intercept + slope * x));
    const med = median(residuals);
    const mad = median(residuals.map((r) => Math.abs(r - med)));
    const scale = 1.4826 * mad;
    if (!(scale > 0) || !Number.isFinite(scale)) break;
    const weights = residuals.map((r) => {
      const u = Math.abs(r) / scale;
      return u <= 1.345 ? 1 : 1.345 / u;
    });
    const [nextIntercept, nextSlope] = wls(weights);
    const moved = Math.max(Math.abs(nextIntercept - intercept), Math.abs(nextSlope - slope));
    intercept = nextIntercept;
    slope = nextSlope;
    if (moved < 1e-12) break;
  }
  const yMean = mean(ys);
  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    const fitted = intercept + slope * xs[i]!;
    ssTot += (ys[i]! - yMean) ** 2;
    ssRes += (ys[i]! - fitted) ** 2;
  }
  return { a: Math.exp(intercept), b: slope, comps: n, rSquaredOls, rSquared: ssTot > 0 ? 1 - ssRes / ssTot : 0 };
}

/** The age bucket index for an age in days: <6mo, 6-12mo, 1-2y, 2-4y, >4y. */
export function ageBucket(age: number | null): number {
  if (age === null) return -1;
  if (age < 180) return 0;
  if (age < 365) return 1;
  if (age < 730) return 2;
  if (age < 1460) return 3;
  return 4;
}

/** The five age-bucket points: median age, token rate and member count per bucket. */
export function bucketPoints(snapshot: Snapshot): BucketPoint[] {
  const dated = snapshot.protocols.filter((p) => p.listed_at !== null);
  const points: BucketPoint[] = [];
  for (let b = 0; b < 5; b++) {
    const members = dated.filter((p) => ageBucket(ageDays(snapshot.as_of, p.listed_at)) === b);
    const ages = members.map((p) => ageDays(snapshot.as_of, p.listed_at)!).sort((x, y) => x - y);
    const hits = members.filter(recordsToken).length;
    points.push({
      medianAge: ages.length > 0 ? median(ages) : 0,
      rate: members.length > 0 ? hits / members.length : 0,
      n: members.length,
    });
  }
  return points;
}

/** The Weibull launch-time CDF at age t (days): F(t) = L * (1 - exp(-(t/tau)^k)). */
export function weibullF(t: number, L: number, tau: number, k: number): number {
  if (t <= 0) return 0;
  return L * (1 - Math.exp(-((t / tau) ** k)));
}

/**
 * Fit (tau, k) of the Weibull CDF to the bucket points at a fixed asymptote L, by weighted
 * least squares (weights = bucket member counts). A deterministic coarse-to-fine grid search
 * over (log tau, k): the surface is smooth and the fit is a 2-parameter problem on 5 points,
 * so a grid is exact enough and never diverges. Returns tau, k and the weighted SSE.
 */
export function fitWeibull(points: BucketPoint[], L: number): { tau: number; k: number; sse: number } {
  /** Weighted SSE of one (tau, k) pair against the bucket points. */
  function sse(tau: number, k: number): number {
    let total = 0;
    for (const pt of points) {
      const diff = weibullF(pt.medianAge, L, tau, k) - pt.rate;
      total += pt.n * diff * diff;
    }
    return total;
  }
  // Coarse grid: tau log-spaced 100..3000 (48 steps), k 0.30..1.20 (48 steps).
  let bestTau = 700;
  let bestK = 0.68;
  let bestSse = Number.POSITIVE_INFINITY;
  const tauSteps = 48;
  const kSteps = 48;
  for (let i = 0; i < tauSteps; i++) {
    const tau = Math.exp(Math.log(100) + (Math.log(3000) - Math.log(100)) * (i / (tauSteps - 1)));
    for (let j = 0; j < kSteps; j++) {
      const k = 0.3 + (1.2 - 0.3) * (j / (kSteps - 1));
      const value = sse(tau, k);
      if (value < bestSse) {
        bestSse = value;
        bestTau = tau;
        bestK = k;
      }
    }
  }
  // Two refinement passes: a 9x9 local grid around the best, halving the step each time.
  let tauStep = (Math.log(3000) - Math.log(100)) / (tauSteps - 1);
  let kStep = (1.2 - 0.3) / (kSteps - 1);
  for (let pass = 0; pass < 2; pass++) {
    tauStep /= 2;
    kStep /= 2;
    for (let i = -4; i <= 4; i++) {
      const tau = Math.exp(Math.log(bestTau) + i * tauStep);
      if (tau <= 0) continue;
      for (let j = -4; j <= 4; j++) {
        const k = bestK + j * kStep;
        if (k <= 0) continue;
        const value = sse(tau, k);
        if (value < bestSse) {
          bestSse = value;
          bestTau = tau;
          bestK = k;
        }
      }
    }
  }
  return { tau: bestTau, k: bestK, sse: bestSse };
}

/** The survivor odds before the category adjustment: (L - F(t)) / (1 - F(t)). */
export function survivorRate(age: number, L: number, tau: number, k: number): number {
  const f = weibullF(age, L, tau, k);
  return (L - f) / (1 - f);
}

/**
 * The launch-odds parameters, computed from the snapshot: the bucket rates (share recording
 * a token per age bucket), the per-category ever-rates SHRUNK toward the snapshot-wide rate
 * with pseudo-count K = 5 (shrunk = (n * raw + 5 * overall) / (n + 5)), the snapshot-wide
 * rate, and the Weibull CDF fitted to the bucket points at the fixed asymptote L = 0.85.
 * The 0.25 exponent on the relative category rate is what keeps a thin category's rate from
 * dominating the odds. Shrunk rates are never zero, so no member-count fallback is needed
 * and there is no cliff at n = 5.
 */
export function oddsParams(snapshot: Snapshot): OddsParams {
  const dated = snapshot.protocols.filter((p) => p.listed_at !== null);
  const bucketCounts = [0, 0, 0, 0, 0];
  const bucketHits = [0, 0, 0, 0, 0];
  for (const p of dated) {
    const bucket = ageBucket(ageDays(snapshot.as_of, p.listed_at));
    if (bucket < 0) continue;
    bucketCounts[bucket] += 1;
    if (recordsToken(p)) bucketHits[bucket] += 1;
  }
  const overall = snapshot.protocols.filter(recordsToken).length / snapshot.protocols.length;
  const bucketRates = bucketCounts.map((c, i) => (c > 0 ? bucketHits[i]! / c : overall));
  const byCategory = new Map<string, { n: number; hits: number }>();
  for (const p of snapshot.protocols) {
    const key = p.category ?? '(uncategorised)';
    const entry = byCategory.get(key) ?? { n: 0, hits: 0 };
    entry.n += 1;
    if (recordsToken(p)) entry.hits += 1;
    byCategory.set(key, entry);
  }
  const shrinkK = 5;
  const categoryRates = new Map<string, number>();
  const categoryRawRates = new Map<string, number>();
  const categoryCounts = new Map<string, number>();
  for (const [key, entry] of byCategory) {
    const raw = entry.hits / entry.n;
    categoryRawRates.set(key, raw);
    categoryCounts.set(key, entry.n);
    categoryRates.set(key, (entry.n * raw + shrinkK * overall) / (entry.n + shrinkK));
  }
  const points = bucketPoints(snapshot);
  const fit = fitWeibull(points, SURVIVOR_L);
  return {
    overall,
    bucketRates,
    bucketPoints: points,
    categoryRates,
    categoryRawRates,
    categoryCounts,
    shrinkK,
    exponent: 0.25,
    min: 0.05,
    max: 0.95,
    survivorL: SURVIVOR_L,
    survivorTau: fit.tau,
    survivorK: fit.k,
    survivorSse: fit.sse,
  };
}

/**
 * A protocol's launch odds under the fitted parameters, with its bucket and category rates.
 * The age factor is the SURVIVOR odds (L - F(t)) / (1 - F(t)) — the share of protocols that
 * will ever launch given they are pre-token now at this age — times the category adjustment.
 * A protocol with no listing date has no age, so it keeps the bucket-form fallback: the
 * snapshot-wide rate as its bucket rate, with the same category adjustment. `bucketOdds` is
 * the old bucket-form odds for the same row, kept for comparison in the detail view.
 */
export function launchOdds(
  protocol: SnapshotProtocol,
  asOf: string,
  odds: OddsParams,
): { odds: number; bucketRate: number; categoryRate: number; survivorRate: number | null; bucketOdds: number } {
  const age = ageDays(asOf, protocol.listed_at);
  const bucket = ageBucket(age);
  const bucketRate = bucket < 0 ? odds.overall : odds.bucketRates[bucket]!;
  // The category rate is the SHRUNK rate (never zero: the shrinkage pulls every
  // category toward the snapshot-wide rate), so the formula applies uniformly —
  // no zero-rate fallback and no n < 5 cliff. A protocol with no category uses
  // the snapshot-wide rate.
  const categoryRate = protocol.category === null ? odds.overall : (odds.categoryRates.get(protocol.category) ?? odds.overall);
  const categoryFactor = (categoryRate / odds.overall) ** odds.exponent;
  const bucketOdds = Math.min(odds.max, Math.max(odds.min, bucketRate * categoryFactor));
  if (age === null) {
    return { odds: bucketOdds, bucketRate, categoryRate, survivorRate: null, bucketOdds };
  }
  const surv = survivorRate(age, odds.survivorL, odds.survivorTau, odds.survivorK);
  const raw = surv * categoryFactor;
  return { odds: Math.min(odds.max, Math.max(odds.min, raw)), bucketRate, categoryRate, survivorRate: surv, bucketOdds };
}

/** The value if a token launches, from the fitted curve. */
export function valueIfLaunches(tvlUsd: number, curve: SizeCurve): number {
  return curve.a * tvlUsd ** curve.b;
}

/** The three multipliers and the implied value one protocol gets under the fitted model. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  fitted: FittedModel,
): { valueIfLaunches: number; odds: number; bucketRate: number; categoryRate: number; survivorRate: number | null; bucketOdds: number; implied: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const value = valueIfLaunches(protocol.tvl_usd, fitted.curve);
  const { odds, bucketRate, categoryRate, survivorRate: surv, bucketOdds } = launchOdds(protocol, asOf, fitted.odds);
  return {
    valueIfLaunches: value,
    odds,
    bucketRate,
    categoryRate,
    survivorRate: surv,
    bucketOdds,
    implied: Math.max(1, Math.round(value * odds)),
    age,
  };
}

/**
 * The full fitted model from the snapshot: the Huber size curve over the comp set, the odds
 * parameters (bucket rates, shrunk category rates and the Weibull survivor fit), and
 * placeholder band factors (lib/validate.ts fills the real ones from the leave-one-out
 * misses before the board is built).
 */
export function fitModel(snapshot: Snapshot): FittedModel {
  const comps = compSet(snapshot);
  if (comps.length < 10) throw new SnapshotError(`only ${comps.length} traded comps: the curve cannot be fit`);
  const curve = huberLogLogFit(comps);
  const odds = oddsParams(snapshot);
  return { curve, odds, band25: 1, band90: 1 };
}

/** The gas per transaction for a protocol's first chain. */
export function gasPerTx(protocol: SnapshotProtocol): number {
  const first = protocol.chains[0]?.toLowerCase() ?? '';
  return GAS_BY_CHAIN[first] ?? GAS_DEFAULT_USD;
}

/** One assumption the farm sensitivity grid changes at a time (lib/validate.ts). */
export interface FarmOverrides {
  /** Hold days outright (default: 60 when under 180 days old, else 90). */
  holdDays?: number;
  /** Forgone yield rate (default 0.04). */
  forgoneRate?: number;
  /** Bridge/withdraw allowance in dollars (default 1.50). */
  bridgeUsd?: number;
  /** Multiplier on the per-transaction gas (default 1). */
  gasMult?: number;
  /** Charge no weekly transaction (default false: one tx per week). */
  noWeeklyTx?: boolean;
  /** Time-share denominator mode: age/2 (default), age/1, or age/4. */
  timeShareMode?: 'half' | 'one' | 'quarter';
  /** Use the radar-4 verdict rule (FARM iff break-even odds <= 0.10) instead of the net rule. */
  oldRule?: boolean;
}

/**
 * One row's costed farm economics at a ticket size and airdrop share:
 *
 *   hold      60 days when the protocol is under 180 days old, else 90 (unknown age: 90)
 *   weeks     hold // 7
 *   time_share  hold / (age/2 + hold); age unknown counts as 365 days
 *   slice_if_launches = share * value_if_launches * ticket / TVL * time_share
 *   slice_expected    = slice_if_launches * odds
 *   fees      = (5 + weeks) transactions at the chain's gas, plus a $1.50 allowance
 *   hours     = (35 + 10 * weeks + 15) / 60
 *   forgone   = ticket * 4% * hold / 365
 *   net       = slice_expected - fees - forgone
 *   pays_from = the ticket at which the per-dollar slice first covers the forgone rate
 *               plus the fees, or null when no ticket pays
 *   break_even_odds = (fees + forgone) / slice_if_launches
 *   verdict   = FARM when the expected net is positive (odds > break-even odds),
 *               THIN when break-even odds <= 0.33, else SKIP
 *
 * The verdict uses the expected net, not the break-even threshold: a plan that nets
 * positive at the row's own odds is worth farming, and a plan that nets negative is not,
 * however low its break-even odds. The dashboard recomputes this live for every ticket.
 */
export function farmEconomics(
  protocol: SnapshotProtocol,
  asOf: string,
  valueIfLaunchesUsd: number,
  odds: number,
  ticket: number,
  share: number = AIRDROP_SHARE,
  over: FarmOverrides = {},
): FarmEconomics {
  const age = ageDays(asOf, protocol.listed_at);
  const holdDays = over.holdDays ?? (age !== null && age < 180 ? 60 : 90);
  const weeks = Math.floor(holdDays / 7);
  const ageForShare = age ?? 365;
  const denomAge = over.timeShareMode === 'one' ? ageForShare : over.timeShareMode === 'quarter' ? ageForShare / 4 : ageForShare / 2;
  const timeShare = holdDays / (denomAge + holdDays);
  const gas = gasPerTx(protocol) * (over.gasMult ?? 1);
  const nTx = over.noWeeklyTx ? 5 : 5 + weeks;
  const feesUsd = nTx * gas + (over.bridgeUsd ?? FEE_ALLOWANCE_USD);
  const hours = (35 + 10 * weeks + 15) / 60;
  const forgoneRate = over.forgoneRate ?? FORGONE_RATE;
  const forgoneUsd = ticket * forgoneRate * holdDays / 365;
  const sliceIfLaunchesUsd = (share * valueIfLaunchesUsd * ticket) / protocol.tvl_usd * timeShare;
  const sliceExpectedUsd = sliceIfLaunchesUsd * odds;
  const netUsd = sliceExpectedUsd - feesUsd - forgoneUsd;
  const netPerHourUsd = netUsd / hours;
  const breakEvenOdds = sliceIfLaunchesUsd > 0 ? (feesUsd + forgoneUsd) / sliceIfLaunchesUsd : Number.POSITIVE_INFINITY;
  const verdict: FarmEconomics['verdict'] = over.oldRule
    ? breakEvenOdds <= 0.1
      ? 'FARM'
      : breakEvenOdds <= THIN_BE_MAX
        ? 'THIN'
        : 'SKIP'
    : netUsd > 0
      ? 'FARM'
      : breakEvenOdds <= THIN_BE_MAX
        ? 'THIN'
        : 'SKIP';
  // The per-dollar expected slice, net of the forgone rate: the ticket at which the fees
  // are covered is fees / (per-dollar net). Null when the per-dollar net is not positive.
  const perDollarNet = (share * valueIfLaunchesUsd) / protocol.tvl_usd * timeShare * odds - forgoneRate * holdDays / 365;
  const paysFromUsd = perDollarNet > 0 ? Math.ceil(feesUsd / perDollarNet) : null;
  return {
    ticket,
    share,
    holdDays,
    weeks,
    hours,
    nTx,
    feesUsd,
    forgoneUsd,
    sliceIfLaunchesUsd,
    sliceExpectedUsd,
    netUsd,
    netPerHourUsd,
    paysFromUsd,
    breakEvenOdds,
    odds,
    verdict,
  };
}

/** A money figure with two decimals and a dollar sign, for the farm steps. */
function usd2(value: number): string {
  return `$${value.toFixed(2)}`;
}

/** The category action a farm plan's middle step names. */
function categoryAction(protocol: SnapshotProtocol): string {
  const category = (protocol.category ?? '').toLowerCase();
  if (category.includes('dex')) return 'add liquidity to the main pools';
  if (category.includes('lending')) return 'supply and borrow on the main market';
  if (category.includes('yield') || category.includes('vault')) return 'deposit into the vault';
  if (category.includes('bridge')) return 'bridge assets across the supported chains';
  if (category.includes('derivative')) return 'open a small position on the main market';
  if (category.includes('rwa')) return 'hold the tokenised asset in the vault';
  if (category.includes('prediction')) return 'take positions on the live markets';
  if (category.includes('risk') || category.includes('curator')) return 'allocate to a curated vault';
  return 'use the protocol as its docs describe';
}

/**
 * The farm plan's steps: 8 steps, each 20-600 trimmed characters, costed at the default
 * ticket and share. The last step is the netting line — slice, fees, forgone yield, net,
 * net per hour, the ticket it pays from, break-even odds and the verdict — so the plan's
 * economics are on the board, not only in the dashboard.
 */
export function farmSteps(protocol: SnapshotProtocol, econ: FarmEconomics): string[] {
  const chain = protocol.chains[0] ?? 'its chain';
  const category = (protocol.category ?? 'protocol').toLowerCase();
  const pays = econ.paysFromUsd === null ? 'never' : `$${econ.paysFromUsd.toLocaleString('en-US')}`;
  return [
    `Open a fresh wallet on ${chain} for this farm only, fund it with $${econ.ticket.toLocaleString('en-US')} plus $${(econ.feesUsd + 10).toFixed(2)} for fees, and keep it apart from the main wallet so a compromise costs only this farm.`,
    `Bridge the $${econ.ticket.toLocaleString('en-US')} to ${chain} if it is not there already, and check the bridge receipt and the wallet balance before moving on; a failed bridge is cheaper to fix than a failed deposit.`,
    `Deposit the ticket into the ${protocol.name} ${category} and ${categoryAction(protocol)}, in one transaction, then check the position is live on the protocol's own page before leaving it alone.`,
    `Once a week for ${econ.weeks} weeks, check the position, harvest or re-stake anything it earned, and log the balance; a weekly check takes about 10 minutes and keeps a dead position from sitting unnoticed.`,
    `Hold for ${econ.holdDays} days and stop if the protocol pauses withdrawals, changes its terms, or the TVL falls by half; the plan's value is the launch, not the yield, so there is nothing to defend by staying.`,
    `When the token launches, claim the airdrop in one transaction, sell half at once for the ticket back, and keep the other half only if the launch price holds for a day.`,
    `Exit by withdrawing the ticket and the remaining half, bridge back to the main chain, and close the farm wallet; the whole plan takes about ${econ.hours.toFixed(1)} hours of active work.`,
    `Net at $${econ.ticket.toLocaleString('en-US')} and a ${(econ.share * 100).toFixed(1)}% share: slice ${usd2(econ.sliceIfLaunchesUsd)} if it launches (${usd2(econ.sliceExpectedUsd)} expected at ${(econ.odds * 100).toFixed(1)}% odds) minus fees ${usd2(econ.feesUsd)} and forgone yield ${usd2(econ.forgoneUsd)} is ${usd2(econ.netUsd)} (${usd2(econ.netPerHourUsd)}/h); pays from ${pays}; break-even odds ${econ.breakEvenOdds.toFixed(2)}; verdict ${econ.verdict}.`,
  ];
}

/**
 * The traded comps nearest a board row by TVL: the three closest by log-TVL distance. Each
 * carries the curve's value for it and the miss, so the detail view shows how the curve does
 * on the row's neighbours.
 */
export function nearestComps(
  protocol: SnapshotProtocol,
  comps: SnapshotProtocol[],
  curve: SizeCurve,
  count = 3,
): NearestComp[] {
  const withDistance = comps
    .filter((c) => c.slug !== protocol.slug)
    .map((c) => ({
      comp: c,
      distance: Math.abs(Math.log(c.tvl_usd) - Math.log(protocol.tvl_usd)),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, count);
  return withDistance.map(({ comp }) => {
    const model = valueIfLaunches(comp.tvl_usd, curve);
    const mcap = comp.mcap_usd!;
    return {
      slug: comp.slug,
      name: comp.name,
      tvl_usd: comp.tvl_usd,
      mcap_usd: mcap,
      model_usd: Math.round(model),
      miss: Math.max(model / mcap, mcap / model),
    };
  });
}

/**
 * The per-category ever-rates for the Method tab: each category's member count, its raw
 * share recording a token, and its shrunk (K = 5) rate, highest raw rate first.
 */
export function categoryRatesTable(snapshot: Snapshot): { category: string; n: number; rate: number; shrunkRate: number }[] {
  const params = oddsParams(snapshot);
  return [...params.categoryCounts.entries()]
    .map(([category, n]) => ({
      category,
      n,
      rate: params.categoryRawRates.get(category) ?? params.overall,
      shrunkRate: params.categoryRates.get(category) ?? params.overall,
    }))
    .sort((a, b) => b.rate - a.rate || b.n - a.n || a.category.localeCompare(b.category));
}

/** The 758-protocol ledger, computed from the snapshot under the board rules. */
export function buildLedger(snapshot: Snapshot, board: BoardRow[]): LedgerGroup[] {
  const boardSlugs = new Set(board.map((r) => r.slug));
  const tokenTrades = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && !boardSlugs.has(p.slug));
  const tokenOnRecord = snapshot.protocols.filter(
    (p) => recordsToken(p) && !(p.mcap_usd !== null && p.mcap_usd > 0) && !boardSlugs.has(p.slug),
  );
  const setAside = snapshot.protocols.filter((p) => isPreToken(p) && !boardSlugs.has(p.slug));
  const reasonCounts = new Map<string, number>();
  for (const p of setAside) {
    const reason = setAsideReason(p);
    reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
  }
  const groups: LedgerGroup[] = [
    { label: 'Ranked on the board', count: board.length, reason: '40 watchlist + found above the floor + early below the floor' },
    { label: 'Token trades', count: tokenTrades.length, reason: 'records a market cap above zero' },
    { label: 'Token on record', count: tokenOnRecord.length, reason: 'records a token but no market cap above zero' },
  ];
  for (const [reason, count] of [...reasonCounts.entries()].sort((a, b) => b[1] - a[1])) {
    groups.push({ label: `Set aside: ${reason}`, count, reason: 'pre-token but excluded by the board rule' });
  }
  return groups;
}

/**
 * The ranked board: every watchlist slug, then the found set (the rankable pre-token
 * protocols above the floor the watchlist misses, by TVL), then the early set (the
 * rankable pre-token protocols below the floor, by TVL). Ranked by implied value
 * descending, ties by slug ascending. `rankRanges` carries the bootstrap p10-p90 rank
 * range per slug (lib/validate.ts); rows without one get their own rank as the range.
 */
export function buildBoard(
  snapshot: Snapshot,
  fitted: FittedModel,
  rankRanges: Map<string, { lo: number; hi: number }> = new Map(),
): { board: BoardRow[]; live: LiveRow[] } {
  const comps = compSet(snapshot);
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, { protocol: SnapshotProtocol; list: BoardRow['list'] }>();
  for (const slug of snapshot.watchlist) {
    const protocol = bySlug.get(slug);
    if (protocol !== undefined) chosen.set(slug, { protocol, list: 'watchlist' });
  }
  const rankable = snapshot.protocols.filter((p) => isRankable(p) && !chosen.has(p.slug));
  const aboveFloor = rankable
    .filter((p) => p.tvl_usd >= snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || a.slug.localeCompare(b.slug))
    .slice(0, FOUND_ROWS);
  for (const p of aboveFloor) chosen.set(p.slug, { protocol: p, list: 'found' });
  const belowFloor = rankable
    .filter((p) => p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || a.slug.localeCompare(b.slug))
    .slice(0, EARLY_ROWS);
  for (const p of belowFloor) chosen.set(p.slug, { protocol: p, list: 'early' });

  const scored = [...chosen.values()].map(({ protocol, list }) => {
    const { valueIfLaunches: value, odds, bucketRate, categoryRate, survivorRate: surv, bucketOdds, implied, age } = impliedValue(protocol, snapshot.as_of, fitted);
    const econ = farmEconomics(protocol, snapshot.as_of, value, odds, DEFAULT_TICKET);
    return { protocol, list, value, odds, bucketRate, categoryRate, survivorRate: surv, bucketOdds, implied, age, econ };
  });
  scored.sort((a, b) => b.implied - a.implied || a.protocol.slug.localeCompare(b.protocol.slug));

  const board: BoardRow[] = scored.map((s, index) => {
    const rank = index + 1;
    const range = rankRanges.get(s.protocol.slug) ?? { lo: rank, hi: rank };
    return {
      rank,
      slug: s.protocol.slug,
      name: s.protocol.name,
      category: s.protocol.category,
      chains: s.protocol.chains,
      tvl_usd: s.protocol.tvl_usd,
      change_7d: s.protocol.change_7d,
      mcap_usd: s.protocol.mcap_usd,
      listed_at: s.protocol.listed_at,
      gecko_id: s.protocol.gecko_id,
      symbol: s.protocol.symbol,
      token_status: 'pre-token',
      list: s.list,
      age_days: s.age,
      value_if_launches_usd: Math.round(s.value),
      odds: s.odds,
      implied_value_usd: s.implied,
      band_p25_usd: Math.max(1, Math.round(s.implied / fitted.band25)),
      band_p75_usd: Math.round(s.implied * fitted.band25),
      band_p10_usd: Math.max(1, Math.round(s.implied / fitted.band90)),
      band_p90_usd: Math.round(s.implied * fitted.band90),
      rank_range_lo: range.lo,
      rank_range_hi: range.hi,
      model: {
        curve_a: fitted.curve.a,
        curve_b: fitted.curve.b,
        bucket_rate: s.bucketRate,
        category_rate: s.categoryRate,
        odds: s.odds,
        age_days: s.age,
        survivor_rate: s.survivorRate,
        bucket_odds: s.bucketOdds,
      },
      nearest_comps: nearestComps(s.protocol, comps, fitted.curve),
      farm: s.econ,
      farm_steps: farmSteps(s.protocol, s.econ),
    };
  });

  const live: LiveRow[] = snapshot.protocols
    .filter((p) => recordsToken(p) && p.mcap_usd !== null && p.mcap_usd > 0)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || a.slug.localeCompare(b.slug))
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
  return { board, live };
}

/** Parse and validate a snapshot document. */
export function parseSnapshot(text: string): Snapshot {
  const data = JSON.parse(text) as Record<string, unknown>;
  if (!data || typeof data !== 'object') throw new SnapshotError('the snapshot is not a JSON object');
  if (typeof data.as_of !== 'string') throw new SnapshotError('the snapshot carries no as_of date');
  if (typeof data.floor_usd !== 'number' || !Number.isFinite(data.floor_usd) || data.floor_usd <= 0) {
    throw new SnapshotError('the snapshot carries no positive floor_usd');
  }
  if (!Array.isArray(data.protocols)) throw new SnapshotError('the snapshot carries no protocols array');
  if (!Array.isArray(data.watchlist)) throw new SnapshotError('the snapshot carries no watchlist array');
  const protocols = (data.protocols as Record<string, unknown>[]).map((row, i) => {
    if (typeof row.slug !== 'string' || row.slug.length === 0) throw new SnapshotError(`protocol ${i} carries no slug`);
    if (typeof row.name !== 'string' || row.name.length === 0) throw new SnapshotError(`protocol ${i} carries no name`);
    if (typeof row.tvl_usd !== 'number' || !Number.isFinite(row.tvl_usd) || row.tvl_usd < 0) {
      throw new SnapshotError(`${row.slug} carries no non-negative tvl_usd`);
    }
    return {
      slug: row.slug,
      name: row.name,
      category: typeof row.category === 'string' ? row.category : null,
      chains: Array.isArray(row.chains) ? (row.chains as string[]) : [],
      tvl_usd: row.tvl_usd,
      change_7d: typeof row.change_7d === 'number' ? row.change_7d : null,
      mcap_usd: typeof row.mcap_usd === 'number' ? row.mcap_usd : null,
      listed_at: typeof row.listed_at === 'string' ? row.listed_at : null,
      gecko_id: typeof row.gecko_id === 'string' ? row.gecko_id : null,
      symbol: typeof row.symbol === 'string' ? row.symbol : null,
    };
  });
  const floor = data.floor_usd;
  const watchlist = (data.watchlist as unknown[]).filter((s): s is string => typeof s === 'string');
  if (watchlist.length === 0) throw new SnapshotError('the watchlist is empty');
  const belowFloor = protocols.filter((p) => p.tvl_usd < floor).length;
  if (belowFloor === 0) throw new SnapshotError('no protocol sits below the watchlist floor');
  return {
    as_of: data.as_of,
    source: typeof data.source === 'string' ? data.source : 'DefiLlama',
    floor_usd: floor,
    protocols,
    watchlist,
  };
}

/** The board's own checks, in the order the gate's reference describes them. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const floor = snapshot.floor_usd;
  if (board.length < 100) return `the board carries only ${board.length} rows, below the 100 minimum`;
  if (board.length > 4_000) return `the board carries ${board.length} rows, above the 4000 maximum`;
  const onBoard = new Set(board.map((r) => r.slug));
  for (const slug of snapshot.watchlist) {
    if (!onBoard.has(slug)) return `the board does not cover the watchlist slug ${slug}`;
  }
  for (let i = 0; i < board.length; i++) {
    const row = board[i]!;
    if (row.rank !== i + 1) return `row ${i + 1} ranks ${row.rank}, not ${i + 1}`;
    if (row.implied_value_usd <= 0 || !Number.isInteger(row.implied_value_usd)) {
      return `${row.slug} has implied value ${row.implied_value_usd}, not a positive integer`;
    }
    if (i > 0 && row.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `${row.slug} outranks ${board[i - 1]!.slug} on a lower value: $${row.implied_value_usd} over $${board[i - 1]!.implied_value_usd}`;
    }
    if (row.odds < 0.05 || row.odds > 0.95) return `${row.slug} has odds ${row.odds}, outside [0.05, 0.95]`;
    if (!(row.band_p10_usd <= row.band_p25_usd && row.band_p25_usd <= row.implied_value_usd && row.implied_value_usd <= row.band_p75_usd && row.band_p75_usd <= row.band_p90_usd)) {
      return `${row.slug} has bands out of order around $${row.implied_value_usd}`;
    }
    if (row.tvl_usd < 0) return `${row.slug} carries a negative TVL`;
  }
  const belowFloorRows = board.filter((r) => r.tvl_usd < floor).length;
  if (belowFloorRows === 0) return 'no row on the board sits below the watchlist floor';
  for (const row of board) {
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `${row.slug} has ${row.farm_steps.length} farm steps, outside 3-12`;
    }
    for (const step of row.farm_steps) {
      const trimmed = step.trim().length;
      if (trimmed < 20 || trimmed > 600) return `${row.slug} has a farm step of ${trimmed} trimmed characters`;
    }
    if (!Number.isFinite(row.farm.breakEvenOdds)) return `${row.slug} has a non-finite break-even odds`;
    if (!['FARM', 'THIN', 'SKIP'].includes(row.farm.verdict)) return `${row.slug} has verdict ${row.farm.verdict}`;
    // The radar-5 verdict rule, audited on the board itself: FARM means the expected net
    // is positive at the row's odds, and a THIN row's net is not positive.
    if (row.farm.verdict === 'FARM' && !(row.farm.netUsd > 0)) {
      return `${row.slug} is FARM with net $${row.farm.netUsd.toFixed(2)}: the verdict rule says FARM iff net > 0`;
    }
    if (row.farm.verdict === 'THIN' && row.farm.netUsd > 0) {
      return `${row.slug} is THIN with net $${row.farm.netUsd.toFixed(2)}: a positive net is FARM`;
    }
  }
  return null;
}

/** The single `window.RADAR=` line the dashboard page reads. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};`;
}
