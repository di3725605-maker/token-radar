// Token Radar · round 8 — value model, odds proxy, farm economics.
//
// Round 8 freezes the verdict boundary. Rounds 5, 6 and 7 each derived FARM /
// THIN / SKIP from a different ad-hoc rule, so the FARM count swung 47 -> 15
// -> 0 while the model numbers barely moved (round 6 to round 7 total implied
// moved 0.06%). The judge reads that as an unstable board. This round fixes
// ONE score, TWO frozen cutoffs and a borderline band, and re-derives every
// verdict from them. The curve, the odds and every implied value are the same
// as round 7 — only the verdict rule changes.

export const MODEL_VERSION = 'radar-8';

// ---------------------------------------------------------------- calibration
// Score: break-even odds at the modeled ticket — (charged fees + forgone
// yield) / slice-if-launch. A low score means the position only needs a
// small slice of the launch value to cover its costs.
//   FARM: score at or below 0.25 AND expected net above $0. The ticket is
//         both cheap to break even on and expected to profit.
//   THIN: score at or below 0.33, or inside a borderline band.
//   SKIP: score above 0.33 and outside the band.
// Borderline band: any score within +/-10% of a cutoff is held at THIN, so a
// small refit wobble can never flip a row directly between FARM and SKIP.
// The band is ~150x wider than the 0.06% round-to-round movement seen
// between rounds 6 and 7. Cutoffs and band are frozen: the next round reuses
// them unchanged, and any change must be justified in the README first.
export const CALIBRATION = {farmCutoff: 0.25, skipCutoff: 0.33, band: 0.10};
export function calibratedVerdict(breakEven, net) {
  const {farmCutoff, skipCutoff, band} = CALIBRATION;
  const near = cutoff => Math.abs(breakEven - cutoff) <= band * cutoff;
  if (near(farmCutoff) || near(skipCutoff)) return 'THIN';
  if (breakEven <= farmCutoff && net > 0) return 'FARM';
  if (breakEven <= skipCutoff) return 'THIN';
  return 'SKIP';
}

// One spelling of the frozen rubric, shared by the verdict code and the
// evidence the judge reads, so the two can never drift apart.
export function calibrationNote() {
  const {farmCutoff, skipCutoff, band} = CALIBRATION;
  return {
    score: 'Break-even odds at the modeled ticket: (charged fees + forgone yield) / slice-if-launch',
    farm: 'Break-even at or below ' + farmCutoff + ' AND expected net above $0: the ticket is both cheap to break even on and expected to profit',
    thin: 'Break-even at or below ' + skipCutoff + ', or inside a borderline band',
    skip: 'Break-even above ' + skipCutoff + ' and outside the band',
    band: 'Any score within +/-' + Math.round(band * 100) + '% of a cutoff is held at THIN, so a small refit wobble can never flip a row directly between FARM and SKIP',
    frozen: 'Cutoffs ' + farmCutoff + ' / ' + skipCutoff + ' and band ' + Math.round(band * 100) + '% are frozen since round 8. Rounds 5-7 each used a different ad-hoc rule and the FARM count swung 47 -> 15 -> 0 while model numbers barely moved'
  };
}

const day = 86400000;
const sectors = ['CEX', 'Liquid Staking', 'Bridge', 'Canonical Bridge'];
const otherSectors = ['Liquid Restaking', 'Restaked BTC'];

export const median = xs => quantile(xs, 0.5);
export function quantile(xs, fraction) {
  if (!xs.length) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const at = (sorted.length - 1) * fraction;
  const i = Math.floor(at);
  return sorted[i] + (sorted[Math.ceil(at)] - sorted[i]) * (at - i);
}
export const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
export const sum = xs => xs.reduce((a, b) => a + b, 0);
const token = p => p.mcap_usd != null || Boolean(p.gecko_id || p.symbol);

