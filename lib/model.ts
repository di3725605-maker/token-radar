export const MODEL_VERSION = 'radar-6';
export const SURVIVOR_L = .85;
export type Protocol = {
  slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null;
  listed_at: string | null; symbol: string | null; gecko_id: string | null;
};
export type Snapshot = {as_of: string; source: string; floor_usd: number; protocols: Protocol[]; watchlist: string[]};
export type List = 'watchlist' | 'found' | 'early';
export const rankedLabel = 'Ranked on the board';
export function parseSnapshot(raw: string): Snapshot {
  const s = JSON.parse(raw);
  if (!s || !Number.isFinite(Date.parse(s.as_of)) || !(s.floor_usd > 0) ||
      !Array.isArray(s.protocols) || !Array.isArray(s.watchlist) || !s.watchlist.length) throw Error('Invalid snapshot envelope');
  for (const p of s.protocols) {
    if (!p?.slug?.trim() || !p.name?.trim() || !Number.isFinite(p.tvl_usd) || p.tvl_usd < 0) throw Error('Invalid protocol record');
    p.chains = Array.isArray(p.chains) ? p.chains.filter(x => typeof x === 'string') : [];
    for (const key of ['listed_at','symbol','gecko_id','category']) if (typeof p[key] !== 'string') p[key] = null;
    for (const key of ['mcap_usd','change_7d']) if (!Number.isFinite(p[key])) p[key] = null;
  }
  if (!s.protocols.some(p => p.tvl_usd < s.floor_usd)) throw Error('No below-floor universe');
  return {...s, source: s.source || 'DefiLlama'};
}
export const ageDays = (asOf: string, date: string | null) => {
  const days = (Date.parse(asOf) - Date.parse(date ?? '')) / 86400000;
  return Number.isFinite(days) ? Math.max(0, Math.floor(days)) : null;
};
export const hasToken = (p: Protocol) => p.mcap_usd != null || p.gecko_id != null || p.symbol != null;
export const trades = (p: Protocol) => (p.mcap_usd ?? 0) > 0;
const excluded = ['CEX','Bridge','Canonical Bridge','Liquid Staking','Liquid Restaking','Restaked BTC'];
const version = /\s(v\d+(\.\d+)?|\d+\.\d+)$/i;
const wrapped = /\b(wrapped|staked|staking)\b/i;
const exchange = /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)\b/i;
export const rankable = (p: Protocol) => !hasToken(p) && !excluded.includes(p.category ?? '') && !version.test(p.name) && !wrapped.test(p.name) && !exchange.test(p.name);
export function disposition(p: Protocol, ranked: Set<string>) {
  if (ranked.has(p.slug)) return rankedLabel;
  if (trades(p)) return 'Token trades';
  if (hasToken(p)) return 'Token on record';
  const priority = excluded.slice(0,4).includes(p.category ?? '');
  return 'Set aside: ' + (priority ? p.category : version.test(p.name) ? 'versioned name' :
    wrapped.test(p.name) ? 'wrapped/staked word' : excluded.includes(p.category ?? '') ? p.category : 'other');
}
export function quantile(series: number[], q: number) {
  const a = [...series].sort((x,y) => x-y);
  const i = (a.length-1)*q, j = Math.floor(i);
  return a[j] + (a[Math.ceil(i)]-a[j])*(i-j);
}
export const median = (a: number[]) => quantile(a,.5);
export function compSet(s: Snapshot) {
  const tally = (field: 'symbol' | 'gecko_id') => {
    const m = new Map<string, number>();
    for (const p of s.protocols) if (p[field] !== null) m.set(p[field]!, 1+(m.get(p[field]!) ?? 0));
    return m;
  };
  const symbols = tally('symbol'), ids = tally('gecko_id');
  return s.protocols.filter(p => (p.mcap_usd ?? 0) >= 1e6 && p.tvl_usd > 0 &&
    (p.symbol === null || symbols.get(p.symbol) === 1) && (p.gecko_id === null || ids.get(p.gecko_id) === 1));
}
export function huberCurve(comps: Protocol[]) {
  const x = comps.map(p => Math.log(p.tvl_usd)), y = comps.map(p => Math.log(p.mcap_usd!));
  const w = x.map(() => 1);
  const solve = () => {
    let W=0,X=0,Y=0,XX=0,XY=0;
    x.forEach((v,i) => { W+=w[i]; X+=w[i]*v; Y+=w[i]*y[i]; XX+=w[i]*v*v; XY+=w[i]*v*y[i]; });
    const slope = (W*XY-X*Y)/(W*XX-X*X);
    return [(Y-slope*X)/W,slope];
  };
  let [c,b] = solve();
  const center = y.reduce((sum,v) => sum+v,0)/y.length;
  const r2 = () => 1-y.reduce((sum,v,i) => sum+(v-c-b*x[i])**2,0)/y.reduce((sum,v) => sum+(v-center)**2,0);
  const ols = r2();
  for (let j=0;j<100;j++) {
    const e=x.map((v,i)=>y[i]- (c+b*v)), mid=median(e), scale=1.4826*median(e.map(v=>Math.abs(v-mid)));
    if (!(scale>0)) break;
    e.forEach((v,i)=>{w[i]=Math.min(1,1.345*scale/Math.abs(v));});
    const [nc,nb]=solve(), delta=Math.max(Math.abs(nc-c),Math.abs(nb-b));
    c=nc; b=nb;
    if (delta<1e-12) break;
  }
  return {a:Math.exp(c),b,r2:r2(),ols};
}
export type Curve = ReturnType<typeof huberCurve>;
export const value = (tvl: number, curve: Curve) => curve.a*tvl**curve.b;
export const bucketIndex = (age: number | null) => age === null ? -1 : [180,365,730,1460,Infinity].findIndex(edge => age<edge);
export const clamp = (x: number) => Math.max(.05,Math.min(.95,x));
export const cdf = (t: number, L: number, tau: number, k: number) => L*(-Math.expm1(-((t/tau)**k)));
export function survivor(t: number, L: number, tau: number, k: number) {
  const f=cdf(t,L,tau,k);
  return (L-f)/(1-f);
}
export function prevalence(s: Snapshot) {
  const buckets = Array.from({length:5},()=>({ages:[] as number[], hits:0}));
  const categories = new Map<string,{n:number,hits:number}>();
  let hits=0;
  for (const p of s.protocols) {
    const t=ageDays(s.as_of,p.listed_at), i=bucketIndex(t), h=+hasToken(p);
    hits+=h;
    if(i>=0) {buckets[i].ages.push(t!); buckets[i].hits+=h;}
    const key=p.category ?? '(uncategorised)', c=categories.get(key) ?? {n:0,hits:0};
    c.n++; c.hits+=h; categories.set(key,c);
  }
  const overall=hits/s.protocols.length;
  return {overall, categories, points:buckets.map(({ages,hits})=>({t:ages.length?median(ages):0,n:ages.length,rate:ages.length?hits/ages.length:overall}))};
}
export function fitSurvivor(points: ReturnType<typeof prevalence>['points'], L=SURVIVOR_L) {
  let tau=700,k=.68,sse=Infinity;
  let dt=Math.log(30)/47,dk=.9/47;
  function probe(a:number,b:number) {
    if(b<=0) return;
    const e=points.reduce((sum,p)=>sum+p.n*(cdf(p.t,L,a,b)-p.rate)**2,0);
    if(e<sse) {tau=a;k=b;sse=e;}
  }
  for(let i=0;i<48;i++) for(let j=0;j<48;j++) probe(Math.exp(Math.log(100)+dt*i),.3+dk*j);
  for(let n=0;n<2;n++) {
    dt/=2;dk/=2;
    for(let i=-4;i<=4;i++) {
      const a=Math.exp(Math.log(tau)+i*dt);
      for(let j=-4;j<=4;j++) probe(a,k+j*dk);
    }
  }
  return {L,tau,k,sse};
}
export function oddsFor(p: Protocol, t: number | null, stats: ReturnType<typeof prevalence>, fit: ReturnType<typeof fitSurvivor>, exponent=.25, shrink=5) {
  const c=p.category===null?undefined:stats.categories.get(p.category);
  const category=c?(c.hits+shrink*stats.overall)/(c.n+shrink):stats.overall;
  const factor=stats.overall>0?(category/stats.overall)**exponent:1;
  const b=stats.points[bucketIndex(t)]?.rate ?? stats.overall;
  const surv=t===null?null:survivor(t,fit.L,fit.tau,fit.k);
  return {bucket_rate:b,category_rate:category,survivor_rate:surv,bucket_odds:clamp(b*factor),odds_survivor:clamp((surv??b)*factor)};
}
const gas: Record<string,number> = Object.fromEntries([
  [8,['ethereum']],[.35,['bittensor']],[.10,['arbitrum','avalanche','bnb chain','bsc']],
  [.05,['solana','base','optimism','polygon','sui','hyperliquid l1','gnosis','fantom']]
].flatMap(([price,names])=>(names as string[]).map(name=>[name,price])));
export function economy(p: Protocol, age: number|null, launch: number, odds: number, ticket=1000, share=.1,
  options: {hold?:number; gasMult?:number; allowance?:number; weekly?:boolean; forgone?:number; ageDivisor?:number; legacy?:boolean} = {}) {
  const holdDays=options.hold ?? (age!==null&&age<180?60:90);
  const weeks=Math.floor(holdDays/7), nTx=5+(options.weekly===false?0:weeks), hours=(50+10*weeks)/60;
  const gasUsd=(gas[p.chains[0]?.toLowerCase()]??.5)*(options.gasMult??1);
  const allowanceUsd=options.allowance??1.5, feesUsd=nTx*gasUsd+allowanceUsd;
  const forgoneUsd=ticket*(options.forgone??.04)*holdDays/365;
  const timeShare=holdDays/((age??365)/(options.ageDivisor??2)+holdDays);
  const sliceIfLaunchesUsd=share*launch*ticket/p.tvl_usd*timeShare;
  const sliceExpectedUsd=sliceIfLaunchesUsd*odds, netUsd=sliceExpectedUsd-feesUsd-forgoneUsd;
  const breakEvenOdds=(feesUsd+forgoneUsd)/sliceIfLaunchesUsd;
  const verdict=(options.legacy?breakEvenOdds<=.1:netUsd>0)?'FARM':breakEvenOdds<=.33?'THIN':'SKIP';
  const paysFromUsd=sliceExpectedUsd>forgoneUsd?Math.ceil(feesUsd*ticket/(sliceExpectedUsd-forgoneUsd)):null;
  return {ticket,share,holdDays,weeks,nTx,hours,gasUsd,allowanceUsd,feesUsd,reserveUsd:10,forgoneUsd,timeShare,
    sliceIfLaunchesUsd,sliceExpectedUsd,netUsd,breakEvenOdds,verdict,odds,netPerHourUsd:netUsd/hours,paysFromUsd};
}
export const usd2 = (v:number) => '$'+v.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
export function farmSteps(p: Protocol, e: ReturnType<typeof economy>, asOf: string) {
  const chain=p.chains[0]??'unknown chain';
  const asset=/\bstHYPE\b/.test(p.name)?'stHYPE is named in the snapshot; accepted asset and contract are unverified.':'Deposit asset and contract are unknown in the snapshot.';
  const activity=/lending/i.test(p.category??'')?'supply to a verified lending market':/dex/i.test(p.category??'')?'add liquidity to a verified pool':/restaking/i.test(p.category??'')?'deposit into a verified restaking position':'open a verified, withdrawable position';
  return [
    `Budget ${usd2(e.ticket)} principal + ${usd2(e.feesUsd)} charged fees + ${usd2(e.reserveUsd)} wallet buffer on ${chain}. The buffer is not deducted from expected net.`,
    `Evidence: ${p.name} / ${p.category??'unknown category'}, ${p.tvl_usd.toLocaleString('en-US')} USD TVL on ${asOf}; listing date ${p.listed_at??'unknown'}. ${asset}`,
    `Before funding, independently verify the asset, contract, approval spender and withdrawal route on ${chain}. If verified, cap approval at the ticket and ${activity}; otherwise stop. No contract or venue link is supplied.`,
    `Check the wallet and intended activity against published eligibility rules before any deposit. Eligibility and allocations are unknown; skip if eligibility is required and cannot be confirmed.`,
    `Budget ${Math.round(e.hours*60)} minutes of active work over a ${e.holdDays}-day modeled hold. The snapshot supplies no required hold or verified qualifying action.`,
    `Check position balances and exit liquidity weekly for ${e.weeks} weeks; submit a transaction only if needed. Model charges ${e.nTx} × ${usd2(e.gasUsd)} gas plus ${usd2(e.allowanceUsd)} allowance = ${usd2(e.feesUsd)} in fees.`,
    `Withdraw principal after ${e.holdDays} days through the verified route, or earlier if withdrawal access or the position changes materially. Check the returned balance and revoke any remaining approval.`,
    `Airdrop announcement unknown in the snapshot; no claim step until independently verified. Claim IF a real announcement exists AND eligibility is confirmed.`
  ];
}
export function selectRows(s: Snapshot) {
  const protocols=new Map(s.protocols.map(p=>[p.slug,p]));
  const watch=new Set(s.watchlist);
  const other=s.protocols.filter(p=>rankable(p)&&!watch.has(p.slug)).sort((a,b)=>b.tvl_usd-a.tvl_usd||a.slug.localeCompare(b.slug));
  return [
    ...s.watchlist.flatMap(slug=>protocols.has(slug)?[{p:protocols.get(slug)!,list:'watchlist' as List}]:[]),
    ...other.filter(p=>p.tvl_usd>=s.floor_usd).slice(0,20).map(p=>({p,list:'found' as List})),
    ...other.filter(p=>p.tvl_usd<s.floor_usd).slice(0,160).map(p=>({p,list:'early' as List}))
  ];
}
export function buildBoard(s: Snapshot, curve: Curve, stats: ReturnType<typeof prevalence>, fit: ReturnType<typeof fitSurvivor>,
  bands=[1,1], ranges=new Map<string,number[]>()) {
  const comps=compSet(s);
  const board=selectRows(s).map(({p,list})=>{
    const age=ageDays(s.as_of,p.listed_at), rates=oddsFor(p,age,stats,fit), odds=rates.bucket_odds;
    const launch=value(p.tvl_usd,curve), implied=Math.max(1,Math.round(launch*odds));
    const farm=economy(p,age,launch,odds);
    const nearest=comps.map(c=>({c,d:Math.abs(Math.log(c.tvl_usd/p.tvl_usd))})).sort((a,b)=>a.d-b.d).slice(0,3).map(({c})=>{
      const estimate=value(c.tvl_usd,curve);
      return {slug:c.slug,name:c.name,tvl_usd:c.tvl_usd,mcap_usd:c.mcap_usd,model_usd:Math.round(estimate),miss:Math.max(estimate/c.mcap_usd!,c.mcap_usd!/estimate)};
    });
    return {...p,list,token_status:'pre-token',age_days:age,odds,odds_survivor:rates.odds_survivor,bucket_odds:rates.bucket_odds,
      value_if_launches_usd:Math.round(launch),implied_value_usd:implied,
      band_p10_usd:Math.max(1,Math.round(implied/bands[1])),band_p25_usd:Math.max(1,Math.round(implied/bands[0])),
      band_p75_usd:Math.round(implied*bands[0]),band_p90_usd:Math.round(implied*bands[1]),
      model:{...rates,odds,age_days:age,curve_a:curve.a,curve_b:curve.b},
      farm,farm_steps:farmSteps(p,farm,s.as_of),nearest_comps:nearest};
  }).sort((a,b)=>b.implied_value_usd-a.implied_value_usd||a.slug.localeCompare(b.slug));
  return board.map((row,i)=>{
    const [lo,hi]=ranges.get(row.slug)??[i+1,i+1];
    return {...row,rank:i+1,rank_range_lo:lo,rank_range_hi:hi};
  });
}
export type BoardRow = ReturnType<typeof buildBoard>[number];
export function buildLedger(s: Snapshot, board: BoardRow[]) {
  const ranked=new Set(board.map(r=>r.slug));
  const groups=new Map<string, {slug:string;name:string}[]>([[rankedLabel,[]],['Token trades',[]],['Token on record',[]]]);
  for(const p of s.protocols) {
    const key=disposition(p,ranked);
    if(!groups.has(key)) groups.set(key,[]);
    groups.get(key)!.push({slug:p.slug,name:p.name});
  }
  return [...groups].map(([label,members])=>({label,count:members.length,members}));
}
export type Ledger = ReturnType<typeof buildLedger>;
export function expectedListCounts(s: Snapshot): Record<List,number> {
  const counts:Record<List,number>={watchlist:0,found:0,early:0};
  for(const {list} of selectRows(s)) counts[list]++;
  return counts;
}
export function reconcile(s: Snapshot, board: BoardRow[], ledger: Ledger) {
  const expected=new Map(s.protocols.map(p=>[p.slug,p])), ranked=new Set(board.map(r=>r.slug));
  const seen=new Map<string,number>();
  let errors=s.protocols.length-expected.size + board.length-ranked.size;
  for(const g of ledger) {
    errors+=Math.abs(g.count-g.members.length);
    for(const {slug} of g.members) {
      seen.set(slug,(seen.get(slug)??0)+1);
      const p=expected.get(slug);
      if(!p||disposition(p,ranked)!==g.label) errors++;
    }
  }
  for(const slug of expected.keys()) errors+=Math.abs((seen.get(slug)??0)-1);
  for(const slug of ranked) if(!expected.has(slug)) errors++;
  const ledger_total=ledger.reduce((n,g)=>n+g.count,0), universe=s.protocols.length;
  const exclusions_total=ledger.filter(g=>g.label!==rankedLabel).reduce((n,g)=>n+g.count,0);
  const counts=expectedListCounts(s), expectedRanked=counts.watchlist+counts.found+counts.early;
  const discrepancy=errors+Math.abs(ledger_total-universe)+Math.abs(board.length-expectedRanked)+
    (['watchlist','found','early'] as const).reduce((n,list)=>n+Math.abs(board.filter(r=>r.list===list).length-counts[list]),0);
  return {universe,ranked:board.length,ledger_total,ledger_groups:ledger.length,exclusions_total,
    status:(discrepancy===0?'PASS':'FAIL') as 'PASS'|'FAIL',discrepancy};
}
export type RadarData = {
  universe_size:number; reconciliation:ReturnType<typeof reconcile>; snapshot_id:string;
  as_of:string; source:string; floor_usd:number; model_version:string; rows:BoardRow[];
  ledger:Ledger; curve:Curve; validation:unknown; anchors:Protocol[];
  overall:number; buckets:number[]; fit:ReturnType<typeof fitSurvivor>;
};
