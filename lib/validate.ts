// The model's validation, radar-5: every number the dashboard's Method tab quotes is computed
// here from the snapshot, at build time — never hand-set. Two tables are the exception and are
// labelled as such in the dashboard: the fair comp-set probes and the small-n rule test were
// computed by the fit scripts (fit4c, odds4b) and are stamped here as documented evidence,
// because every one of those rows is a DROP and the shipped model never uses them. The
// survivor-form sensitivity and the farm-math grid are NEW in radar-5 and are computed here,
// because the shipped model now uses the survivor form and the expected-net verdict rule.
//
//   leave-one-out   each comp is held out once; the curve (and any rung's extra terms) is
//                   refit on the other comps and the held-out cap is predicted. Miss =
//                   max(pred/actual, actual/pred). The median miss is the headline number;
//                   the P25-P75 band factor IS the median miss and the P10-P90 factor is the
//                   80th percentile, so the bands hold by construction on the held-out caps.
//   walk-forward    the comps are split by listing date: fit on the older, price the newer
//                   (50/50, 60/40, 70/30, 80/20, and fixed 2024-07-15 and 2025-01-01
//                   cutoffs). A model that only works in-sample dies here.
//   ablation        the ladder, rung by rung: flat multiple, + size curve, + quadratic term,
//                   + category premium (K = 8), + per-category (a, b) fits (K = 10 and
//                   K = 40), + momentum-on-TVL (±20% cap), + 7-day growth (clamped
//                   [0.8, 1.25]), + growth + age, + age only. A rung is kept only when it
//                   lowers the leave-one-out miss and the walk-forward miss does not rise by
//                   more than one paired-bootstrap standard error. Only the curve survives.
//   odds bake-off   the BUCKET-form launch-odds exponent sweep: for each exponent, the
//                   leave-one-out accuracy and Brier score of "records a token", plus the
//                   board the exponent produces (Sentora's rank, the board total). The
//                   survivor form is validated separately (split-half Brier of the F fit
//                   and its own LOO, below) because the bucket test measures the wrong
//                   estimand for survivor odds.
//   survivor LOO    the shipped survivor odds' leave-one-out accuracy and Brier score of
//                   "records a token" (each fold refits the bucket rates, the category
//                   rates and the Weibull CDF without the held-out protocol). It scores
//                   WORSE than the bucket form — honestly reported in the Method tab with
//                   the reason: the cross-sectional test asks P(has token | age), while
//                   survivor odds estimate P(will launch | pre-token now). Young protocols
//                   score high on the latter and low on the former by construction.
//   split-half      the Weibull F fit, validated as a fit: fit F on half the dated
//                   protocols, score P(token) = F(age) on the other half (and vice versa),
//                   against the bucket rates on the same halves.
//   bootstrap       200 refits on resampled comps rebuild the board; each row's rank range is
//                   its p10-p90 rank over the refits, and the top-20 stability is how many of
//                   the top 20 stay top 20 in at least 80% of refits. Deterministic seed, so
//                   the build reproduces.

import {
  ageBucket,
  ageDays,
  buildBoard,
  compSet,
  farmEconomics,
  fitWeibull,
  huberLogLogFit,
  impliedValue,
  launchOdds,
  median,
  oddsParams,
  percentile,
  recordsToken,
  survivorRate,
  valueIfLaunches,
  weibullF,
  type AblationRow,
  type BoardRow,
  type CompSetProbeRow,
  type FarmOverrides,
  type FarmSensitivityRow,
  type FittedModel,
  type OddsBakeoffRow,
  type SmallNRuleRow,
  type Snapshot,
  type SnapshotProtocol,
  type SplitHalfBrier,
  type SurvivorProbeRow,
  type ValidationSummary,
} from './model.ts';

/** max(pred/actual, actual/pred): how far a prediction misses, in either direction. */
export function miss(pred: number, actual: number): number {
  return Math.max(pred / actual, actual / pred);
}

/** A small deterministic PRNG (mulberry32), so the bootstrap reproduces run to run. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A Huber fit of log(market cap) on a design matrix (first column the intercept), by the
 * same IRLS as lib/model.ts's huberLogLogFit. Returns the coefficients, in column order.
 */
export function huberRegress(design: number[][], y: number[]): number[] {
  const n = y.length;
  const k = design[0]!.length;

  /** Weighted least squares for the given weights. */
  function wls(weights: number[]): number[] {
    // Normal equations: (X' W X) beta = X' W y, solved by Gaussian elimination.
    const a: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
    const b: number[] = new Array<number>(k).fill(0);
    for (let i = 0; i < n; i++) {
      const w = weights[i]!;
      for (let r = 0; r < k; r++) {
        for (let c = 0; c < k; c++) a[r]![c]! += w * design[i]![r]! * design[i]![c]!;
        b[r]! += w * design[i]![r]! * y[i]!;
      }
    }
    for (let col = 0; col < k; col++) {
      let pivot = col;
      for (let r = col + 1; r < k; r++) if (Math.abs(a[r]![col]!) > Math.abs(a[pivot]![col]!)) pivot = r;
      [a[col], a[pivot]] = [a[pivot]!, a[col]!];
      [b[col], b[pivot]] = [b[pivot]!, b[col]!];
      const d = a[col]![col]!;
      for (let r = col + 1; r < k; r++) {
        const factor = a[r]![col]! / d;
        for (let c = col; c < k; c++) a[r]![c]! -= factor * a[col]![c]!;
        b[r]! -= factor * b[col]!;
      }
    }
    const beta = new Array<number>(k).fill(0);
    for (let r = k - 1; r >= 0; r--) {
      let sum = b[r]!;
      for (let c = r + 1; c < k; c++) sum -= a[r]![c]! * beta[c]!;
      beta[r] = sum / a[r]![r]!;
    }
    return beta;
  }

  let beta = wls(new Array<number>(n).fill(1));
  for (let iter = 0; iter < 100; iter++) {
    const residuals = design.map((row, i) => y[i]! - row.reduce((s, x, j) => s + x * beta[j]!, 0));
    const med = median(residuals);
    const mad = median(residuals.map((r) => Math.abs(r - med)));
    const scale = 1.4826 * mad;
    if (!(scale > 0) || !Number.isFinite(scale)) break;
    const weights = residuals.map((r) => {
      const u = Math.abs(r) / scale;
      return u <= 1.345 ? 1 : 1.345 / u;
    });
    const next = wls(weights);
    const moved = Math.max(...next.map((v, j) => Math.abs(v - beta[j]!)));
    beta = next;
    if (moved < 1e-12) break;
  }
  return beta;
}

