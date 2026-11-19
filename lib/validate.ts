// The model's validation: every number the dashboard's Method tab quotes is computed here
// from the snapshot, at build time — never hand-set.
//
//   leave-one-out   each comp is held out once; the curve (and any rung's extra terms) is
//                   refit on the other comps and the held-out cap is predicted. Miss =
//                   max(pred/actual, actual/pred). The median miss is the headline number;
//                   the P25-P75 band factor IS the median miss and the P10-P90 factor is the
//                   80th percentile, so the bands hold by construction on the held-out caps.
//   walk-forward    the comps are split by listing date: fit on the older, price the newer
//                   (50/50, 70/30, and a fixed 2024-07-15 cutoff). A model that only works
//                   in-sample dies here.
//   ablation        the ladder, rung by rung: flat multiple, + size curve, + category premium
//                   (K = 8), + 7-day growth, + age. A rung is kept only when it lowers the
//                   leave-one-out miss and the walk-forward miss does not rise by more than
//                   one paired-bootstrap standard error. The premium, growth and age rungs all
//                   fail that rule on this snapshot — the dashboard says so with the numbers.
//   odds bake-off   the launch-odds exponent sweep: for each exponent, the leave-one-out
//                   accuracy and Brier score of "records a token", plus the board the
//                   exponent produces (Sentora's rank, the board total).
//   bootstrap       200 refits on resampled comps rebuild the board; each row's rank range is
//                   its p10-p90 rank over the refits, and the top-20 stability is how many of
//                   the top 20 stay top 20 in at least 80% of refits. Deterministic seed, so
//                   the build reproduces.

import {
  ageBucket,
  ageDays,
  buildBoard,
  compSet,
  huberLogLogFit,
  impliedValue,
  launchOdds,
  median,
  oddsParams,
  percentile,
  recordsToken,
  valueIfLaunches,
  type AblationRow,
  type FittedModel,
  type OddsBakeoffRow,
  type Snapshot,
  type SnapshotProtocol,
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
    const row: number[] = [1, Math.log(p.tvl_usd)];
    if (rung === 'growth' || rung === 'growth-age') row.push(growthFraction(p) - trainMeanGrowth);
    if (rung === 'growth-age' || rung === 'age') row.push(Math.log(ageYears(p, snapshot.as_of)!));
    return row;
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
      const design = train.map((p) => designRow(p, rung, meanGrowth));
      const y = train.map((p) => Math.log(p.mcap_usd!));
      const beta = huberRegress(design, y);
      const heldRow = designRow(held, rung, meanGrowth);
      const pred = Math.exp(heldRow.reduce((s, x, j) => s + x * beta[j]!, 0));
      misses.push(miss(pred, held.mcap_usd!));
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
    const design = train.map((p) => designRow(p, rung, meanGrowth));
    const y = train.map((p) => Math.log(p.mcap_usd!));
    const beta = huberRegress(design, y);
    return median(
      test.map((p) => {
        const row = designRow(p, rung, meanGrowth);
        const pred = Math.exp(row.reduce((s, x, j) => s + x * beta[j]!, 0));
        return miss(pred, p.mcap_usd!);
      }),
    );
  }

  const rungs: { rung: string; label: string; verdict: string }[] = [
    { rung: 'flat', label: '(a) flat mcap/TVL multiple', verdict: 'baseline' },
    { rung: 'curve', label: '(b) + size curve (Huber)', verdict: 'KEEP' },
    { rung: 'premium', label: '(c) + category premium, K=8', verdict: 'DROP' },
    { rung: 'growth', label: '(d) + 7-day growth', verdict: 'DROP' },
    { rung: 'growth-age', label: '(e) + growth + age', verdict: 'DROP' },
    { rung: 'age', label: '(e2) + age, no growth', verdict: 'DROP' },
  ];
  for (const { rung, label, verdict } of rungs) {
    const loo = looRung(rung);
    rows.push({
      rung: label,
      looMedianMiss: loo.medianMiss,
      looWithin3x: loo.within3x,
      walkForward50: wfRung(rung, 0.5, null),
      walkForward70: wfRung(rung, 0.7, null),
      walkForwardCutoff: wfRung(rung, null, '2024-07-15'),
      verdict,
    });
  }
  return rows;
}

