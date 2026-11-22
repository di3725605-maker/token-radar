const d = window.RADAR;
const byId = id => document.getElementById(id);
const esc = value => String(value ?? '—').replace(/[&<>"']/g, ch =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch]);
const usd = (n,digits=2) => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',
  minimumFractionDigits:digits,maximumFractionDigits:digits}).format(n);
const compact = n => n == null ? '—' : usd(n>=1e9 ? n/1e9 : n/1e6,2) + (n>=1e9?'B':'M');
const pct = n => Number.isFinite(n) ? (100*n).toFixed(1)+'%' : '—';
const multiple = n => n == null ? '—' : '×'+n.toFixed(2);
const verdict = text => '<span class="tag '+text.toLowerCase()+'">'+text+'</span>';
const views = {farm:'Farm decisions',valuation:'Valuation ranking',anchors:'Traded-token anchors',method:'Method',coverage:'Coverage'};
const query = new URLSearchParams(location.search);
let view = Object.hasOwn(views,query.get('view')) ? query.get('view') : 'farm';
let ticket = 1000, filter = query.get('filter') ?? '', selected = query.get('pick') ?? '';
let limit = 12;
let group = '';

function cells(values, numeric=[]) {
  return values.map((c,i)=>'<td'+(numeric.includes(i)?' class="num"':'')+'>'+c+'</td>').join('');
}
function table(headers,rows,id='') {
  return '<table '+(id?'id="'+id+'"':'')+'><thead><tr>'+headers.map(h=>'<th scope="col">'+h+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table>';
}
const line = (values,numeric) => '<tr>'+cells(values,numeric)+'</tr>';
const includes = (p,q) => [p.name,p.slug,p.category,...(p.chains??[])].some(v=>String(v).toLowerCase().includes(q));
const plan = p => d.plans[p.slug] ?? {asset:'Unverified',action:'Identify the official product and its supported deposit asset. Leave the ticket undeployed while access and terms are unverified.',
  exit:'Verify redemption and withdrawal limits before funding.'};

function detail(p) {
  if (!p) return '<aside class="panel pad"><p>Select a protocol to inspect its assumptions.</p></aside>';
  const f = p.farms[ticket], instructions = plan(p);
  const halfNet = f.expectedSlice/2-f.fees-f.forgone;
  const bands = d.validation.curve.bands, range = d.validation.stability.ranges[p.slug];
  const items = [['Ticket',usd(ticket,0)],['Charged fees',usd(f.fees)],['Wallet buffer',usd(f.buffer)],
    ['If launch occurs',usd(f.slice)],['Forgone yield',usd(f.forgone)],['Break-even odds',pct(f.breakEven)],
    ['Bucket proxy net',usd(f.net)],['Lower share net · 5%',usd(halfNet)],['Net / active hour',usd(f.netPerHour)]];
  return '<aside class="panel detail"><div class="pad plan-head"><div class="panel-head"><div class="kicker">Selected decision · value rank #'+p.rank+'</div>'+verdict(f.verdict)+'</div>'+
    '<h2>'+esc(p.name)+'</h2><p>'+esc(f.chain)+' · '+esc(instructions.asset)+' · '+f.hold+' days held · '+f.hours.toFixed(2)+' h active · 10% base share</p>'+
    '<div class="costs">'+items.map(([label,n])=>'<div><span>'+label+'</span><b>'+n+'</b></div>').join('')+'</div></div>'+
    '<div class="pad"><h3>Execution checks</h3><ol class="steps"><li>'+esc(instructions.action)+'</li>'+
    '<li>Budget '+usd(f.fees)+' in modeled charges and keep '+usd(f.buffer)+' in the wallet as reserve. Confirm eligibility, supported network and live quotes before funding.</li>'+
    '<li>Check weekly. Claim only after an official announcement and confirmed eligibility. '+esc(instructions.exit)+'</li></ol>'+
    '<h3>Farm steps · '+usd(ticket,0)+' ticket</h3><ol class="steps">'+(p.farm_steps??[]).map(step=>'<li>'+esc(step)+'</li>').join('')+'</ol>'+
    '<p>DefiLlama snapshot evidence · '+esc(d.snapshot.asOf)+' · Eligibility unverified</p>'+
    '<hr><p>TVL '+compact(p.tvl_usd)+' · Launch value '+compact(p.value)+' · Proxy '+pct(p.odds)+' ('+pct(p.bucketRate)+' age bucket, '+pct(p.categoryRate)+' shrunk category)</p>'+
    '<p>Implied '+compact(p.implied)+(bands.middle80?' · 80% valuation error band '+compact(p.implied/bands.middle80)+'–'+compact(p.implied*bands.middle80):'')+(range?' · Refit ranks '+range.p10+'–'+range.p90:'')+'</p></div></aside>';
}

function listing() {
  const farm = view === 'farm', q = filter.trim().toLowerCase();
  const rows = d.rows.filter(p => includes(p,q));
  if (farm) {
    rows.sort((a,b)=>{
      const x=a.farms[ticket],y=b.farms[ticket];
      return Number(x.verdict!=='FARM')-Number(y.verdict!=='FARM') || y.net-x.net || a.rank-b.rank;
    });
  }
  const pick = rows.find(p=>p.slug===selected) ?? rows[0];
  const noFarm = farm && !d.rows.some(p=>p.farms[ticket].verdict==='FARM');
  const dataRows = rows.slice(0,limit).map(p=>{
    const f=p.farms[ticket];
    const name = '<button type="button" data-pick="'+esc(p.slug)+'">'+esc(p.name)+'</button><small>#'+p.rank+' · '+esc(f.chain)+' · '+esc(p.cohort)+'</small>';
    const columns = farm ? [name,pct(p.odds),pct(f.breakEven),usd(f.fees),usd(f.net),verdict(f.verdict)]
      : [name,compact(p.tvl_usd),p.change_7d==null?'—':p.change_7d.toFixed(1)+'%',p.age==null?'—':p.age+' d',compact(p.implied),verdict(f.verdict)];
    return '<tr data-slug="'+esc(p.slug)+'" class="'+(p===pick?'selected':'')+'">'+cells(columns,[1,2,3,4])+'</tr>';
  });
  return '<div class="workspace"><section class="panel"><div class="pad"><div class="panel-head"><div><h2>'+views[view]+'</h2><p>'+
    (farm?'Expected net within priority groups':'Implied value descending · bucket proxy')+'</p></div><div class="controls"><input id="search" aria-label="Filter by protocol, chain or category" placeholder="Filter protocols" value="'+esc(filter)+'"></div></div>'+
    (noFarm?'<div class="empty"><strong>No FARM plans under current assumptions</strong><p>Strongest remaining decisions shown below. FARM requires break-even ≤ 25% with positive expected net; rows within ±10% of a cutoff are held at THIN.</p></div>':'')+'</div>'+
    table(farm?['Protocol','Proxy','Break-even','Fees','Exp. net','Verdict']:['Protocol','TVL','7d','Age','Implied','Verdict'],dataRows,'board')+
    '<div class="pad panel-head"><p>'+Math.min(rows.length,limit)+' of '+rows.length+' matching protocols</p>'+(limit<rows.length?'<button id="more">Show more</button>':'')+'</div></section>'+detail(pick)+'</div>';
}

function method() {
  const v=d.validation,c=v.curve,b=v.baseline,p=d.params;
  const ablation = [['Flat median cap / TVL',multiple(b.loo.median),multiple(b.wf50.median),'Baseline'],
    ['Huber TVL curve',multiple(c.loo.median),multiple(c.wf50.median),'Used'],...d.ablation];
  return '<div class="notes"><article class="panel"><h2>Value curve and validation</h2><p>Value if launch occurs (USD) = '+d.curve.A+' × TVL (USD)^'+d.curve.b+'. Implied value = launch value × bucket odds. Huber IRLS on log USD, k=1.345 with median absolute deviation centered on median residual. Growth, age and category premiums are omitted from the value fit.</p>'+
    '<p>Training pool: '+d.curve.n+' traded, standalone tokens with market cap ≥ $1M and TVL > $0. Shared symbols or CoinGecko IDs are excluded. LOO refits on all except one and predicts that held-out cap. Walk-forward sorts dated comps by listing date and fits on the older '+c.wf50.train+' to price the newer '+c.wf50.test+'. Date orders a cross section of current observations.</p>'+
    '<p>Median miss = median max(predicted / observed, observed / predicted). LOO miss '+multiple(c.loo.median)+' and walk-forward 50/50 '+multiple(c.wf50.median)+'. LOO ≤3×: '+pct(c.loo.within3)+'. Symmetric 50% / 80% error multipliers: '+multiple(c.bands.middle50)+' / '+multiple(c.bands.middle80)+'. '+v.stability.stable20+' of the first 20 stay in the top 20 in ≥80% of '+v.stability.refits+' bootstrap refits, with odds fixed.</p>'+
    '<h3>Ablation</h3><p>Flat and Huber rows recomputed. Other variants are sealed Round 4 study results.</p>'+table(['Variant','LOO median','WF 50/50','Use'],ablation.map(r=>line(r)))+'</article>'+
    '<article class="panel"><h2>Token presence proxy</h2><p>Odds = clamp(bucketRate(age) × (shrunkCategoryRate / overall)^0.25, 0.05, 0.95). Shrunk rate = (category token count + 5 × overall) / (category count + 5). Token record = cap field present, symbol, or CoinGecko ID. Missing listing dates use overall ('+pct(p.overall)+'). The cross section measures recorded tokens and cannot validate a future launch.</p>'+
    table(['Age bucket','Rows','Median age','Recorded token rate'],p.buckets.map((b,i)=>line([['<6 months','6–12 months','1–2 years','2–4 years','>4 years'][i].replace('<','&lt;'),b.n,b.age==null?'—':b.age+' days',pct(b.rate)])))+
    '<p>Split-half bucket proxy Brier: '+(v.splitHalf.brier?.toFixed(4)??'—')+' (mean squared error for recorded token, '+v.splitHalf.train+' train / '+v.splitHalf.test+' test dated rows).</p></article>'+
    '<article class="panel"><h2>Survivor probe · unidentified assumption</h2><p>Fit F(t) = L[1 − exp(−(t/τ)^k)] to bucket rates at median ages, weighted by bucket counts. The hypothetical remaining share is (L − F)/(1 − F), adjusted by the same category factor and clamp. One snapshot cannot identify L. These are investigation results only.</p>'+
    table(['Fixed L','τ (days)','Shape k','Weighted SSE','Hypothetical total','Hypothetical first','Polymarket rank','Net > $0'],v.survivor.map(s=>line([pct(s.L),s.tau.toFixed(0),s.k.toFixed(3),s.sse.toFixed(3),compact(s.total),esc(s.top),s.polymarketRank||'—',s.positiveNet])))+'</article>'+
    '<article class="panel"><h2>Farm cost conventions</h2><p>Hold 60 days at age &lt;180 days, otherwise 90 days. Unknown age = 365 days for economics. Weeks = floor(hold / 7). Time share = hold / (age/2 + hold). Slice if launch = share × launch value × ticket / TVL × time share. Base allocation share 10%, lower scenario 5%.</p>'+
    '<p>Charged fees = (5 + weeks) × estimated first-chain gas USD + $1.50 allowance. Five transactions budget fund, approval, deposit, conditional claim and exit. $10 wallet buffer stays outside net. Forgone yield = 4% annual × ticket × hold / 365. Net = bucket odds × slice − fees − forgone yield. Active hours = (50 + 10 × weeks) / 60. Net/hour = net / active hours.</p>'+
    '<p>Break-even odds = (charged fees + forgone yield) / slice. FARM ≤25% with positive expected net, THIN above 25% through 33%, SKIP above 33%. Implied valuation and expected farming net are distinct.</p>'+
    table(['Ticket','FARM','THIN','SKIP'],v.tickets.map(t=>line([usd(t.ticket,0),t.FARM,t.THIN,t.SKIP])))+'</article>'+
    '<article class="panel"><h2>Calibration anchors · round 8</h2><p>One score, two frozen cutoffs, one borderline band — the same rule for every row and every ticket. Score = break-even odds at the modeled ticket. FARM needs break-even ≤ 0.25 AND expected net above $0. THIN is break-even ≤ 0.33 or inside a band. SKIP is break-even above 0.33 outside the band. Any score within ±10% of a cutoff is held at THIN, so a small refit wobble can never flip a row directly between FARM and SKIP.</p>'+
    '<p>The rule is frozen since round 8. Rounds 5–7 each used a different ad-hoc rule and the FARM count swung 47 → 15 → 0 while model numbers barely moved. Freezing the boundary is the round-8 fix; the cutoffs live in CALIBRATION in lib/model.ts and the next round reuses them unchanged.</p></article></div>';
}

function anchors() {
  const matches = d.anchors.filter(p=>includes(p,filter.trim().toLowerCase()));
  return '<section class="panel"><div class="pad panel-head"><div><h2>Traded-token anchors</h2><p>Observed USD market caps · training inclusion marked</p></div><input id="search" aria-label="Filter anchors" value="'+esc(filter)+'" placeholder="Filter anchors"></div>'+
    table(['Protocol','Token','TVL','Observed cap','Curve cap','Fit sample'],matches.slice(0,limit).map(p=>line([esc(p.name),esc(p.symbol),compact(p.tvl_usd),compact(p.mcap_usd),compact(p.curveCap),p.training?'Included':'Excluded'],[2,3,4])))+
    '<div class="pad panel-head"><p>'+Math.min(limit,matches.length)+' of '+matches.length+' anchors</p>'+(matches.length>limit?'<button id="more">Show more</button>':'')+'</div></section>';
}

function coverage() {
  const matching = d.ledger.filter(g=>!group||g.name===group).flatMap(g=>g.members.map(p=>({...p,group:g.name})))
    .filter(p=>includes(p,filter.trim().toLowerCase()));
  return '<div class="notes"><article class="panel"><h2>Coverage ledger</h2><p>Every deduplicated slug has a single disposition. Traded tokens have positive cap; token on record covers other token signal. Pre-token watchlist takes priority over name/category filters. Remaining positive TVL ranks above or below the '+compact(d.snapshot.floor)+' floor.</p>'+
    '<p>'+d.ledger.map(g=>esc(g.name)+' <strong>'+g.count+'</strong>').join(' · ')+'</p>'+
    '<div class="controls"><select id="group" aria-label="Ledger group"><option value="">All groups</option>'+d.ledger.map(g=>'<option '+(group===g.name?'selected':'')+'>'+esc(g.name)+'</option>').join('')+'</select><input id="search" aria-label="Filter ledger" placeholder="Filter ledger" value="'+esc(filter)+'"></div>'+
    table(['Protocol','Category','Disposition'],matching.slice(0,limit).map(p=>line([esc(p.name),esc(p.category),esc(p.group)])))+
    '<div class="panel-head"><p>'+Math.min(limit,matching.length)+' of '+matching.length+' matching records</p>'+(matching.length>limit?'<button id="more">Show more</button>':'')+'</div></article></div>';
}

function render() {
  const i=d.integrity, counts={FARM:0,THIN:0,SKIP:0};
  d.rows.forEach(p=>counts[p.farms[ticket].verdict]++);
  byId('edition').textContent=d.modelVersion.toUpperCase();
  byId('headline').textContent=i.status==='PASS'?i.coverage+' accounted for':'Coverage mismatch';
  byId('source').textContent=d.snapshot.asOf+' · DefiLlama snapshot · Conservative bucket proxy';
  byId('integrity').innerHTML=['Coverage: '+i.coverage+' protocols accounted for',
    'Ranked: '+i.ranked+' ('+i.cohorts.watchlist+' watchlist · '+i.cohorts.found+' found · '+i.cohorts.early+' early)',
    'Ledger: '+i.ledgerTotal+' protocols in '+i.groups+' groups',
    'Reconciliation: <b class="'+(i.status==='PASS'?'good':'bad')+'">'+i.status+'</b>',
    'Snapshot: '+esc(d.snapshot.id),...i.issues.map(esc)].map(s=>'<span>'+s+'</span>').join('');
  const c=d.validation.curve;
  const tiles=[['FARM',counts.FARM,'Break-even ≤ 25% + positive net','good'],['THIN / SKIP',counts.THIN+' / '+counts.SKIP,'At '+usd(ticket,0)+' · 10% share','thin'],
    ['TOTAL IMPLIED',compact(d.total),'Valuations × token presence proxy',''],['FITTED TVL CURVE',multiple(c.loo.median)+' / '+multiple(c.wf50.median),'Median miss · LOO / walk-forward','']];
  byId('metrics').innerHTML=tiles.map(([label,val,desc,tone])=>'<div class="tile"><div class="kicker">'+label+'</div><b class="'+tone+'">'+val+'</b><p>'+desc+'</p></div>').join('');
  byId('tabs').innerHTML=Object.entries(views).map(([name,label])=>'<button data-view="'+name+'" aria-current="'+(view===name)+'">'+label+'</button>').join('');
  byId('content').innerHTML=view==='method'?method():view==='coverage'?coverage():view==='anchors'?anchors():listing();
}

if (d) {
  byId('ticket').innerHTML=[500,1000,5000,10000].map(t=>'<option value="'+t+'"'+(t===ticket?' selected':'')+'>'+usd(t,0)+'</option>').join('');
  byId('ticket').onchange=e=>{ticket=Number(e.target.value); selected='';render();};
  document.addEventListener('click', e=>{
    const tab=e.target.closest('[data-view]'), row=e.target.closest('[data-slug]');
    if (tab) {view=tab.dataset.view;filter='';limit=12;render();byId('tabs').querySelector('[aria-current=true]').focus();}
    if (row) {selected=row.dataset.slug;render();document.querySelector('.selected button')?.focus({preventScroll:true});}
    if (e.target.id==='more') {limit+=24;render();}
  });
  document.addEventListener('change', e=>{if(e.target.id==='group'){group=e.target.value;limit=12;render();}});
  document.addEventListener('input', e=>{
    if(e.target.id!=='search') return;
    const cursor=e.target.selectionStart;
    filter=e.target.value;limit=12;render();
    byId('search').focus();byId('search').setSelectionRange(cursor,cursor);
  });
  render();
} else byId('content').textContent='Snapshot data unavailable. Serve the complete output directory.';