/** The 7-day change as a fraction, capped to [-0.6, +1.2] (the snapshot stores percent). */
export function growthFraction(p: SnapshotProtocol): number {
  const raw = (p.change_7d ?? 0) / 100;
  return Math.min(1.2, Math.max(-0.6, raw));
}

/** The age in years for a comp with a listing date, or null. */
function ageYears(p: SnapshotProtocol, asOf: string): number | null {
  const days = ageDays(asOf, p.listed_at);
  return days === null ? null : days / 365.25;
}

/** The flat-multiple baseline: the median mcap/TVL of the given comps. */
function flatMultiple(comps: SnapshotProtocol[]): number {
  return median(comps.map((p) => p.mcap_usd! / p.tvl_usd));
}

/**
 * The leave-one-out evaluation of the fitted curve: each comp held out once, the curve
 * refit on the rest, the held-out cap predicted. Returns the misses and their summary.
 */
export function looCurve(snapshot: Snapshot, comps: SnapshotProtocol[]): { misses: number[]; medianMiss: number; within3x: number } {
  const misses: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const train = comps.filter((_, j) => j !== i);
    const curve = huberLogLogFit(train);
    const held = comps[i]!;
    misses.push(miss(valueIfLaunches(held.tvl_usd, curve), held.mcap_usd!));
  }
  return {
    misses,
    medianMiss: median(misses),
    within3x: misses.filter((m) => m <= 3).length / misses.length,
  };
}

/** The leave-one-out evaluation of the flat-multiple baseline. */
export function looFlat(comps: SnapshotProtocol[]): number {
  const misses: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const train = comps.filter((_, j) => j !== i);
    misses.push(miss(flatMultiple(train) * comps[i]!.tvl_usd, comps[i]!.mcap_usd!));
  }
  return median(misses);
}

/**
 * One walk-forward split: fit on the older comps by listing date, price the newer ones.
 * `trainShare` splits the dated comps 50/50 or 70/30; `cutoff` uses a fixed date instead.
 */
export function walkForward(
  snapshot: Snapshot,
  comps: SnapshotProtocol[],
  trainShare: number | null,
  cutoff: string | null,
): number {
  const dated = comps
    .filter((p) => p.listed_at !== null)
    .sort((a, b) => a.listed_at!.localeCompare(b.listed_at!));
  let train: SnapshotProtocol[];
  let test: SnapshotProtocol[];
  if (cutoff !== null) {
    train = dated.filter((p) => p.listed_at! < cutoff);
    test = dated.filter((p) => p.listed_at! >= cutoff);
  } else {
    const split = Math.floor(dated.length * trainShare!);
    train = dated.slice(0, split);
    test = dated.slice(split);
  }
  if (train.length < 10 || test.length === 0) return Number.NaN;
  const curve = huberLogLogFit(train);
  const misses = test.map((p) => miss(valueIfLaunches(p.tvl_usd, curve), p.mcap_usd!));
  return median(misses);
}

/** The walk-forward split of the flat-multiple baseline. */
export function walkForwardFlat(comps: SnapshotProtocol[], trainShare: number): number {
  const dated = comps
    .filter((p) => p.listed_at !== null)
    .sort((a, b) => a.listed_at!.localeCompare(b.listed_at!));
  const split = Math.floor(dated.length * trainShare);
  const train = dated.slice(0, split);
  const test = dated.slice(split);
  const multiple = flatMultiple(train);
  return median(test.map((p) => miss(multiple * p.tvl_usd, p.mcap_usd!)));
}

/**
 * The ablation ladder. Each rung is evaluated by leave-one-out (refitting everything on the
 * other comps each fold) and by the three walk-forward splits. The extra terms are:
 * premium — the per-category median log-residual, shrunk toward 0 with pseudo-count K = 8;
 * growth — the 7-day fraction, mean-centred over the training comps, as a second regressor;
 * age — log(age in years) as a regressor (dated comps only).
 */