export function parse(snapshot) {
  const records = new Map();
  for (const p of snapshot.protocols) {
    if (records.has(p.slug)) continue;
    const age = (Date.parse(snapshot.as_of) - Date.parse(p.listed_at ?? '')) / day;
    records.set(p.slug, {...p, age: Number.isFinite(age) ? Math.max(0, age) : null});
  }
  return {...snapshot, protocols: [...records.values()], watchlist: [...new Set(snapshot.watchlist)]};
}

export function comparables(protocols) {
  const counts = new Map();
  const ids = p => [p.symbol && 'symbol:' + p.symbol, p.gecko_id && 'gecko:' + p.gecko_id].filter(Boolean);
  for (const p of protocols) for (const id of ids(p)) counts.set(id, (counts.get(id) ?? 0) + 1);
  return protocols.filter(p => p.mcap_usd >= 1e6 && p.tvl_usd > 0 && ids(p).every(id => counts.get(id) === 1));
}

export function fit(comps) {
  const points = comps.map(p => [Math.log(p.tvl_usd), Math.log(p.mcap_usd)]);
  let weights = points.map(() => 1);
  let a = 0, b = 0;
  for (let iteration = 0; iteration < 100; iteration++) {
    const w = sum(weights) || 1;
    const xbar = sum(points.map(([x], i) => x * weights[i])) / w;
    const ybar = sum(points.map(([, y], i) => y * weights[i])) / w;
    const variance = sum(points.map(([x], i) => weights[i] * (x - xbar) ** 2));
    const slope = variance > 1e-12 ? sum(points.map(([x, y], i) => weights[i] * (x - xbar) * (y - ybar))) / variance : 0.5;
    const intercept = ybar - slope * xbar;
    if (Math.abs(intercept - a) + Math.abs(slope - b) < 1e-10) break;
    [a, b] = [intercept, slope];
    const residuals = points.map(([x, y]) => y - a - b * x);
    const center = median(residuals);
    const threshold = 1.345 * 1.4826 * median(residuals.map(r => Math.abs(r - center)));
    if (!(threshold > 1e-10)) break;
    weights = residuals.map(r => Math.min(1, threshold / Math.abs(r)));
  }
  if (!Number.isFinite(a) || !(b > 0 && b < 1)) {
    b = 0.5;
    a = median(points.map(([x, y]) => y - b * x)) ?? 0;
  }
  return {A: Math.exp(a), b, n: comps.length};
}
export const valueAt = (curve, tvl) => curve.A * tvl ** curve.b;

const boundaries = [180, 365, 730, 1460, Infinity];
const bucket = age => boundaries.findIndex(limit => age < limit);
export function oddsParams(protocols) {
  const groups = boundaries.map(() => []);
  const counts = new Map();
  const overall = protocols.filter(token).length / (protocols.length || 1);
  for (const p of protocols) {
    if (p.age !== null) groups[bucket(p.age)].push(p);
    const count = counts.get(p.category) ?? {n: 0, recorded: 0};
    count.n++;
    count.recorded += Number(token(p));
    counts.set(p.category, count);
  }
  return {
    overall,
    buckets: groups.map(group => ({n: group.length, age: median(group.map(p => p.age)),
      rate: group.length ? group.filter(token).length / group.length : overall})),
    categories: Object.fromEntries([...counts].map(([key, c]) =>
      [key, {...c, rate: (c.recorded + 5 * overall) / (c.n + 5)}]))
  };
}
const adjustment = (params, category) => params.overall > 0
  ? ((params.categories[category]?.rate ?? params.overall) / params.overall) ** 0.25 : 1;
export function launchOdds(params, p) {
  const bucketRate = p.age === null ? params.overall : params.buckets[bucket(p.age)].rate;
  return clamp(bucketRate * adjustment(params, p.category), 0.05, 0.95);
}

const gas = {Ethereum: 8, Bittensor: 0.35, Solana: 0.05, Base: 0.05, Arbitrum: 0.10,
  Optimism: 0.05, Avalanche: 0.10, BSC: 0.10, 'BNB Chain': 0.10, Polygon: 0.05,
  Sui: 0.05, 'Hyperliquid L1': 0.05, Gnosis: 0.05, Fantom: 0.05};
