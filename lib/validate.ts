import {ageDays, bucketIndex, cdf, clamp, compSet, economy, fitSurvivor, hasToken, huberCurve, median, oddsFor, prevalence, quantile, survivor, value, type BoardRow, type Curve, type Protocol, type Snapshot} from './model.ts';

const miss=(estimate:number, actual:number)=>Math.max(estimate/actual,actual/estimate);
const loss=(a:number[])=>({miss:median(a),within3:a.filter(x=>x<=3).length/a.length,n:a.length});
const flat=(rows:Protocol[])=>median(rows.map(p=>p.mcap_usd!/p.tvl_usd));
const growth=(p:Protocol)=>Math.max(-.6,Math.min(1.2,(p.change_7d??0)/100));
const dated=(p:Protocol)=>p.listed_at!==null;
const byDate=(a:Protocol,b:Protocol)=>a.listed_at!.localeCompare(b.listed_at!);
function folds(comps:Protocol[], predict:(train:Protocol[],test:Protocol)=>number, accept=(p:Protocol)=>true){
  return comps.map((held,i)=>miss(predict(comps.filter((p,j)=>i!==j&&accept(p)),held),held.mcap_usd!));
}
const windows=[.5,.6,.7,.8,'2024-07-15','2025-01-01'];
function forward(comps:Protocol[], predict:(train:Protocol[],test:Protocol)=>number, accept=(p:Protocol)=>true){
  const a=comps.filter(dated).sort(byDate);
  return windows.map(window=>{
    const i=typeof window==='number'?Math.floor(a.length*window):a.filter(p=>p.listed_at!<window).length;
    const train=a.slice(0,i).filter(accept), test=a.slice(i);
    return {window,...(train.length>=10&&test.length?loss(test.map(p=>miss(predict(train,p),p.mcap_usd!))):{miss:null,within3:null,n:test.length}),train:train.length};
  });
}
function robustMatrix(X:number[][], y:number[]) {
  const n=X[0].length, weights=y.map(()=>1);
  const solve=()=>{
    const a=Array.from({length:n},(_,i)=>Array.from({length:n+1},(_,j)=>X.reduce((t,row,k)=>t+weights[k]*row[i]*(j===n?y[k]:row[j]),0)));
    for(let i=0;i<n;i++){
      let pivot=i;
      for(let j=i+1;j<n;j++) if(Math.abs(a[j][i])>Math.abs(a[pivot][i])) pivot=j;
      [a[i],a[pivot]]=[a[pivot],a[i]];
      const d=a[i][i];
      if(Math.abs(d)<1e-14) return null;
      for(let j=i;j<=n;j++) a[i][j]/=d;
      for(let k=0;k<n;k++) if(k!==i){
        const m=a[k][i];
        for(let j=i;j<=n;j++) a[k][j]-=m*a[i][j];
      }
    }
    return a.map(row=>row[n]);
  };
  let beta=solve();
  if(!beta) return null;
  for(let j=0;j<100;j++){
    const e=X.map((r,i)=>y[i]-r.reduce((v,x,k)=>v+x*beta![k],0)), c=median(e);
    const scale=1.4826*median(e.map(v=>Math.abs(v-c)));
    if(!(scale>0)) break;
    e.forEach((v,i)=>{weights[i]=Math.min(1,1.345*scale/Math.abs(v));});
    const next=solve();
    if(!next) break;
    const delta=Math.max(...next.map((v,i)=>Math.abs(v-beta![i])));
    beta=next;
    if(delta<1e-12) break;
  }
  return beta;
}
const curvePrice=(train:Protocol[],p:Protocol)=>value(p.tvl_usd,huberCurve(train));
function ablation(s:Snapshot, comps:Protocol[]){
  return ['Flat multiple','Huber TVL curve','Quadratic log TVL','Category premium K=8',
    'Category coefficients K=10','Category coefficients K=40','7-day momentum on TVL',
    '7-day growth','7-day growth plus listing age','Listing age'].map((label,mode)=>{
    const pool=mode>=8?comps.filter(dated):comps;
    const predict=(train:Protocol[],p:Protocol)=>{
      if(mode===0) return flat(train)*p.tvl_usd;
      if(mode===1) return curvePrice(train,p);
      if(mode===3){
        const c=huberCurve(train), same=train.filter(x=>x.category===p.category);
        const adjustment=same.length?median(same.map(x=>Math.log(x.mcap_usd!/value(x.tvl_usd,c))))*same.length/(same.length+8):0;
        return value(p.tvl_usd,c)*Math.exp(adjustment);
      }
      if(mode===4||mode===5){
        const global=huberCurve(train), same=train.filter(x=>x.category===p.category), K=mode===4?10:40;
        if(same.length<3) return value(p.tvl_usd,global);
        const local=huberCurve(same), w=same.length/(same.length+K);
        return value(p.tvl_usd,local)**w*value(p.tvl_usd,global)**(1-w);
      }
      if(mode===6) return value(p.tvl_usd*(1+Math.max(-.2,Math.min(.2,growth(p)))),huberCurve(train));
      const avg=train.reduce((t,x)=>t+growth(x),0)/train.length;
      const design=(x:Protocol)=>{
        const lx=Math.log(x.tvl_usd), row=[1,lx];
        if(mode===2) row.push(lx*lx);
        if(mode===7||mode===8) row.push(growth(x)-avg);
        if(mode>=8) row.push(Math.log((ageDays(s.as_of,x.listed_at)??0)/365.25));
        return row;
      };
      const beta=robustMatrix(train.map(design),train.map(x=>Math.log(x.mcap_usd!)));
      if(!beta) return curvePrice(train,p);
      const row=design(p), base=Math.exp(beta[0]+beta[1]*row[1]);
      const adjust=Math.exp(row.slice(2).reduce((t,x,i)=>t+x*beta[i+2],0));
      return base*((mode===7||mode===8)?Math.max(.8,Math.min(1.25,adjust)):adjust);
    };
    return {label,decision:mode===0?'Baseline':mode===1?'Keep':'Drop',loo:loss(folds(pool,predict)),walk:forward(pool,predict)};
  });
}
function compProbes(comps:Protocol[]){
  return [[1e6,Infinity],[2e6,Infinity],[5e6,Infinity],[10e6,Infinity],[1e6,10],[1e6,5],[1e6,3],[5e6,5],[2e6,5]].map(([floor,cap])=>{
    const admit=(p:Protocol)=>p.mcap_usd!>=floor&&p.mcap_usd!/p.tvl_usd<=cap;
    return {label:`Cap ≥ $${floor/1e6}M${Number.isFinite(cap)?'; cap/TVL ≤ '+cap:''}`,train:comps.filter(admit).length,
      loo:loss(folds(comps,curvePrice,admit)),walk:forward(comps,curvePrice,admit)};
  });
}
function presenceStats(pairs:[number,number][]){
  return {n:pairs.length,accuracy:pairs.filter(([p,y])=>Number(p>=.5)===y).length/pairs.length,
    brier:pairs.reduce((n,[p,y])=>n+(p-y)**2,0)/pairs.length};
}
function bucketOdds(p:Protocol,t:number|null,raw:ReturnType<typeof prevalence>,exponent:number,rule:number){
  const c=p.category===null?null:raw.categories.get(p.category);
  const category=!c||rule===-1&&c.n<5?raw.overall:rule<=0?c.hits/c.n:(c.hits+rule*raw.overall)/(c.n+rule);
  const rate=raw.points[bucketIndex(t)]?.rate??raw.overall;
  return clamp(rate*(category/raw.overall)**exponent);
}
function oddsChecks(s:Snapshot,rows:BoardRow[],curve:Curve,raw:ReturnType<typeof prevalence>,fit:ReturnType<typeof fitSurvivor>){
  const folds=s.protocols.filter(dated).map(p=>{
    const stats=prevalence({...s,protocols:s.protocols.filter(x=>x.slug!==p.slug)});
    return {p,t:ageDays(s.as_of,p.listed_at),stats,fit:fitSurvivor(stats.points,fit.L),y:+hasToken(p)};
  });
  const bySlug=new Map(s.protocols.map(p=>[p.slug,p]));
  function trial(exponent:number,rule:number){
    const metrics=presenceStats(folds.map(({p,t,stats,y})=>[bucketOdds(p,t,stats,exponent,rule),y]));
    const sorted=rows.map(r=>({slug:r.slug,odds:bucketOdds(bySlug.get(r.slug)!,r.age_days,raw,exponent,rule),launch:value(r.tvl_usd,curve)}))
      .map(r=>({...r,implied:Math.max(1,Math.round(r.launch*r.odds))})).sort((a,b)=>b.implied-a.implied||a.slug.localeCompare(b.slug));
    return {exponent,rule,...metrics,total:sorted.reduce((a,r)=>a+r.implied,0),leader:sorted[0],
      sentora:sorted.findIndex(r=>r.slug==='sentora-curator')+1,polymarket:sorted.find(r=>r.slug==='polymarket-international')};
  }
  const sorted=s.protocols.filter(dated).sort((a,b)=>a.slug.localeCompare(b.slug));
  const weave:[number,number][]=[], buckets:[number,number][]=[];
  for(const parity of [0,1]){
    const stats=prevalence({...s,protocols:sorted.filter((_,i)=>i%2===parity)}), f=fitSurvivor(stats.points,fit.L);
    for(const p of sorted.filter((_,i)=>i%2!==parity)){
      const t=ageDays(s.as_of,p.listed_at)!, y=+hasToken(p);
      weave.push([cdf(t,f.L,f.tau,f.k),y]); buckets.push([stats.points[bucketIndex(t)].rate,y]);
    }
  }
  return {
    bakeoff:[0,.125,.25,.375,.5,.75,1].map(x=>trial(x,5)),
    smallN:[-1,0,3,5,10].map(x=>trial(.25,x)),
    survivorLoo:presenceStats(folds.map(({p,t,stats,fit,y})=>[oddsFor(p,t,stats,fit).odds_survivor,y])),
    split:{weibull:presenceStats(weave),bucket:presenceStats(buckets)},
    survivorProbes:[.8,.85,.9].map(L=>{
      const f=fitSurvivor(raw.points,L);
      let total=0,farm=0;
      for(const r of rows){
        const p=bySlug.get(r.slug)!, launch=value(r.tvl_usd,curve), odds=oddsFor(p,r.age_days,raw,f).odds_survivor;
        total+=Math.max(1,Math.round(launch*odds));
        farm+=+(economy(p,r.age_days,launch,odds).verdict==='FARM');
      }
      return {...f,ages:[56,407,1845].map(t=>survivor(t,L,f.tau,f.k)),total,farm};
    })
  };
}
export function farmSensitivityGrid(rows:BoardRow[],curve:Curve){
  const trials=[
    {label:'Headline base'},{label:'Hold 30/45d',holds:[30,45]},{label:'Hold 90/120d',holds:[90,120]},
    ...[0,.02,.06].map(x=>({label:'Forgone '+x*100+'%',options:{forgone:x}})),
    ...[0,5].map(x=>({label:'Allowance $'+x,options:{allowance:x}})),
    {label:'No weekly transaction',options:{weekly:false}},
    ...[.5,2].map(x=>({label:'Gas ×'+x,options:{gasMult:x}})),
    ...[.07,.14].map(x=>({label:'Share '+Math.round(x*100)+'%',share:x})),
    ...[1,4].map(x=>({label:'Time share: age/'+x,options:{ageDivisor:x}})),
    {label:'Legacy FARM threshold: break-even ≤10%',options:{legacy:true}}
  ];
  return trials.map(({label,holds,options,share})=>({label,counts:[1000,10000].map(ticket=>rows.filter(r=>
    economy(r,r.age_days,value(r.tvl_usd,curve),r.odds,ticket,share,{...options,hold:holds?.[r.age_days!==null&&r.age_days<180?0:1]}).verdict==='FARM').length)}));
}
function bootstrap(rows:BoardRow[],comps:Protocol[]){
  let seed=20261120;
  const random=()=>{
    let t=seed=(seed+0x6d2b79f5)|0;
    t=Math.imul(t^(t>>>15),t|1);
    t^=t+Math.imul(t^(t>>>7),t|61);
    return ((t^(t>>>14))>>>0)/4294967296;
  };
  const ranks=new Map(rows.map(r=>[r.slug,[] as number[]])), winners=new Map<string,number>();
  for(let i=0;i<200;i++){
    const curve=huberCurve(comps.map(()=>comps[Math.floor(random()*comps.length)]));
    const sorted=rows.map(r=>({slug:r.slug,implied:Math.max(1,Math.round(value(r.tvl_usd,curve)*r.odds))}))
      .sort((a,b)=>b.implied-a.implied||a.slug.localeCompare(b.slug));
    sorted.forEach(({slug},j)=>ranks.get(slug)!.push(j+1));
    const key=sorted[0].slug; winners.set(key,(winners.get(key)??0)+1);
  }
  const ranges=new Map([...ranks].map(([slug,rs])=>[slug,[.1,.9].map(q=>Math.round(quantile(rs,q)))]));
  const top=rows.slice(0,20);
  return {ranges,top20:top.filter(r=>ranks.get(r.slug)!.filter(x=>x<=20).length>=160).length,
    width:median(top.map(r=>{const [lo,hi]=ranges.get(r.slug)!;return hi-lo;})),winners:[...winners].sort((a,b)=>b[1]-a[1])};
}
export function validate(s:Snapshot,rows:BoardRow[],curve:Curve,raw:ReturnType<typeof prevalence>,fit:ReturnType<typeof fitSurvivor>){
  const comps=compSet(s), errors=folds(comps,curvePrice);
  const bands=[median(errors),quantile(errors,.8)], boot=bootstrap(rows,comps);
  const flatPrice=(train:Protocol[],p:Protocol)=>flat(train)*p.tvl_usd;
  return {bands,ranges:boot.ranges,summary:{
    comps:comps.length,loo:loss(errors),flatLoo:loss(folds(comps,flatPrice)),walk:forward(comps,curvePrice),flatWalk:forward(comps,flatPrice),
    bandHold:bands.map(b=>errors.filter(x=>x<=b).length/errors.length),top20:boot.top20,medianWidth:boot.width,rank1:boot.winners,
    ablation:ablation(s,comps),compProbes:compProbes(comps),...oddsChecks(s,rows,curve,raw,fit),farmSensitivity:farmSensitivityGrid(rows,curve)
  }};
}