export function ablationLadder(snapshot: Snapshot, comps: SnapshotProtocol[]): AblationRow[] {
  const rows: AblationRow[] = [];
  const dated = comps.filter((p) => p.listed_at !== null);

  /** The design row for a comp under a rung: [1, logTVL, ...extras]. */
  function designRow(p: SnapshotProtocol, rung: string, trainMeanGrowth: number): number[] {
    const x = Math.log(p.tvl_usd);
    const row: number[] = [1, x];
    if (rung === 'quad') row.push(x * x);
    if (rung === 'growth' || rung === 'growth-age') row.push(growthFraction(p) - trainMeanGrowth);
    if (rung === 'growth-age' || rung === 'age') row.push(Math.log(ageYears(p, snapshot.as_of)!));
    return row;
  }

  /** Predict a held-out comp's cap from a training set under a design-based rung. Growth
   *  rungs clamp the extra term's multiplier to [0.8, 1.25] (fit report §3, rungs e/f). */
  function designPredict(train: SnapshotProtocol[], held: SnapshotProtocol, rung: string, meanGrowth: number): number {
    const design = train.map((p) => designRow(p, rung, meanGrowth));
    const y = train.map((p) => Math.log(p.mcap_usd!));
    const beta = huberRegress(design, y);
    const heldRow = designRow(held, rung, meanGrowth);
    if (rung === 'growth' || rung === 'growth-age') {
      const base = Math.exp(beta[0]! + beta[1]! * heldRow[1]!);
      let extra = 0;
      for (let j = 2; j < heldRow.length; j++) extra += beta[j]! * heldRow[j]!;
      return base * Math.min(1.25, Math.max(0.8, Math.exp(extra)));
    }
    return Math.exp(heldRow.reduce((s, v, j) => s + v * beta[j]!, 0));
  }

  /** Predict under the momentum rung: the 7-day growth shifts TVL by at most ±20% before
   *  the curve (the nyx77-style mechanism, fit report §3 rung d). */
  function momentumPredict(train: SnapshotProtocol[], held: SnapshotProtocol): number {
    const curve = huberLogLogFit(train);
    const shift = Math.min(0.2, Math.max(-0.2, growthFraction(held)));
    return valueIfLaunches(held.tvl_usd * (1 + shift), curve);
  }

  /** Predict under a per-category (a, b) rung: each category's own Huber fit, shrunk
   *  toward the global fit with pseudo-count K (fit report §3 rungs c2/c2b). */
  function perCategoryPredict(train: SnapshotProtocol[], held: SnapshotProtocol, shrinkK: number): number {
    const global = huberRegress(
      train.map((p) => [1, Math.log(p.tvl_usd)]),
      train.map((p) => Math.log(p.mcap_usd!)),
    );
    const key = held.category ?? '(uncategorised)';
    const same = train.filter((p) => (p.category ?? '(uncategorised)') === key);
    if (same.length < 3) return Math.exp(global[0]! + global[1]! * Math.log(held.tvl_usd));
    const local = huberRegress(
      same.map((p) => [1, Math.log(p.tvl_usd)]),
      same.map((p) => Math.log(p.mcap_usd!)),
    );
    const beta = local.map((v, j) => (same.length * v + shrinkK * global[j]!) / (same.length + shrinkK));
    return Math.exp(beta[0]! + beta[1]! * Math.log(held.tvl_usd));
  }

  /** Leave-one-out median miss for one rung. */
  function looRung(rung: string): { medianMiss: number; within3x: number } {
    const pool = rung === 'age' || rung === 'growth-age' ? dated : comps;
    const misses: number[] = [];
    for (let i = 0; i < pool.length; i++) {
      const held = pool[i]!;
      const train = pool.filter((_, j) => j !== i);
      const meanGrowth = train.reduce((s, p) => s + growthFraction(p), 0) / train.length;
      if (rung === 'flat') {
        misses.push(miss(flatMultiple(train) * held.tvl_usd, held.mcap_usd!));
        continue;
      }
      if (rung === 'premium') {
        const curve = huberLogLogFit(train);
        const residuals = train.map((p) => ({
          category: p.category ?? '(uncategorised)',
          resid: Math.log(p.mcap_usd!) - Math.log(valueIfLaunches(p.tvl_usd, curve)),
        }));
        const byCat = new Map<string, number[]>();
        for (const r of residuals) {
          const list = byCat.get(r.category) ?? [];
          list.push(r.resid);
          byCat.set(r.category, list);
        }
        const key = held.category ?? '(uncategorised)';
        const list = byCat.get(key) ?? [];
        const premium = list.length > 0 ? (list.length * median(list)) / (list.length + 8) : 0;
        misses.push(miss(valueIfLaunches(held.tvl_usd, curve) * Math.exp(premium), held.mcap_usd!));
        continue;
      }
      if (rung === 'momentum') {
        misses.push(miss(momentumPredict(train, held), held.mcap_usd!));
        continue;
      }
      if (rung === 'percat10' || rung === 'percat40') {
        misses.push(miss(perCategoryPredict(train, held, rung === 'percat10' ? 10 : 40), held.mcap_usd!));
        continue;
      }
      misses.push(miss(designPredict(train, held, rung, meanGrowth), held.mcap_usd!));
    }
    return { medianMiss: median(misses), within3x: misses.filter((m) => m <= 3).length / misses.length };
  }

  /** One walk-forward split for one rung. */
  function wfRung(rung: string, trainShare: number | null, cutoff: string | null): number {
    const pool = (rung === 'age' || rung === 'growth-age' ? dated : comps)
      .filter((p) => p.listed_at !== null)
      .sort((a, b) => a.listed_at!.localeCompare(b.listed_at!));
    let train: SnapshotProtocol[];
    let test: SnapshotProtocol[];
    if (cutoff !== null) {
      train = pool.filter((p) => p.listed_at! < cutoff);
      test = pool.filter((p) => p.listed_at! >= cutoff);
    } else {
      const split = Math.floor(pool.length * trainShare!);
      train = pool.slice(0, split);
      test = pool.slice(split);
    }
    if (train.length < 10 || test.length === 0) return Number.NaN;
    const meanGrowth = train.reduce((s, p) => s + growthFraction(p), 0) / train.length;
    if (rung === 'flat') {
      const multiple = flatMultiple(train);
      return median(test.map((p) => miss(multiple * p.tvl_usd, p.mcap_usd!)));
    }
    if (rung === 'premium') {
      const curve = huberLogLogFit(train);
      const residuals = train.map((p) => ({
        category: p.category ?? '(uncategorised)',
        resid: Math.log(p.mcap_usd!) - Math.log(valueIfLaunches(p.tvl_usd, curve)),
      }));
      const byCat = new Map<string, number[]>();
      for (const r of residuals) {
        const list = byCat.get(r.category) ?? [];
        list.push(r.resid);
        byCat.set(r.category, list);
      }
      return median(
        test.map((p) => {
          const key = p.category ?? '(uncategorised)';
          const list = byCat.get(key) ?? [];
          const premium = list.length > 0 ? (list.length * median(list)) / (list.length + 8) : 0;
          return miss(valueIfLaunches(p.tvl_usd, curve) * Math.exp(premium), p.mcap_usd!);
        }),
      );
    }
    if (rung === 'momentum') {
      return median(test.map((p) => miss(momentumPredict(train, p), p.mcap_usd!)));
    }
    if (rung === 'percat10' || rung === 'percat40') {
      const shrinkK = rung === 'percat10' ? 10 : 40;
      return median(test.map((p) => miss(perCategoryPredict(train, p, shrinkK), p.mcap_usd!)));
    }
    return median(test.map((p) => miss(designPredict(train, p, rung, meanGrowth), p.mcap_usd!)));
  }

  const rungs: { rung: string; label: string; verdict: string }[] = [
    { rung: 'flat', label: '(a) flat mcap/TVL multiple', verdict: 'baseline' },
    { rung: 'curve', label: '(b) + size curve (Huber)', verdict: 'KEEP' },
    { rung: 'quad', label: '(b2) + quadratic term', verdict: 'DROP' },
    { rung: 'premium', label: '(c) + category premium, K=8', verdict: 'DROP' },
    { rung: 'percat10', label: '(c2) + per-category (a, b), K=10', verdict: 'DROP' },
    { rung: 'percat40', label: '(c2b) + per-category (a, b), K=40', verdict: 'DROP' },
    { rung: 'momentum', label: '(d) + momentum-on-TVL, ±20% cap', verdict: 'DROP' },
    { rung: 'growth', label: '(e) + growth, clamped [0.8, 1.25]', verdict: 'DROP' },
    { rung: 'growth-age', label: '(f) + growth + age (log-years)', verdict: 'DROP' },
    { rung: 'age', label: '(g) + age only (log-years)', verdict: 'DROP' },
  ];
  for (const { rung, label, verdict } of rungs) {
    const loo = looRung(rung);
    rows.push({
      rung: label,
      looMedianMiss: loo.medianMiss,
      looWithin3x: loo.within3x,
      walkForward50: wfRung(rung, 0.5, null),
      walkForward60: wfRung(rung, 0.6, null),
      walkForward70: wfRung(rung, 0.7, null),
      walkForward80: wfRung(rung, 0.8, null),
      walkForwardCutoff: wfRung(rung, null, '2024-07-15'),
      walkForwardCutoff25: wfRung(rung, null, '2025-01-01'),
      verdict,
    });
  }
  return rows;
}

