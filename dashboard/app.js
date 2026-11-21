const DATA=window.RADAR;
const app=document.querySelector('#app');
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
function integrity(){
  const c=DATA.reconciliation;
  const n=list=>DATA.rows.filter(r=>r.list===list).length;
  return `<p class="integrity">${c.ledger_total} accounted for | Ranked: ${c.ranked} (${n('watchlist')} watchlist · ${n('found')} found · ${n('early')} early) | Ledger: ${c.ledger_total} protocols in ${c.ledger_groups} groups | Reconciliation: <strong class="${c.status.toLowerCase()}">${c.status}${c.status==='FAIL'?' · discrepancy '+c.discrepancy:''}</strong> | Snapshot: ${esc(DATA.snapshot_id)}</p>`;
}
const tickets=[500,1000,5000,10000], shares=[.035,.07,.1,.14];
const money=x=>'$'+Math.round(x).toLocaleString('en-US');
const cash=x=> (x<0?'−':'')+'$'+Math.abs(x).toFixed(2);
const signed=x=>(x>0?'+':'')+cash(x);
const pct=x=> Number.isFinite(x)?(100*x).toFixed(1)+'%':'—';
const scenario={base:'Conservative age-bucket proxy',assumed:'Assumed eventual-launch scenario'};
const badge=v=>`<span class="badge ${v.toLowerCase()}">${v}</span>`;
const net=x=>`<strong class="${x>0?'positive':'negative'}">${signed(x)}</strong>`;
const categories=[...new Set((DATA?.rows??[]).map(r=>r.category??'Unknown'))].sort();
function state(){
  const h=new URLSearchParams(location.hash.slice(1));
  const read=(key,choices,fallback)=>choices.includes(h.get(key))?h.get(key):fallback;
  return {view:read('view',['farm','value'],'farm'),sc:read('sc',['base','assumed'],'base'),
    tab:read('tab',['board','method','ledger','anchors'],'board'),ticket:tickets.includes(+h.get('ticket'))?+h.get('ticket'):1000,
    share:shares.includes(+h.get('share'))?+h.get('share'):.1,detail:h.get('detail')??'',q:h.get('q')??'',
    cat:read('cat',categories,''),list:read('list',['watchlist','found','early'],''),
    verdict:read('verdict',['FARM','THIN','SKIP'],''),page:Math.max(1,Math.floor(+h.get('page'))||1)};
}
let S=state();
function change(delta){
  S={...S,...delta};
  const h=new URLSearchParams(Object.entries(S).filter(([,v])=>v!==''));
  history.replaceState(null,'','#'+h);
  render();
}
function econ(r,sc=S.sc,ticket=S.ticket,share=S.share){
  const f=r.farm, odds=sc==='assumed'?r.odds_survivor:r.odds;
  const launch=DATA.curve.a*r.tvl_usd**DATA.curve.b;
  const slice=share*launch*ticket/r.tvl_usd*f.timeShare;
  const forgone=ticket*.04*f.holdDays/365, fees=f.feesUsd;
  const expected=slice*odds, result=expected-fees-forgone, be=(fees+forgone)/slice;
  return {odds,launch,value:Math.max(1,Math.round(launch*odds)),slice,expected,forgone,fees,net:result,be,
    ticket,reserve:f.reserveUsd,verdict:result>0?'FARM':be<=.33?'THIN':'SKIP'};
}
function order(a,b,view){
  if(view==='value') return b.e.value-a.e.value || a.r.rank-b.r.rank;
  return Number(b.e.verdict==='FARM')-Number(a.e.verdict==='FARM') || b.e.net-a.e.net || a.r.rank-b.r.rank;
}
function button(key,v,label,active=S[key]===v){
  return `<button type="button" data-key="${key}" data-value="${esc(v)}" aria-pressed="${active}">${esc(label)}</button>`;
}
function options(key, label, entries){
  return `<label>${label}<select data-key="${key}">${entries.map(([v,t])=>`<option value="${esc(v)}"${String(S[key])===String(v)?' selected':''}>${esc(t)}</option>`).join('')}</select></label>`;
}
function table(headers,rows,id=''){
  return `<table${id?' id="'+id+'"':''}><thead><tr>${headers.map(h=>'<th scope="col">'+h+'</th>').join('')}</tr></thead><tbody>${rows.map(cells=>'<tr>'+cells.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')}</tbody></table>`;
}
const compact=n=>'$'+(n/1e6).toFixed(1)+'M';
function rowCells({r,e}){
  const f=r.farm;
  return [`<span title="Base valuation rank">${r.rank}</span>`,button('detail',r.slug,r.name),esc(r.chains[0]??'Unknown'),
    r.list,money(e.ticket),cash(e.fees),cash(e.reserve),net(e.net),pct(e.be),badge(e.verdict),'Unknown',
    Math.round(f.hours*60)+'m',f.holdDays+'d',compact(r.tvl_usd),r.change_7d===null?'—':pct(r.change_7d/100),
    r.age_days===null?'—':r.age_days+'d',pct(e.odds),compact(e.value)];
}
function detail(r){
  const e=econ(r), f=r.farm;
  return `<aside id="detail" class="plan"><div class="plan-title"><h2>${esc(r.name)}</h2>${button('detail','','Close',false)}</div>
    <p>${esc(r.chains.join(' · ')||'Chain unknown')} · ${esc(r.category??'Category unknown')} · ${r.list} · ${badge(e.verdict)}</p>
    <p>Eligibility unknown · ${e.ticket.toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0})} principal · ${Math.round(f.hours*60)} min active · ${f.holdDays} days modeled hold</p>
    <div class="netbox"><span>Conservative age-bucket proxy · net</span>${net(econ(r,'base').net)}
    <span>Assumed eventual-launch scenario · net</span>${net(econ(r,'assumed').net)}
    <span>Expected slice</span><b>${cash(e.expected)}</b><span>Charged fees</span><b>${cash(e.fees)}</b>
    <span>Forgone yield</span><b>${cash(e.forgone)}</b><span>Wallet reserve (not deducted)</span><b>${cash(e.reserve)}</b>
    <span>Break-even odds</span><b>${pct(e.be)}</b></div>
    <p class="funding">Funding: ${money(e.ticket)} principal + ${cash(e.fees)} charged fees + ${cash(e.reserve)} wallet buffer. The buffer is not deducted from net.</p>
    <ol>${r.farm_steps.map((step,i)=>'<li>'+esc(i===0?step.replace(money(f.ticket)+'.00',money(e.ticket)+'.00'):step)+'</li>').join('')}</ol>
    <h3>Valuation evidence</h3><p>${money(e.launch)} if a token launches × ${pct(e.odds)} = ${money(e.value)} implied. Base rank ${r.rank}, bootstrap range ${r.rank_range_lo}–${r.rank_range_hi}.</p>
    <p>Headline curve error bands: ${compact(r.band_p25_usd)}–${compact(r.band_p75_usd)} (central 50%); ${compact(r.band_p10_usd)}–${compact(r.band_p90_usd)} (central 80%). Closest traded anchors by log TVL: ${r.nearest_comps.map(c=>esc(c.name)+' ('+compact(c.mcap_usd)+' cap)').join(' · ')}.</p>
  </aside>`;
}
function board(){
  const all=DATA.rows.map(r=>({r,e:econ(r)}));
  const counts=Object.fromEntries(['FARM','THIN','SKIP'].map(v=>[v,all.filter(x=>x.e.verdict===v).length]));
  const totals=all.reduce((n,x)=>n+x.e.value,0);
  const audit=all.filter(({r})=>econ(r,'base').value!==r.implied_value_usd).length;
  const q=S.q.trim().toLowerCase();
  let rows=all.filter(({r,e})=>(!q||[r.name,r.slug,...r.chains].join(' ').toLowerCase().includes(q)) &&
    (!S.cat||S.cat===(r.category??'Unknown'))&&(!S.list||S.list===r.list)&&(!S.verdict||S.verdict===e.verdict));
  if(!counts.FARM&&S.view==='farm'&&S.verdict==='FARM') rows=all.filter(({r})=>(!q||[r.name,r.slug,...r.chains].join(' ').toLowerCase().includes(q))&&(!S.cat||S.cat===(r.category??'Unknown'))&&(!S.list||S.list===r.list));
  rows.sort((a,b)=>order(a,b,S.view));
  const selected=DATA.rows.find(r=>r.slug===S.detail), size=20, pages=Math.max(1,Math.ceil(rows.length/size)), page=Math.min(S.page,pages);
  return `<div class="stats"><div><small>Expected net · ${money(S.ticket)} · ${pct(S.share)} share</small><b>${counts.FARM} FARM <span> / ${counts.THIN} THIN / ${counts.SKIP} SKIP</span></b></div>
    <div><small>Total implied protocol value</small><b>${money(totals)}</b></div><div><small>Active odds basis</small><b>${esc(scenario[S.sc])}</b></div></div>
    <p class="methodline">Huber TVL curve · 7-day TVL growth shown for context · Listing age enters odds and farming assumptions · Headline audit: ${DATA.rows.length-audit}/${DATA.rows.length} rows match</p>
    <div class="controls">${options('ticket','Ticket',tickets.map(t=>[t,money(t)]))}
    ${options('share','Airdrop share',shares.map(s=>[s,pct(s)]))}${options('sc','Odds basis',Object.entries(scenario))}
    <label>Search<input data-key="q" type="search" value="${esc(S.q)}" placeholder="Protocol or chain"></label>
    ${options('cat','Category',[['','All'],...categories.map(x=>[x,x])])}
    ${options('list','Source',[['','All'],...['watchlist','found','early'].map(x=>[x,x])])}
    ${options('verdict','Verdict',[['','All'],...Object.keys(counts).map(x=>[x,x])])}</div>
    ${S.view==='farm'&&!counts.FARM?'<p class="notice">No FARM plans under current assumptions. Strongest remaining decisions follow.</p>':''}
    <div class="board-layout${selected?' split':''}"><section class="board-panel">
      <div class="panel-head"><h2>${S.view==='farm'?'Farm decisions':'Valuation'}</h2><small>${rows.length} of ${DATA.rows.length} protocols</small></div>
      <div class="table-scroll">${table(['Base<br>rank','Protocol','Chain','Source','Ticket','Charged<br>fees','Wallet<br>reserve','Expected<br>net','Break-even<br>odds','Verdict','Eligibility','Active','Hold','TVL','7-day','Age','Odds','Implied<br>value'],rows.slice((page-1)*size,page*size).map(rowCells),'board')}</div>
      ${rows.length?'':'<p class="notice">No protocols match these filters.</p>'}<div class="pagination">${button('page',Math.max(1,page-1),'Previous',false)} <small>Page ${page} of ${pages}</small> ${button('page',Math.min(page+1,pages),'Next',false)}</div>
    </section>${selected?detail(selected):''}</div>`;
}
function render(){
  const active=k=>S.tab==='board'&&S.view===k;
  app.innerHTML=`<header><div><p class="eyebrow">DEFI INTELLIGENCE / ${esc(DATA.model_version)}</p><h1>Token Radar</h1></div>
  <p class="provenance">${esc(DATA.source)} / ${esc(DATA.as_of)}<br><small>${DATA.universe_size} protocols · Watchlist floor ${compact(DATA.floor_usd)}</small></p></header>${integrity()}
  <nav aria-label="Dashboard views">${button('view','farm','Farm decisions',active('farm'))}${button('view','value','Valuation',active('value'))}
  ${button('tab','anchors','Traded anchors')}${button('tab','method','Method')}${button('tab','ledger','Ledger')}</nav>${S.tab==='board'?board():evidence()}`;
}
function evidence(){
  if(S.tab==='ledger'){
    const q=S.q.trim().toLowerCase();
    return `<h2>Coverage ledger · ${DATA.reconciliation.ledger_total} protocols</h2><label>Search dispositions <input type="search" data-key="q" value="${esc(S.q)}"></label>
    <p class="methodline">Each snapshot slug appears once. ${DATA.reconciliation.exclusions_total} protocols are outside the ranking.</p>
    ${DATA.ledger.map(g=>{
      const members=g.members.filter(m=>[m.slug,m.name].join(' ').toLowerCase().includes(q));
      return members.length?`<details${q?' open':''}><summary>${esc(g.label)} · ${members.length}${q?' matches':''}</summary><p>${members.map(m=>esc(m.name)+' <small>('+esc(m.slug)+')</small>').join(' · ')}</p></details>`:'';
    }).join('')}`;
  }
  if(S.tab==='anchors') return '<h2>Traded token anchors</h2><p>Positive market cap on record. The curve uses standalone tokens with cap at least $1M and positive TVL.</p>'+
    table(['Protocol','Category','TVL','Market cap','Fit comp'],DATA.anchors.map(r=>[esc(r.name),esc(r.category),money(r.tvl_usd),money(r.mcap_usd),r.fit_comp?'Yes':'—']));
  return method();
}
const fixed=(n,d=2)=>Number.isFinite(n)?n.toFixed(d):'—';
const mult=n=>Number.isFinite(n)?'×'+fixed(n):'—';
const walkKey=w=>typeof w==='number'?Math.round(w*100)+'/'+Math.round((1-w)*100):w;
function method(){
  const v=DATA.validation, c=DATA.curve, f=DATA.fit;
  const box=(title,heads,rows)=>`<section class="method-card"><h3>${title}</h3><div class="table-scroll">${table(heads,rows)}</div></section>`;
  const windowCols=v.walk.map(x=>walkKey(x.window));
  const missCols=['Model','LOO median','Within 3×',...windowCols];
  return `<article class="method"><h2>Method &amp; tests</h2>
  <p><strong>Headline implied value (USD)</strong> = max(1, round(launch market cap × conservative age-bucket proxy)). Launch market cap in USD = ${fixed(c.a)} × (TVL in USD)<sup>${fixed(c.b,4)}</sup>. The Huber regression fits log market cap on log TVL for ${v.comps} standalone comps with positive TVL, cap ≥ $1M, and no shared symbol or CoinGecko ID. Log R²: ${fixed(c.r2,3)} (OLS ${fixed(c.ols,3)}). This prices circulating market cap, not fully diluted value or individual proceeds.</p>
  <p>Base odds = clamp(age-bucket token prevalence × (shrunk category prevalence / overall prevalence)<sup>0.25</sup>, 0.05, 0.95). A token is on record if market cap, symbol, or CoinGecko ID is present. Buckets in days: &lt;180, 180–364, 365–729, 730–1459, ≥1460: ${DATA.buckets.map(x=>pct(x)).join(' / ')}. No age uses overall prevalence (${pct(DATA.overall)}). Category shrinkage adds five observations at the overall rate; unknown category uses overall prevalence. Age means days since the snapshot listing date, a proxy for time without a recorded token. The recorded 7-day TVL change is displayed and tested in ablation; it does not enter the value formula.</p>
  <p><strong>Assumed eventual-launch scenario:</strong> replace the bucket rate with (L − F(t)) / (1 − F(t)), where F(t) = L × [1 − exp(−(t/τ)<sup>k</sup>)] and t is listing age in days; keep the same category factor and clamp. At fixed L = ${fixed(f.L)}, τ = ${fixed(f.tau,1)} days and k = ${fixed(f.k,3)} minimize weighted squared deviations from the five token-presence points at median bucket age. No age retains the bucket fallback. Neither eventual launch share nor eligibility is identified by one snapshot.</p>
  ${box('Assumed eventual-launch scenario · sensitivity',['Assumed L','τ days','k','Weighted SSE','56d','407d','1845d','Implied total','FARM @ $1k / 10%'],v.survivorProbes.map(p=>[pct(p.L),fixed(p.tau,1),fixed(p.k,3),fixed(p.sse),...p.ages.map(pct),money(p.total),p.farm]))}
  <p>Sensitivity ages show the survivor rate before category adjustment. Split-half Brier (token-presence test): Weibull CDF ${fixed(v.split.weibull.brier,4)}, bucket ${fixed(v.split.bucket.brier,4)}. Sort dated slugs, train on odd positions and test on even positions, then reverse. Brier is mean squared error against the binary token-on-record flag; lower is better. These are cross-sectional tests and provide no future-launch validation.</p>
  <p><strong>Farm math (USD):</strong> conditional slice = airdrop share × launch market cap × (ticket / TVL) × hold / (age/2 + hold). Hold is 60 days below age 180, otherwise 90; missing age uses 365 for time share. Expected net = conditional slice × active odds − charged fees − forgone yield. Fees = (5 + floor(hold / 7)) × first-chain gas + $1.50 allowance. Forgone yield = ticket × 4% × hold / 365. The $10 wallet buffer is separate and never deducted. Active minutes = 50 + 10 × floor(hold / 7). Fees and activity are estimates. FARM if net &gt; 0, otherwise THIN if break-even odds (charged fees plus forgone yield / conditional slice, with the costs summed first) ≤ 33%, otherwise SKIP. A high protocol value can still leave an individual ticket with a tiny slice.</p>
  <p><strong>Holdouts:</strong> leave-one-out (LOO) fits all comps except the one priced. Miss = max(prediction / observed cap, observed cap / prediction); median over held-out comps. Walk-forward trains on older dated comps by listing date, then prices the newer set at snapshot marks. It is a listing-cohort test, without historical marks. Band factors ${v.bands.map(mult).join(' / ')} use the 50th and 80th percentiles of LOO misses; hold rates (${v.bandHold.map(pct).join(' / ')}) are the observed shares inside those symmetric multiplicative bands. The factors show curve error; odds uncertainty is separate.</p>
  <p><strong>Bootstrap:</strong> 200 resamples of the comps with replacement refit the curve at fixed headline odds. Each rank range is the 10th–90th percentile. ${v.top20}/20 leaders stay top 20 in at least 80% of refits; median top-20 range width ${v.medianWidth} ranks. First-place counts: ${v.rank1.map(([slug,n])=>esc(DATA.rows.find(r=>r.slug===slug)?.name??slug)+' '+n+'/200').join(' · ')}.</p>
  ${box('Curve ablation · held-out multiplicative misses',missCols,v.ablation.map(x=>[esc(x.label)+' · '+x.decision,mult(x.loo.miss),pct(x.loo.within3),...x.walk.map(w=>mult(w.miss))]))}
  ${box('Comparable-set probes · same test cohorts',['Fit filter','Comps',...missCols.slice(1)],v.compProbes.map(x=>[esc(x.label),x.train,mult(x.loo.miss),pct(x.loo.within3),...x.walk.map(w=>mult(w.miss))]))}
  ${box('Token-presence LOO · odds exponent',['Exponent','Accuracy at 50%','Brier','Board total','Sentora rank'],v.bakeoff.map(x=>[x.exponent,pct(x.accuracy),fixed(x.brier,4),money(x.total),x.sentora]))}
  <p>Each dated held-out protocol is scored after rebuilding rates from the remaining snapshot. Survivor scenario odds applied to the same token-presence target: ${pct(v.survivorLoo.accuracy)} accuracy and ${fixed(v.survivorLoo.brier,4)} Brier. Scenario odds answer a different conditional question; this comparison cannot calibrate them.</p>
  ${box('Small-category rules · odds at exponent 0.25',['Rule','LOO accuracy','LOO Brier','Polymarket odds','Total implied'],v.smallN.map(x=>[x.rule===-1?'Fallback to overall if n &lt; 5':x.rule===0?'Raw':x.rule===5?'Shrink K=5 (base)':'Shrink K='+x.rule,pct(x.accuracy),fixed(x.brier,4),pct(x.polymarket?.odds),money(x.total)]))}
  ${box('Farm sensitivity · headline odds, one input changed',['Assumption','FARM @ $1k','FARM @ $10k'],v.farmSensitivity.map(x=>[esc(x.label),...x.counts]))}
  ${box('Base FARM counts · ticket and share combinations',['Ticket',...shares.map(pct)],tickets.map(t=>[money(t),...shares.map(s=>DATA.rows.filter(r=>econ(r,'base',t,s).verdict==='FARM').length)]))}
  </article>`;
}
app.addEventListener('click',event=>{
  const b=event.target.closest('button[data-key]');
  if(!b) return;
  const {key,value}=b.dataset;
  if(key==='view') change({view:value,tab:'board',page:1});
  else if(key==='detail') change({detail:S.detail===value?'':value});
  else if(key==='page') change({page:+value});
  else change({[key]:value,page:1});
});
app.addEventListener('change',event=>{
  const {key}=event.target.dataset;
  if(event.target.tagName==='SELECT') change({[key]:['ticket','share'].includes(key)?+event.target.value:event.target.value,page:1});
});
app.addEventListener('input',event=>{
  if(event.target.dataset.key!=='q') return;
  const end=event.target.selectionEnd;
  change({q:event.target.value,page:1});
  const input=app.querySelector('input[data-key=q]');
  input.focus();
  if(end!==null) input.setSelectionRange(end,end);
});
window.addEventListener('hashchange',()=>{S=state();render();});
if(DATA) render(); else app.textContent='Dashboard data is missing. Build the snapshot output first.';