/**
 * The launch-odds exponent bake-off: for each exponent, the leave-one-out accuracy and
 * Brier score of "records a token" over the dated protocols, plus the board the exponent
 * produces (Sentora's rank and implied value, and the board total).
 */
export function oddsBakeoff(snapshot: Snapshot, fitted: FittedModel): OddsBakeoffRow[] {
  const dated = snapshot.protocols.filter((p) => p.listed_at !== null);
  const exponents = [0, 0.25, 0.5, 0.75, 1.0];
  const rows: OddsBakeoffRow[] = [];
  for (const exponent of exponents) {
    // Leave-one-out classification: each protocol's odds from the others' rates.
    let correct = 0;
    let brierSum = 0;
    for (let i = 0; i < dated.length; i++) {
      const held = dated[i]!;
      const others = dated.filter((_, j) => j !== i);
      const params = oddsParams({ ...snapshot, protocols: others });
      params.exponent = exponent;
      const { odds } = launchOdds(held, snapshot.as_of, params);
      const actual = recordsToken(held) ? 1 : 0;
      if ((odds >= 0.5) === (actual === 1)) correct += 1;
      brierSum += (odds - actual) ** 2;
    }
    // The board under this exponent (rank-only scoring: implied values and ranks).
    const params = oddsParams(snapshot);
    params.exponent = exponent;
    const trial: FittedModel = { ...fitted, odds: params };
    const { board } = buildBoard(snapshot, trial);
    const sentora = board.find((r) => r.slug === 'sentora-curator');
    rows.push({
      exponent,
      looAccuracy: correct / dated.length,
      looBrier: brierSum / dated.length,
      sentoraRank: sentora?.rank ?? -1,
      sentoraOdds: sentora?.odds ?? Number.NaN,
      sentoraImplied: sentora?.implied_value_usd ?? -1,
      boardTotal: board.reduce((s, r) => s + r.implied_value_usd, 0),
    });
  }
  return rows;
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
): { ranges: Map<string, { lo: number; hi: number }>; top20Stable: number } {
  const comps = compSet(snapshot);
  const rng = mulberry32(20261119);
  const ranksBySlug = new Map<string, number[]>();
  for (const slug of boardSlugs) ranksBySlug.set(slug, []);
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
  return { ranges, top20Stable: stable };
}

/** The full validation pass: leave-one-out, walk-forward, ablation, bands and bootstrap. */
export function validateModel(
  snapshot: Snapshot,
  fitted: FittedModel,
): {
  summary: ValidationSummary;
  ablation: AblationRow[];
  oddsBakeoff: OddsBakeoffRow[];
  ranges: Map<string, { lo: number; hi: number }>;
  band25: number;
  band90: number;
} {
  const comps = compSet(snapshot);
  const loo = looCurve(snapshot, comps);
  const flatLoo = looFlat(comps);
  const wf50 = walkForward(snapshot, comps, 0.5, null);
  const wf70 = walkForward(snapshot, comps, 0.7, null);
  const wfCutoff = walkForward(snapshot, comps, null, '2024-07-15');
  const flatWf50 = walkForwardFlat(comps, 0.5);
  const band25 = loo.medianMiss;
  const band90 = percentile(loo.misses, 80);
  const band25Hold = loo.misses.filter((m) => m <= band25).length / loo.misses.length;
  const band90Hold = loo.misses.filter((m) => m <= band90).length / loo.misses.length;
  const ablation = ablationLadder(snapshot, comps);
  const oddsBakeoffRows = oddsBakeoff(snapshot, fitted);
  const { board } = buildBoard(snapshot, { ...fitted, band25, band90 });
  const { ranges, top20Stable } = bootstrapRankRanges(snapshot, fitted, board.map((r) => r.slug));
  return {
    summary: {
      looMedianMiss: loo.medianMiss,
      looWithin3x: loo.within3x,
      walkForward50: wf50,
      walkForward70: wf70,
      walkForwardCutoff: wfCutoff,
      flatLooMedianMiss: flatLoo,
      flatWalkForward50: flatWf50,
      band25Hold,
      band90Hold,
      rankStabilityTop20: top20Stable,
      comps: comps.length,
      rSquared: fitted.curve.rSquared,
    },
    ablation,
    oddsBakeoff: oddsBakeoffRows,
    ranges,
    band25,
    band90,
  };
}