/**
 * Bucket-only odds parameters (no Weibull fit): the bucket rates, the shrunk category
 * rates and the overall rate, from a protocol list. The odds bake-off uses this — it
 * tests the bucket form, and fitting a Weibull for it would waste the build's time.
 */
function bucketOnlyParams(
  protocols: SnapshotProtocol[],
  asOf: string,
): { overall: number; bucketRates: number[]; categoryRates: Map<string, number> } {
  const dated = protocols.filter((p) => p.listed_at !== null);
  const bucketCounts = [0, 0, 0, 0, 0];
  const bucketHits = [0, 0, 0, 0, 0];
  for (const p of dated) {
    const bucket = ageBucket(ageDays(asOf, p.listed_at));
    if (bucket < 0) continue;
    bucketCounts[bucket] += 1;
    if (recordsToken(p)) bucketHits[bucket] += 1;
  }
  const overall = protocols.filter(recordsToken).length / protocols.length;
  const bucketRates = bucketCounts.map((c, i) => (c > 0 ? bucketHits[i]! / c : overall));
  const byCategory = new Map<string, { n: number; hits: number }>();
  for (const p of protocols) {
    const key = p.category ?? '(uncategorised)';
    const entry = byCategory.get(key) ?? { n: 0, hits: 0 };
    entry.n += 1;
    if (recordsToken(p)) entry.hits += 1;
    byCategory.set(key, entry);
  }
  const categoryRates = new Map<string, number>();
  for (const [key, entry] of byCategory) {
    categoryRates.set(key, (entry.n * (entry.hits / entry.n) + 5 * overall) / (entry.n + 5));
  }
  return { overall, bucketRates, categoryRates };
}

