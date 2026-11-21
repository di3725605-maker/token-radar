export const MODEL_VERSION = 'radar-7';
const day = 86400000;
const sectors = ['CEX', 'Liquid Staking', 'Bridge', 'Canonical Bridge'];
const otherSectors = ['Liquid Restaking', 'Restaked BTC'];
export const median = xs => quantile(xs, 0.5);
export function quantile(xs, fraction) {
  if (!xs.length) return null;
  const sorted = [...xs].sort((a,b) => a-b);
  const at = (sorted.length - 1) * fraction;
  const i = Math.floor(at);
  return sorted[i] + (sorted[Math.ceil(at)] - sorted[i]) * (at-i);
}
export const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
export const sum = xs => xs.reduce((a,b) => a+b, 0);
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
    const xbar = sum(points.map(([x],i) => x * weights[i])) / w;
    const ybar = sum(points.map(([,y],i) => y * weights[i])) / w;
    const variance = sum(points.map(([x],i) => weights[i] * (x-xbar)**2));
    const slope = variance > 1e-12 ? sum(points.map(([x,y],i) => weights[i]*(x-xbar)*(y-ybar))) / variance : 0.5;
    const intercept = ybar - slope*xbar;
    if (Math.abs(intercept-a) + Math.abs(slope-b) < 1e-10) break;
    [a,b] = [intercept,slope];
    const residuals = points.map(([x,y]) => y-a-b*x);
    const center = median(residuals);
    const threshold = 1.345 * 1.4826 * median(residuals.map(r => Math.abs(r-center)));
    if (!(threshold > 1e-10)) break;
    weights = residuals.map(r => Math.min(1, threshold / Math.abs(r)));
  }
  if (!Number.isFinite(a) || !(b > 0 && b < 1)) {
    b = 0.5;
    a = median(points.map(([x,y]) => y-b*x)) ?? 0;
  }
  return {A: Math.exp(a), b, n: comps.length};
}
export const valueAt = (curve, tvl) => curve.A * tvl ** curve.b;
const boundaries = [180,365,730,1460,Infinity];
const bucket = age => boundaries.findIndex(limit => age < limit);
export function oddsParams(protocols) {
  const groups = boundaries.map(() => []);
  const counts = new Map();
  const overall = protocols.filter(token).length / (protocols.length || 1);
  for (const p of protocols) {
    if (p.age !== null) groups[bucket(p.age)].push(p);
    const count = counts.get(p.category) ?? {n:0, recorded:0};
    count.n++;
    count.recorded += Number(token(p));
    counts.set(p.category,count);
  }
  return {
    overall,
    buckets: groups.map(group => ({n:group.length, age:median(group.map(p => p.age)),
      rate:group.length ? group.filter(token).length/group.length : overall})),
    categories: Object.fromEntries([...counts].map(([key,c]) =>
      [key,{...c,rate:(c.recorded + 5*overall)/(c.n+5)}]))
  };
}
const adjustment = (params, category) => params.overall > 0
  ? ((params.categories[category]?.rate ?? params.overall) / params.overall)**0.25 : 1;
export function launchOdds(params, p) {
  const bucketRate = p.age === null ? params.overall : params.buckets[bucket(p.age)].rate;
  return clamp(bucketRate * adjustment(params,p.category), 0.05, 0.95);
}

const gas = {Ethereum:8, Bittensor:0.35, Solana:0.05, Base:0.05, Arbitrum:0.10,
  Optimism:0.05, Avalanche:0.10, BSC:0.10, 'BNB Chain':0.10, Polygon:0.05,
  Sui:0.05, 'Hyperliquid L1':0.05, Gnosis:0.05, Fantom:0.05};
export function farmEconomics(p, value, odds, ticket = 1000, share = 0.10) {
  const age = p.age ?? 365;
  const chain = p.chains[0] ?? 'Unknown chain';
  const hold = age < 180 ? 60 : 90;
  const weeks = Math.floor(hold/7);
  const transactions = 5 + weeks;
  const gasPerTx = Object.hasOwn(gas,chain) ? gas[chain] : 0.50;
  const fees = transactions * gasPerTx + 1.50;
  const forgone = ticket * 0.04 * hold / 365;
  const timeShare = hold/(age/2 + hold);
  const slice = share * value * ticket / p.tvl_usd * timeShare;
  const expectedSlice = odds * slice;
  const net = expectedSlice - fees - forgone;
  const hours = (50 + 10*weeks)/60;
  const breakEven = (fees + forgone) / slice;
  return {chain,ticket,share,hold,weeks,transactions,gasPerTx,fees,buffer:10,forgone,
    timeShare,slice,expectedSlice,net,hours,netPerHour:net/hours,breakEven,
    verdict:breakEven <= 0.10 ? 'FARM' : breakEven <= 0.33 ? 'THIN' : 'SKIP'};
}

