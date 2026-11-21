import {fit, valueAt, median, quantile, sum, oddsParams, launchOdds, survivorProbe, verdictCounts} from './model.ts';

const miss = (p, estimate) => Math.max(estimate / p.mcap_usd, p.mcap_usd / estimate);
const huber = training => {
  const curve = fit(training);
  return p => valueAt(curve,p.tvl_usd);
};
const flat = training => {
  const multiple = median(training.map(p => p.mcap_usd / p.tvl_usd)) ?? 1;
  return p => multiple*p.tvl_usd;
};

function holdouts(comps, dated, fitter) {
  const loo = comps.map((p,i) => miss(p,fitter(comps.filter((_,j) => j!==i))(p)));
  const walk = fraction => {
    const split = Math.floor(dated.length * fraction);
    const predict = fitter(dated.slice(0,split));
    return {train:split,test:dated.length-split,median:median(dated.slice(split).map(p => miss(p,predict(p))))};
  };
  return {loo:{n:loo.length,median:median(loo),within3:loo.length ? loo.filter(x => x<=3).length/loo.length : null},
    wf50:walk(0.5),wf60:walk(0.6),wf70:walk(0.7),wf80:walk(0.8),
    bands:{middle50:quantile(loo,0.5),middle80:quantile(loo,0.8)}};
}

function generator(seed) {
  return () => {
    seed = (Math.imul(seed,1664525) + 1013904223) >>> 0;
    return seed/4294967296;
  };
}

function rankStability(comps,rows) {
  if (!comps.length || !rows.length) return {refits:0,stable20:0,top:[],ranges:{}};
  const random = generator(57941), iterations = 200;
  const ranks = new Map(rows.map(p => [p.slug,[]]));
  for (let i=0;i<iterations;i++) {
    const curve = fit(comps.map(() => comps[Math.floor(random()*comps.length)]));
    const ranking = rows.map(p => ({slug:p.slug,score:valueAt(curve,p.tvl_usd)*p.odds}))
      .sort((a,b) => b.score-a.score || a.slug.localeCompare(b.slug));
    ranking.forEach((p,j) => ranks.get(p.slug).push(j+1));
  }
  const ranges = Object.fromEntries(rows.map(p => {
    const rank = ranks.get(p.slug);
    return [p.slug,{p10:Math.ceil(quantile(rank,0.1)),p90:Math.floor(quantile(rank,0.9)),
      top20:rank.filter(n => n<=20).length/iterations}];
  }));
  return {refits:iterations,stable20:rows.slice(0,20).filter(p => ranges[p.slug].top20>=0.8).length,
    top:rows.slice(0,5).map(p => ({name:p.name, first:ranks.get(p.slug).filter(r => r===1).length})),ranges};
}

function splitHalf(protocols) {
  const random = generator(71429);
  const shuffled = protocols.filter(p => p.age !== null).map(p => [random(),p])
    .sort((a,b) => a[0]-b[0]).map(([,p]) => p);
  const split = Math.floor(shuffled.length/2);
  const training = shuffled.slice(0,split), holdout = shuffled.slice(split);
  const params = oddsParams(training);
  return {train:training.length,test:holdout.length,brier:holdout.length ? sum(holdout.map(p => {
    const actual = Number(p.mcap_usd != null || Boolean(p.symbol || p.gecko_id));
    return (launchOdds(params,p)-actual)**2;
  }))/holdout.length : null};
}

export function validate(comps,protocols,params,rows) {
  const dated = comps.filter(p => p.listed_at && p.age !== null)
    .sort((a,b) => a.listed_at.localeCompare(b.listed_at));
  const curve = holdouts(comps,dated,huber), baseline = holdouts(comps,dated,flat);
  const survivor = survivorProbe(params,rows).filter(p =>
    Number.isFinite(p.tau) && Number.isFinite(p.k) && Number.isFinite(p.sse));
  return {curve,baseline,splitHalf:splitHalf(protocols),survivor,
    stability:rankStability(comps,rows), tickets:[500,1000,5000,10000].map(ticket => ({
      ticket, ...verdictCounts(rows.map(p => p.farms[ticket]))
    }))};
}