/** One protocol's BUCKET-form odds at exponent `e` (the old form, for the bake-off). */
function bucketOdds(
  protocol: SnapshotProtocol,
  asOf: string,
  params: { overall: number; bucketRates: number[]; categoryRates: Map<string, number> },
  e: number,
): number {
  const age = ageDays(asOf, protocol.listed_at);
  const bucket = ageBucket(age);
  const bucketRate = bucket < 0 ? params.overall : params.bucketRates[bucket]!;
  const categoryRate =
    protocol.category === null ? params.overall : (params.categoryRates.get(protocol.category) ?? params.overall);
  const raw = bucketRate * (categoryRate / params.overall) ** e;
  return Math.min(0.95, Math.max(0.05, raw));
}

/**
 * The launch-odds exponent bake-off on the BUCKET form: for each exponent, the
 * leave-one-out accuracy and Brier score of "records a token" over the dated protocols,
 * plus the board the exponent produces (Sentora's rank and implied value, and the board
 * total). The board is scored from the shipped board's slugs, so the comparison is on the
 * same 198 rows.
 */
export function oddsBakeoff(snapshot: Snapshot, fitted: FittedModel, boardSlugs: string[]): OddsBakeoffRow[] {
  const dated = snapshot.protocols.filter((p) => p.listed_at !== null);
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const exponents = [0, 0.125, 0.25, 0.375, 0.5, 0.75, 1.0];
  const rows: OddsBakeoffRow[] = [];
  for (const exponent of exponents) {
    // Leave-one-out classification: each protocol's bucket odds from the others' rates.
    let correct = 0;
    let brierSum = 0;
    for (let i = 0; i < dated.length; i++) {
      const held = dated[i]!;
      const others = snapshot.protocols.filter((p) => p.slug !== held.slug);
      const params = bucketOnlyParams(others, snapshot.as_of);
      const odds = bucketOdds(held, snapshot.as_of, params, exponent);
      const actual = recordsToken(held) ? 1 : 0;
      if ((odds >= 0.5) === (actual === 1)) correct += 1;
      brierSum += (odds - actual) ** 2;
    }
    // The board under this exponent (rank-only scoring on the shipped board's slugs).
    const params = bucketOnlyParams(snapshot.protocols, snapshot.as_of);
    const scored = boardSlugs
      .map((slug) => {
        const p = bySlug.get(slug)!;
        const value = valueIfLaunches(p.tvl_usd, fitted.curve);
        const odds = bucketOdds(p, snapshot.as_of, params, exponent);
        return { slug, implied: Math.max(1, Math.round(value * odds)) };
      })
      .sort((a, b) => b.implied - a.implied || a.slug.localeCompare(b.slug));
    const sentoraIndex = scored.findIndex((s) => s.slug === 'sentora-curator');
    const sentora = scored[sentoraIndex]!;
    rows.push({
      exponent,
      looAccuracy: correct / dated.length,
      looBrier: brierSum / dated.length,
      sentoraRank: sentoraIndex + 1,
      sentoraOdds: bucketOdds(bySlug.get('sentora-curator')!, snapshot.as_of, params, exponent),
      sentoraImplied: sentora.implied,
      boardTotal: scored.reduce((s, r) => s + r.implied, 0),
    });
  }
  return rows;
}

/**
 * The survivor-form sensitivity: at each fixed asymptote L, fit the Weibull CDF, build the
 * board the form produces, and report the board total and the FARM count at the $1,000
 * ticket. L = 0.85 is the shipped central case.
 */
export function survivorSensitivity(snapshot: Snapshot, fitted: FittedModel): SurvivorProbeRow[] {
  const rows: SurvivorProbeRow[] = [];
  for (const L of [0.8, 0.85, 0.9]) {
    const fit = fitWeibull(fitted.odds.bucketPoints, L);
    const trial: FittedModel = {
      ...fitted,
      odds: { ...fitted.odds, survivorL: L, survivorTau: fit.tau, survivorK: fit.k, survivorSse: fit.sse },
    };
    const { board } = buildBoard(snapshot, trial);
    const farm1000 = board.filter((r) => r.farm.verdict === 'FARM').length;
    rows.push({
      asymptoteL: L,
      tau: fit.tau,
      k: fit.k,
      weightedSse: fit.sse,
      odds56d: survivorRate(56, L, fit.tau, fit.k),
      odds407d: survivorRate(407, L, fit.tau, fit.k),
      odds1845d: survivorRate(1845, L, fit.tau, fit.k),
      boardTotal: board.reduce((s, r) => s + r.implied_value_usd, 0),
      farm1000,
      shipped: L === fitted.odds.survivorL,
    });
  }
  return rows;
}

/**
 * The shipped survivor odds' proper leave-one-out accuracy and Brier score of "records a
 * token" over the dated protocols: each fold refits the bucket rates, the category rates
 * and the Weibull CDF without the held-out protocol. Reported honestly in the Method tab
 * with the reason it scores below the bucket form: the test measures P(has token | age),
 * while survivor odds estimate P(will launch | pre-token now).
 */
export function survivorLoo(snapshot: Snapshot, fitted: FittedModel): { accuracy: number; brier: number } {
  const dated = snapshot.protocols.filter((p) => p.listed_at !== null);
  let correct = 0;
  let brierSum = 0;
  for (const held of dated) {
    const others = snapshot.protocols.filter((p) => p.slug !== held.slug);
    const params = oddsParams({ ...snapshot, protocols: others });
    const { odds } = launchOdds(held, snapshot.as_of, params);
    const actual = recordsToken(held) ? 1 : 0;
    if ((odds >= 0.5) === (actual === 1)) correct += 1;
    brierSum += (odds - actual) ** 2;
  }
  return { accuracy: correct / dated.length, brier: brierSum / dated.length };
}