function disposition(p, watchlist) {
  if (p.mcap_usd > 0) return 'Token trades';
  if (token(p)) return 'Token on record';
  if (watchlist.has(p.slug) && p.tvl_usd > 0) return 'Ranked';
  if ([...sectors,...otherSectors].includes(p.category)) return p.category;
  if (/\bv\d+(?:\.\d+)?\b/i.test(p.name)) return 'Versioned name';
  if (/\b(?:wrapped|staked|staking)\b/i.test(p.name)) return 'Wrapped/staked word';
  return p.tvl_usd > 0 ? 'Ranked' : 'No positive TVL';
}

export function buildLedger(snapshot) {
  const watchlist = new Set(snapshot.watchlist);
  const groups = new Map(['Ranked','Token trades','Token on record',...sectors,
    'Versioned name','Wrapped/staked word',...otherSectors].map(name => [name,[]]));
  for (const p of snapshot.protocols) {
    const name = disposition(p,watchlist);
    if (!groups.has(name)) groups.set(name,[]);
    groups.get(name).push(p);
  }
  return [...groups].filter(([,members]) => members.length).map(([name,members]) => ({
    name, count:members.length, members:members.map(({slug,name,category}) => ({slug,name,category}))
  }));
}
export const cohort = (p,snapshot) => snapshot.watchlist.includes(p.slug) ? 'watchlist'
  : p.tvl_usd >= snapshot.floor_usd ? 'found' : 'early';
export const verdictCounts = farms => Object.fromEntries(['FARM','THIN','SKIP'].map(v =>
  [v,farms.filter(f => f.verdict === v).length]));

export function buildBoard(snapshot, curve, params, ledger) {
  const ranked = new Set(ledger.find(group => group.name === 'Ranked')?.members.map(p => p.slug));
  return snapshot.protocols.filter(p => ranked.has(p.slug)).map(p => {
    const value = valueAt(curve,p.tvl_usd), odds = launchOdds(params,p);
    return {...p, cohort:cohort(p,snapshot), value, odds, implied:value*odds,
      bucketRate:p.age === null ? params.overall : params.buckets[bucket(p.age)].rate,
      categoryRate:params.categories[p.category]?.rate ?? params.overall,
      farms:Object.fromEntries([500,1000,5000,10000].map(t => [t, farmEconomics(p,value,odds,t)]))};
  }).sort((a,b) => b.implied-a.implied || a.slug.localeCompare(b.slug))
    .map((p,i) => ({...p,rank:i+1}));
}
export function survivorProbe(params, rows) {
  const points = params.buckets.filter(p => p.n);
  const curve = (age,L,tau,k) => L * -Math.expm1(-((age/tau)**k));
  return [0.80,0.85,0.90].map(L => {
    let logTau = Math.log(700), k = 0.7;
    const loss = (t,s) => sum(points.map(p => p.n*(curve(p.age,L,Math.exp(t),s)-p.rate)**2));
    for (let step = 0.4; step > 0.00001; step /= 2) {
      for (let repeat = 0; repeat < 100; repeat++) {
        let best = loss(logTau,k), next = [logTau,k];
        for (const dt of [-step,0,step]) for (const dk of [-step/2,0,step/2]) {
          if (k+dk <= 0 || Math.abs(logTau+dt) > 20) continue;
          const score = loss(logTau+dt,k+dk);
          if (score < best) { best = score; next = [logTau+dt,k+dk]; }
        }
        if (next[0] === logTau && next[1] === k) break;
        [logTau,k] = next;
      }
    }
    const tau = Math.exp(logTau);
    const alternatives = rows.map(p => {
      const f = curve(p.age ?? 365,L,tau,k);
      const odds = clamp((L-f)/(1-f)*adjustment(params,p.category),0.05,0.95);
      return {slug:p.slug,name:p.name,implied:p.value*odds,
        net:p.farms[1000].slice*odds-p.farms[1000].fees-p.farms[1000].forgone};
    }).sort((a,b) => b.implied-a.implied);
    return {L,tau,k,sse:loss(logTau,k),total:sum(alternatives.map(p => p.implied)),
      top:alternatives[0]?.name ?? null, polymarketRank:alternatives.findIndex(p => p.slug === 'polymarket-international')+1,
      positiveNet:alternatives.filter(p => p.net > 0).length};
  });
}