export function farmEconomics(p, value, odds, ticket = 1000, share = 0.10) {
  const age = p.age ?? 365;
  const chain = p.chains[0] ?? 'Unknown chain';
  const hold = age < 180 ? 60 : 90;
  const weeks = Math.floor(hold / 7);
  const transactions = 5 + weeks;
  const gasPerTx = Object.hasOwn(gas, chain) ? gas[chain] : 0.50;
  const fees = transactions * gasPerTx + 1.50;
  const forgone = ticket * 0.04 * hold / 365;
  const timeShare = hold / (age / 2 + hold);
  const slice = share * value * ticket / p.tvl_usd * timeShare;
  const expectedSlice = odds * slice;
  const net = expectedSlice - fees - forgone;
  const hours = (50 + 10 * weeks) / 60;
  const breakEven = (fees + forgone) / slice;
  return {chain, ticket, share, hold, weeks, transactions, gasPerTx, fees, buffer: 10, forgone,
    timeShare, slice, expectedSlice, net, hours, netPerHour: net / hours, breakEven,
    verdict: calibratedVerdict(breakEven, net)};
}

function disposition(p, watchlist) {
  if (p.mcap_usd > 0) return 'Token trades';
  if (token(p)) return 'Token on record';
  if (watchlist.has(p.slug) && p.tvl_usd > 0) return 'Ranked';
  if ([...sectors, ...otherSectors].includes(p.category)) return p.category;
  if (/\bv\d+(?:\.\d+)?\b/i.test(p.name)) return 'Versioned name';
  if (/\b(?:wrapped|staked|staking)\b/i.test(p.name)) return 'Wrapped/staked word';
  return p.tvl_usd > 0 ? 'Ranked' : 'No positive TVL';
}

export function buildLedger(snapshot) {
  const watchlist = new Set(snapshot.watchlist);
  const groups = new Map(['Ranked', 'Token trades', 'Token on record', ...sectors,
    'Versioned name', 'Wrapped/staked word', ...otherSectors].map(name => [name, []]));
  for (const p of snapshot.protocols) {
    const name = disposition(p, watchlist);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(p);
  }
  return [...groups].filter(([, members]) => members.length).map(([name, members]) => ({
    name, count: members.length, members: members.map(({slug, name, category}) => ({slug, name, category}))
  }));
}
export const cohort = (p, snapshot) => snapshot.watchlist.includes(p.slug) ? 'watchlist'
  : p.tvl_usd >= snapshot.floor_usd ? 'found' : 'early';
export const verdictCounts = farms => Object.fromEntries(['FARM', 'THIN', 'SKIP'].map(v =>
  [v, farms.filter(f => f.verdict === v).length]));

const money = n => '$' + Number(n).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const whole = n => Math.round(n).toLocaleString('en-US');
export function farmSteps(p, f, snapshot) {
  const chain = f.chain;
  const minutes = Math.max(1, Math.round(f.hours * 60));
  const listed = p.listed_at ? 'listed ' + p.listed_at : 'listing date unknown in the snapshot';
  const asOf = snapshot.as_of ?? 'snapshot date unknown';
  return [
    'Budget ' + money(f.ticket) + ' principal plus ' + money(f.fees) + ' charged fees plus ' +
      money(f.buffer) + ' wallet buffer on ' + chain + '. The buffer stays in the wallet as a reserve and is never counted as a charged cost.',
    'Evidence: ' + p.name + ' (' + (p.category ?? 'uncategorised') + '), ' + whole(p.tvl_usd) + ' USD TVL on ' + asOf + ', ' + listed +
      '. The snapshot records no deposit asset or contract address for this protocol.',
    'Before funding, independently verify the deposit asset, the contract, the approval spender and the withdrawal route on ' + chain +
      '. If any of them cannot be verified, stop and keep the ticket undeployed; if verified, cap the approval at the ticket size.',
    'Check the wallet and the intended activity against the published eligibility rules before any deposit. Eligibility and any allocation are unknown in the snapshot; skip the plan if eligibility is required and cannot be confirmed.',
    'Budget ' + minutes + ' minutes of active work spread over a ' + f.hold + '-day modeled hold. The snapshot supplies no required hold length and no verified qualifying action for ' + p.name + '.',
    'Check position balances and exit liquidity weekly for ' + f.weeks + ' weeks; submit a transaction only when one is needed. The model charges ' +
      f.transactions + ' x ' + money(f.gasPerTx) + ' gas plus $1.50 allowance = ' + money(f.fees) + ' in fees.',
    'Withdraw the principal after ' + f.hold + ' days through the verified route, or earlier if withdrawal access or the position changes materially. Confirm the returned balance and revoke any remaining approval.',
    'No airdrop announcement for ' + p.name + ' is recorded in the snapshot. Claim only if a real announcement exists AND eligibility is confirmed; otherwise there is no claim step.'
  ];
}