/**
 * The split-half Brier of the Weibull launch-time CDF: split the dated protocols in two
 * deterministic halves (sorted slugs, even/odd), fit F on one half, score P(token) = F(age)
 * on the other half (and vice versa), against the bucket rates on the same halves.
 */
export function splitHalfBrier(snapshot: Snapshot, fitted: FittedModel): SplitHalfBrier {
  const dated = snapshot.protocols
    .filter((p) => p.listed_at !== null)
    .sort((a, b) => a.slug.localeCompare(b.slug));
  const halfA = dated.filter((_, i) => i % 2 === 0);
  const halfB = dated.filter((_, i) => i % 2 === 1);
  let fSum = 0;
  let bSum = 0;
  let nTest = 0;
  for (const [train, test] of [
    [halfA, halfB],
    [halfB, halfA],
  ] as [SnapshotProtocol[], SnapshotProtocol[]][]) {
    const params = oddsParams({ ...snapshot, protocols: train });
    const L = fitted.odds.survivorL;
    const fit = fitWeibull(params.bucketPoints, L);
    for (const p of test) {
      const age = ageDays(snapshot.as_of, p.listed_at)!;
      const actual = recordsToken(p) ? 1 : 0;
      fSum += (weibullF(age, L, fit.tau, fit.k) - actual) ** 2;
      const bucket = ageBucket(age);
      const bucketRate = bucket < 0 ? params.overall : params.bucketRates[bucket]!;
      bSum += (bucketRate - actual) ** 2;
      nTest += 1;
    }
  }
  return { weibullF: fSum / nTest, bucket: bSum / nTest, nTest: Math.floor(nTest / 2) };
}

/**
 * The farm-math sensitivity grid: one assumption changed at a time from the baseline, with
 * the FARM counts at the $1,000 and $10,000 tickets, computed from the shipped board's
 * rows. The last row is the radar-4 verdict rule for comparison: the old rule's FARM
 * count is 0 at $1,000 under the new model too, because break-even odds do not depend on
 * the launch odds at all.
 */
export function farmSensitivityGrid(snapshot: Snapshot, board: BoardRow[]): FarmSensitivityRow[] {
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  /** FARM count at a ticket under one override set (hold 30/45 and 90/120 are age-dependent). */
  function farmCount(ticket: number, over: FarmOverrides, holdPair?: [number, number]): number {
    let count = 0;
    for (const row of board) {
      const protocol = bySlug.get(row.slug)!;
      const age = row.age_days;
      const overrides: FarmOverrides = { ...over };
      if (holdPair !== undefined) overrides.holdDays = age !== null && age < 180 ? holdPair[0] : holdPair[1];
      const econ = farmEconomics(protocol, snapshot.as_of, row.value_if_launches_usd, row.odds, ticket, 0.1, overrides);
      if (econ.verdict === 'FARM') count += 1;
    }
    return count;
  }
  const variants: { change: string; over: FarmOverrides; holdPair?: [number, number]; defensible: string }[] = [
    { change: 'baseline', over: {}, defensible: '—' },
    { change: 'hold 30/45d (was 60/90)', over: {}, holdPair: [30, 45], defensible: 'No — hold is the qualification window, not a free parameter.' },
    { change: 'hold 90/120d', over: {}, holdPair: [90, 120], defensible: '—' },
    { change: 'forgone 0% (was 4%)', over: { forgoneRate: 0 }, defensible: 'No — opportunity cost is real; every top entry charges it too.' },
    { change: 'forgone 2%', over: { forgoneRate: 0.02 }, defensible: 'No — 4% is the T-bill rate; 2% is not.' },
    { change: 'forgone 6%', over: { forgoneRate: 0.06 }, defensible: '—' },
    { change: 'bridge $0 (was $1.50)', over: { bridgeUsd: 0 }, defensible: 'Partly — $0 is right only for same-chain rows.' },
    { change: 'bridge $5', over: { bridgeUsd: 5 }, defensible: '—' },
    { change: 'no weekly tx', over: { noWeeklyTx: true }, defensible: 'Fees are not the binding cost at $1k.' },
    { change: 'gas ×0.5', over: { gasMult: 0.5 }, defensible: 'No effect at $1k — same conclusion.' },
    { change: 'gas ×2', over: { gasMult: 2 }, defensible: '—' },
    { change: 'share 7% (was 10%)', over: {}, defensible: 'More conservative, fewer FARM. (share is set on the board, not here)' },
    { change: 'share 14%', over: {}, defensible: 'No — 14% is the optimistic end of the grid, not the verdict share.' },
    { change: 'time-share age/1 (flat TVL history)', over: { timeShareMode: 'one' }, defensible: 'No — assumes past TVL was already at today’s level.' },
    { change: 'time-share age/4 (fast growth)', over: { timeShareMode: 'quarter' }, defensible: 'No evidence for faster-than-linear growth.' },
    { change: 'old rule: FARM iff BE odds ≤ 0.10 (radar-4)', over: { oldRule: true }, defensible: 'The old rule is a stress test, not the expected-value decision; its FARM count does not depend on the odds at all.' },
  ];
  // The share variants change the verdict share, which farmEconomics takes as an argument,
  // so they are scored separately from the override path.
  const out: FarmSensitivityRow[] = [];
  for (const v of variants) {
    let f1000: number;
    let f10000: number;
    if (v.change.startsWith('share 7%')) {
      f1000 = board.filter((r) => farmEconomics(bySlug.get(r.slug)!, snapshot.as_of, r.value_if_launches_usd, r.odds, 1000, 0.07).verdict === 'FARM').length;
      f10000 = board.filter((r) => farmEconomics(bySlug.get(r.slug)!, snapshot.as_of, r.value_if_launches_usd, r.odds, 10000, 0.07).verdict === 'FARM').length;
    } else if (v.change.startsWith('share 14%')) {
      f1000 = board.filter((r) => farmEconomics(bySlug.get(r.slug)!, snapshot.as_of, r.value_if_launches_usd, r.odds, 1000, 0.14).verdict === 'FARM').length;
      f10000 = board.filter((r) => farmEconomics(bySlug.get(r.slug)!, snapshot.as_of, r.value_if_launches_usd, r.odds, 10000, 0.14).verdict === 'FARM').length;
    } else {
      f1000 = farmCount(1000, v.over, v.holdPair);
      f10000 = farmCount(10000, v.over, v.holdPair);
    }
    out.push({ change: v.change, farm1000: f1000, farm10000: f10000, defensible: v.defensible });
  }
  return out;
}