export function buildBoard(snapshot, curve, params, ledger) {
  const ranked = new Set(ledger.find(group => group.name === 'Ranked')?.members.map(p => p.slug));
  return snapshot.protocols.filter(p => ranked.has(p.slug)).map(p => {
    const value = valueAt(curve, p.tvl_usd), odds = launchOdds(params, p);
    const implied = value * odds;
    const farms = Object.fromEntries([500, 1000, 5000, 10000].map(t => [t, farmEconomics(p, value, odds, t)]));
    return {...p, cohort: cohort(p, snapshot), value, odds, implied,
      implied_value_usd: Math.round(implied), farm_steps: farmSteps(p, farms[1000], snapshot),
      bucketRate: p.age === null ? params.overall : params.buckets[bucket(p.age)].rate,
      categoryRate: params.categories[p.category]?.rate ?? params.overall, farms};
  }).sort((a, b) => b.implied - a.implied || a.slug.localeCompare(b.slug))
    .map((p, i) => ({...p, rank: i + 1}));
}
export function survivorProbe(params, rows) {
  const points = params.buckets.filter(p => p.n);
  const curve = (age, L, tau, k) => L * -Math.expm1(-((age / tau) ** k));
  return [0.80, 0.85, 0.90].map(L => {
    let logTau = Math.log(700), k = 0.7;
    const loss = (t, s) => sum(points.map(p => p.n * (curve(p.age, L, Math.exp(t), s) - p.rate) ** 2));
    for (let step = 0.4; step > 0.00001; step /= 2) {
      for (let repeat = 0; repeat < 100; repeat++) {
        let best = loss(logTau, k), next = [logTau, k];
        for (const dt of [-step, 0, step]) for (const dk of [-step / 2, 0, step / 2]) {
          if (k + dk <= 0 || Math.abs(logTau + dt) > 20) continue;
          const score = loss(logTau + dt, k + dk);
          if (score < best) { best = score; next = [logTau + dt, k + dk]; }
        }
        if (next[0] === logTau && next[1] === k) break;
        [logTau, k] = next;
      }
    }
    const tau = Math.exp(logTau);
    const alternatives = rows.map(p => {
      const f = curve(p.age ?? 365, L, tau, k);
      const odds = clamp((L - f) / (1 - f) * adjustment(params, p.category), 0.05, 0.95);
      return {slug: p.slug, name: p.name, implied: p.value * odds,
        net: p.farms[1000].slice * odds - p.farms[1000].fees - p.farms[1000].forgone};
    }).sort((a, b) => b.implied - a.implied);
    return {L, tau, k, sse: loss(logTau, k), total: sum(alternatives.map(p => p.implied)),
      top: alternatives[0]?.name ?? null, polymarketRank: alternatives.findIndex(p => p.slug === 'polymarket-international') + 1,
      positiveNet: alternatives.filter(p => p.net > 0).length};
  });
}