/**
 * The bootstrap rank ranges: 200 refits on resampled comps rebuild the board (implied
 * values and ranks only); each row's range is its p10-p90 rank over the refits. Returns
 * the ranges per slug and how many of the top 20 stay top 20 in at least 80% of refits.
 */
export function bootstrapRankRanges(
  snapshot: Snapshot,
  fitted: FittedModel,
  boardSlugs: string[],
  refits = 200,
): { ranges: Map<string, { lo: number; hi: number }>; top20Stable: number; rank1: Map<string, number> } {
  const comps = compSet(snapshot);
  const rng = mulberry32(20261120);
  const ranksBySlug = new Map<string, number[]>();
  for (const slug of boardSlugs) ranksBySlug.set(slug, []);
  const rank1 = new Map<string, number>();
  for (let r = 0; r < refits; r++) {
    const resampled: SnapshotProtocol[] = [];
    for (let i = 0; i < comps.length; i++) resampled.push(comps[Math.floor(rng() * comps.length)]!);
    const curve = huberLogLogFit(resampled);
    const trial: FittedModel = { ...fitted, curve };
    const scored = boardSlugs
      .map((slug) => {
        const p = snapshot.protocols.find((x) => x.slug === slug)!;
        return { slug, implied: impliedValue(p, snapshot.as_of, trial).implied };
      })
      .sort((a, b) => b.implied - a.implied || a.slug.localeCompare(b.slug));
    scored.forEach((s, index) => ranksBySlug.get(s.slug)!.push(index + 1));
    rank1.set(scored[0]!.slug, (rank1.get(scored[0]!.slug) ?? 0) + 1);
  }
  const ranges = new Map<string, { lo: number; hi: number }>();
  for (const [slug, ranks] of ranksBySlug) {
    ranges.set(slug, { lo: Math.round(percentile(ranks, 10)), hi: Math.round(percentile(ranks, 90)) });
  }
  const top20 = boardSlugs.slice(0, 20);
  let stable = 0;
  for (const slug of top20) {
    const ranks = ranksBySlug.get(slug)!;
    const stay = ranks.filter((r) => r <= 20).length / ranks.length;
    if (stay >= 0.8) stable += 1;
  }
  return { ranges, top20Stable: stable, rank1 };
}

/** The full validation pass: leave-one-out, walk-forward, ablation, bands and bootstrap. */
export function validateModel(
  snapshot: Snapshot,
  fitted: FittedModel,
): {
  summary: ValidationSummary;
  ablation: AblationRow[];
  oddsBakeoff: OddsBakeoffRow[];
  compProbes: CompSetProbeRow[];
  survivorProbes: SurvivorProbeRow[];
  smallNRules: SmallNRuleRow[];
  farmSensitivity: FarmSensitivityRow[];
  splitHalf: SplitHalfBrier;
  rank1Counts: { slug: string; name: string; count: number }[];
  ranges: Map<string, { lo: number; hi: number }>;
  band25: number;
  band90: number;
} {
  const comps = compSet(snapshot);
  const loo = looCurve(snapshot, comps);
  const flatLoo = looFlat(comps);
  const wf50 = walkForward(snapshot, comps, 0.5, null);
  const wf60 = walkForward(snapshot, comps, 0.6, null);
  const wf70 = walkForward(snapshot, comps, 0.7, null);
  const wf80 = walkForward(snapshot, comps, 0.8, null);
  const wfCutoff = walkForward(snapshot, comps, null, '2024-07-15');
  const wfCutoff25 = walkForward(snapshot, comps, null, '2025-01-01');
  const flatWf50 = walkForwardFlat(comps, 0.5);
  const band25 = loo.medianMiss;
  const band90 = percentile(loo.misses, 80);
  const band25Hold = loo.misses.filter((m) => m <= band25).length / loo.misses.length;
  const band90Hold = loo.misses.filter((m) => m <= band90).length / loo.misses.length;
  const ablation = ablationLadder(snapshot, comps);
  const { board } = buildBoard(snapshot, { ...fitted, band25, band90 });
  const boardSlugs = board.map((r) => r.slug);
  const oddsBakeoffRows = oddsBakeoff(snapshot, fitted, boardSlugs);
  const survLoo = survivorLoo(snapshot, fitted);
  const splitHalf = splitHalfBrier(snapshot, fitted);
  const survivorProbes = survivorSensitivity(snapshot, fitted);
  const farmSensitivity = farmSensitivityGrid(snapshot, board);
  const { ranges, top20Stable, rank1 } = bootstrapRankRanges(snapshot, fitted, boardSlugs);
  const top20Widths = board
    .slice(0, 20)
    .map((r) => (ranges.get(r.slug)?.hi ?? r.rank) - (ranges.get(r.slug)?.lo ?? r.rank));
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const rank1Counts = [...rank1.entries()]
    .map(([slug, count]) => ({ slug, name: bySlug.get(slug)?.name ?? slug, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
  return {
    summary: {
      looMedianMiss: loo.medianMiss,
      looWithin3x: loo.within3x,
      walkForward50: wf50,
      walkForward60: wf60,
      walkForward70: wf70,
      walkForward80: wf80,
      walkForwardCutoff: wfCutoff,
      walkForwardCutoff25: wfCutoff25,
      flatLooMedianMiss: flatLoo,
      flatWalkForward50: flatWf50,
      band25Hold,
      band90Hold,
      rankStabilityTop20: top20Stable,
      rankStabilityMedianWidth: median(top20Widths),
      rank1Polymarket: rank1.get('polymarket-international') ?? 0,
      rank1Sentora: rank1.get('sentora-curator') ?? 0,
      oddsLooAccuracy: survLoo.accuracy,
      oddsLooBrier: survLoo.brier,
      comps: comps.length,
      rSquared: fitted.curve.rSquared,
      rSquaredOls: fitted.curve.rSquaredOls,
    },
    ablation,
    oddsBakeoff: oddsBakeoffRows,
    compProbes: COMP_SET_PROBES,
    survivorProbes,
    smallNRules: SMALL_N_RULES,
    farmSensitivity,
    splitHalf,
    rank1Counts,
    ranges,
    band25,
    band90,
  };
}

/**
 * The fair comp-set probes (fit report §2.2, computed by fit4c.py): every candidate comp
 * set scored on the SAME sets — LOO over all 101 base comps and walk-forward with the test
 * window fixed — so a smaller set cannot win by dropping its hardest comps. The three
 * apparent wins in the first, unfair scoring were subset-selection artifacts. All DROP.
 */
export const COMP_SET_PROBES: CompSetProbeRow[] = [
  { label: 'base101 — control', trainN: 101, looAll101: 2.707, wf50: 2.26, wf70: 2.83, wfCut: 2.34, z: 0 },
  { label: 'mcap floor $2M', trainN: 90, looAll101: 2.685, wf50: 2.3, wf70: 3.32, wfCut: 2.92, z: -1.73 },
  { label: 'mcap floor $5M', trainN: 80, looAll101: 3.021, wf50: 2.31, wf70: 3.89, wfCut: 3.12, z: -2.27 },
  { label: 'mcap floor $10M', trainN: 58, looAll101: 4.483, wf50: 3.5, wf70: 3.79, wfCut: 3.35, z: -3.78 },
  { label: 'mcap/TVL ratio ≤ 10', trainN: 95, looAll101: 2.932, wf50: 2.5, wf70: 2.84, wfCut: 2.46, z: -0.22 },
  { label: 'mcap/TVL ratio ≤ 5', trainN: 94, looAll101: 2.916, wf50: 2.5, wf70: 2.84, wfCut: 2.46, z: -0.35 },
  { label: 'mcap/TVL ratio ≤ 3', trainN: 90, looAll101: 2.864, wf50: 2.52, wf70: 2.85, wfCut: 2.52, z: -0.62 },
  { label: 'floor $5M + ratio ≤ 5', trainN: 73, looAll101: 2.711, wf50: 2.44, wf70: 3.58, wfCut: 3.0, z: -1.72 },
  { label: 'floor $2M + ratio ≤ 5', trainN: 83, looAll101: 2.85, wf50: 2.46, wf70: 3.06, wfCut: 2.73, z: -0.79 },
];

/**
 * The small-n category-rule test (fit report §4.4, computed by odds4b.py): proper-LOO
 * accuracy and Brier per rule, and the board each rule produces (bucket-form odds, radar-4
 * model — the rule itself is about the category rates, which the survivor change does not
 * touch). All five rules sit within LOO noise (ΔBrier ≤ 0.0016); the shipped rule is
 * shrunk K = 5, chosen on principle — no cliff at n = 5, and the rank-1 row's category
 * (Prediction Market, n = 3) is too fragile to take raw. Rows with −1 were not reported
 * for that rule in the fit report.
 */
export const SMALL_N_RULES: SmallNRuleRow[] = [
  { rule: 'Fallback (n<5 → overall)', looAccuracy: 0.6605, looBrier: 0.2156, polymarketOdds: 0.797, polymarketImplied: 30_401_567, boardTotal: 1_241_579_997 },
  { rule: 'Raw rate, any n', looAccuracy: 0.6605, looBrier: 0.215, polymarketOdds: 0.704, polymarketImplied: 26_838_585, boardTotal: 1_234_082_736 },
  { rule: 'Shrunk K=3', looAccuracy: 0.6605, looBrier: 0.2159, polymarketOdds: -1, polymarketImplied: -1, boardTotal: -1 },
  { rule: 'Shrunk K=5 — SHIPPED', looAccuracy: 0.6605, looBrier: 0.216, polymarketOdds: 0.766, polymarketImplied: 29_214_821, boardTotal: 1_254_879_723 },
  { rule: 'Shrunk K=10', looAccuracy: 0.6605, looBrier: 0.2165, polymarketOdds: -1, polymarketImplied: -1, boardTotal: -1 },
];
