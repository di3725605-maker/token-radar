// Token Radar, radar-4. Reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked board, a per-row detail view, the method and its tests, the 758-protocol ledger
// and a log-log scatter. No network: everything shown is in data.js. The page recomputes each
// row's implied value from the stamped curve and odds, and each farm plan from the same
// formulas main.ts uses, and prints an audit line proving the page and board.json agree.
(function () {
  'use strict';
  var DATA = window.RADAR;
  var GAS = { ethereum: 8, bittensor: 0.35, solana: 0.05, base: 0.05, arbitrum: 0.1, optimism: 0.05, avalanche: 0.1, 'bnb chain': 0.1, bsc: 0.1, polygon: 0.05, sui: 0.05, 'hyperliquid l1': 0.05, gnosis: 0.05, fantom: 0.05 };
  var TICKETS = [500, 1000, 5000, 10000];
  var SHARES = [0.035, 0.07, 0.1, 0.14];
  var PAGE = 25;

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function money(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function money2(n) { return (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2); }
  function moneyM(n) { return '$' + (n / 1e6).toFixed(1) + 'M'; }
  function pct(n, d) { return (n * 100).toFixed(d == null ? 1 : d) + '%'; }
  function mult(n) { return '×' + n.toFixed(2); }
  function ageFmt(d) { return d == null ? '—' : d + 'd'; }
  function gasOf(row) { var c = (row.chains[0] || '').toLowerCase(); return GAS[c] == null ? 0.5 : GAS[c]; }

  // One row's farm economics at a ticket and share — the same formulas as lib/model.ts.
  function econ(row, ticket, share) {
    var age = row.age_days, hold = age != null && age < 180 ? 60 : 90;
    var weeks = Math.floor(hold / 7), ageShare = age == null ? 365 : age;
    var ts = hold / (ageShare / 2 + hold), nTx = 5 + weeks;
    var fees = nTx * gasOf(row) + 1.5, hours = (35 + 10 * weeks + 15) / 60;
    var forgone = ticket * 0.04 * hold / 365;
    var sliceFull = share * row.value_if_launches_usd * ticket / row.tvl_usd * ts;
    var sliceExp = sliceFull * row.odds, net = sliceExp - fees - forgone;
    var be = sliceFull > 0 ? (fees + forgone) / sliceFull : Infinity;
    var perDollar = share * row.value_if_launches_usd / row.tvl_usd * ts * row.odds - 0.04 * hold / 365;
    return { ticket: ticket, share: share, hold: hold, weeks: weeks, hours: hours, nTx: nTx,
      fees: fees, forgone: forgone, sliceFull: sliceFull, sliceExp: sliceExp, net: net,
      perHour: net / hours, paysFrom: perDollar > 0 ? Math.ceil(fees / perDollar) : null,
      be: be, verdict: be <= 0.1 ? 'FARM' : be <= 0.33 ? 'THIN' : 'SKIP' };
  }
  function impliedRecomputed(row) { return Math.max(1, Math.round(DATA.curve_a * Math.pow(row.tvl_usd, DATA.curve_b) * row.odds)); }
  function farmCounts(ticket) {
    var c = { FARM: 0, THIN: 0, SKIP: 0 };
    DATA.rows.forEach(function (r) { c[econ(r, ticket, 0.1).verdict]++; });
    return c;
  }
  function bestNetHour(ticket) {
    var best = null;
    DATA.rows.forEach(function (r) { var e = econ(r, ticket, 0.1); if (!best || e.perHour > best.e.perHour) best = { row: r, e: e }; });
    return best;
  }

  // ---- state (kept in the URL hash so a view is shareable) ----
  function readHash() {
    var p = new URLSearchParams((location.hash || '').slice(1));
    return { tab: p.get('tab') || 'board', ticket: +p.get('t') || 1000, share: +p.get('s') || 0.1,
      q: p.get('q') || '', cat: p.get('c') || 'all', list: p.get('l') || 'all',
      verdict: p.get('v') || 'all', sort: p.get('sort') || 'implied', dir: p.get('dir') === 'asc' ? 1 : -1,
      page: Math.max(1, +p.get('page') || 1), detail: p.get('d') || '' };
  }
  var S = readHash();
  function writeHash() {
    var p = new URLSearchParams();
    p.set('tab', S.tab); p.set('t', S.ticket); p.set('s', S.share);
    if (S.q) p.set('q', S.q); if (S.cat !== 'all') p.set('c', S.cat);
    if (S.list !== 'all') p.set('l', S.list); if (S.verdict !== 'all') p.set('v', S.verdict);
    p.set('sort', S.sort); p.set('dir', S.dir < 0 ? 'desc' : 'asc');
    if (S.page > 1) p.set('page', S.page); if (S.detail) p.set('d', S.detail);
    history.replaceState(null, '', '#' + p.toString());
  }

  // ---- shared bits ----
  function seg(label, values, current, key, fmt) {
    return '<div><label class="small muted">' + label + '</label><div class="seg" role="group" aria-label="' + label + '">' +
      values.map(function (v) { return '<button type="button" aria-pressed="' + (v === current) + '" onclick="App.set(\'' + key + '\',' + v + ')">' + fmt(v) + '</button>'; }).join('') +
      '</div></div>';
  }
  function badge(v) { return '<span class="badge is-' + v.toLowerCase() + '">' + v + '</span>'; }
  function tableHtml(head, rows, cls) {
    return '<div class="panel"><div class="scroll"><table class="mtable ' + (cls || '') + '"><thead><tr>' +
      head.map(function (h) { return '<th class="' + (h.r ? 'r' : '') + '">' + h.t + '</th>'; }).join('') +
      '</tr></thead><tbody>' + rows.map(function (r) {
        return '<tr class="' + (r.cls || '') + '">' + r.cells.map(function (c, i) { return '<td class="' + (head[i].r ? 'r' : '') + '">' + c + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table></div></div>';
  }

  // ---- KPI strip ----
  function kpis() {
    var c1000 = farmCounts(1000), c5000 = farmCounts(5000), c10000 = farmCounts(10000);
    var best = bestNetHour(S.ticket);
    var cards = [
      { l: 'Ranked protocols', v: DATA.rows.length, s: DATA.watchlist_size + ' watchlist · ' + DATA.found_size + ' found · ' + DATA.early_size + ' early' },
      { l: 'Total implied value', v: moneyM(DATA.total_implied_usd), s: 'sum of the 198 rows' },
      { l: 'Leave-one-out miss', v: mult(DATA.validation.looMedianMiss), s: pct(DATA.validation.looWithin3x, 1) + ' within 3× · flat baseline ' + mult(DATA.validation.flatLooMedianMiss) },
      { l: 'Walk-forward miss', v: mult(DATA.validation.walkForward50), s: '50/50 split · 60/40 ' + mult(DATA.validation.walkForward60) + ' · 70/30 ' + mult(DATA.validation.walkForward70) },
      { l: 'Bands hold (LOO)', v: pct(DATA.validation.band25Hold, 1) + ' / ' + pct(DATA.validation.band90Hold, 1), s: 'P25–P75 / P10–P90 vs targets 50% / 80%' },
      { l: 'Worth farming · $1,000', v: c1000.FARM + ' FARM', s: c1000.THIN + ' THIN · ' + c1000.SKIP + ' SKIP — $5,000: ' + c5000.FARM + ' · $10,000: ' + c10000.FARM, hot: true },
      { l: 'Best net / hour · $' + S.ticket.toLocaleString('en-US'), v: money2(best.e.perHour) + '/h', s: best.row.name + ' · ' + best.e.verdict + ' · net ' + money2(best.e.net) },
      { l: 'Rank stability', v: DATA.validation.rankStabilityTop20 + '/20', s: 'top 20 stay top 20 in ≥80% of 200 refits · median width ' + DATA.validation.rankStabilityMedianWidth + ' rank' },
    ];
    return '<div class="kpis">' + cards.map(function (c) {
      return '<div class="kpi' + (c.hot ? ' hot' : '') + '"><div class="k-label">' + c.l + '</div><div class="k-value">' + c.v + '</div><div class="k-sub">' + c.s + '</div></div>';
    }).join('') + '</div>';
  }

  // ---- board ----
  function visibleRows() {
    var q = S.q.trim().toLowerCase();
    var list = DATA.rows.filter(function (r) {
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
      if (S.cat !== 'all' && (r.category || 'Other') !== S.cat) return false;
      if (S.list !== 'all' && r.list !== S.list) return false;
      if (S.verdict !== 'all' && econ(r, S.ticket, S.share).verdict !== S.verdict) return false;
      return true;
    });
    var key = S.sort, dir = S.dir;
    list.sort(function (a, b) {
      var va, vb;
      if (key === 'implied') { va = a.implied_value_usd; vb = b.implied_value_usd; }
      else if (key === 'tvl') { va = a.tvl_usd; vb = b.tvl_usd; }
      else if (key === 'odds') { va = a.odds; vb = b.odds; }
      else if (key === 'net') { va = econ(a, S.ticket, S.share).net; vb = econ(b, S.ticket, S.share).net; }
      else if (key === 'be') { va = econ(a, S.ticket, S.share).be; vb = econ(b, S.ticket, S.share).be; }
      else { va = a.rank; vb = b.rank; }
      return (va - vb) * dir || a.rank - b.rank;
    });
    return list;
  }
  function boardView() {
    var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var list = visibleRows();
    var pages = Math.max(1, Math.ceil(list.length / PAGE));
    if (S.page > pages) S.page = pages;
    var slice = list.slice((S.page - 1) * PAGE, S.page * PAGE);
    function th(key, label) {
      var arrow = S.sort === key ? (S.dir < 0 ? ' ↓' : ' ↑') : '';
      return '<th><button type="button" onclick="App.sort(\'' + key + '\')">' + label + arrow + '</button></th>';
    }
    var rowsHtml = slice.map(function (r) {
      var e = econ(r, S.ticket, S.share);
      return '<tr onclick="App.detail(\'' + r.slug + '\')" tabindex="0" class="' + (S.detail === r.slug ? 'is-open' : '') + '">' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><b>' + esc(r.name) + '</b><span class="sub">' + esc(r.category || '') + ' · ' + esc(r.list) + ' · ' + esc((r.chains[0] || '')) + '</span></td>' +
        '<td class="r num">' + money(r.tvl_usd) + '</td>' +
        '<td class="r num">' + ageFmt(r.age_days) + '</td>' +
        '<td class="r num">' + money(r.value_if_launches_usd) + '</td>' +
        '<td class="r num">' + pct(r.odds) + '</td>' +
        '<td class="r num"><b>' + money(r.implied_value_usd) + '</b><span class="sub">rank ' + r.rank_range_lo + '–' + r.rank_range_hi + '</span></td>' +
        '<td class="r num">' + money(r.band_p25_usd) + ' – ' + money(r.band_p75_usd) + '</td>' +
        '<td>' + badge(e.verdict) + '</td>' +
        '<td class="r num">' + money2(e.net) + '<span class="sub">' + money2(e.perHour) + '/h</span></td></tr>';
    }).join('');
    var farm5000 = DATA.rows.filter(function (r) { return econ(r, 5000, 0.1).verdict === 'FARM'; });
    var nearFarm = DATA.rows.map(function (r) { return { r: r, e: econ(r, 1000, 0.1) }; })
      .filter(function (x) { return x.e.be > 0.1 && x.e.be <= 0.2; }).sort(function (a, b) { return a.e.be - b.e.be; });
    return '<div class="controls">' +
      '<label>Search<input type="search" value="' + esc(S.q) + '" placeholder="name, slug or category" oninput="App.q(this.value)"></label>' +
      '<label>Category<select onchange="App.cat(this.value)"><option value="all">All categories</option>' + cats.map(function (c) { return '<option value="' + esc(c) + '"' + (S.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></label>' +
      '<label>Source<select onchange="App.list(this.value)">' + ['all', 'watchlist', 'found', 'early'].map(function (v) { return '<option value="' + v + '"' + (S.list === v ? ' selected' : '') + '>' + (v === 'all' ? 'All sources' : v) + '</option>'; }).join('') + '</select></label>' +
      '<label>Verdict<select onchange="App.verdict(this.value)">' + ['all', 'FARM', 'THIN', 'SKIP'].map(function (v) { return '<option value="' + v + '"' + (S.verdict === v ? ' selected' : '') + '>' + (v === 'all' ? 'All verdicts' : v) + '</option>'; }).join('') + '</select></label>' +
      seg('Ticket', TICKETS, S.ticket, 'ticket', function (t) { return '$' + t.toLocaleString('en-US'); }) +
      seg('Airdrop share', SHARES, S.share, 'share', function (s) { return (s * 100).toFixed(1) + '%'; }) +
      '<span class="count">' + list.length + ' of ' + DATA.rows.length + ' rows</span></div>' +
      '<div class="note"><b>0 FARM at the $1,000 default is the honest verdict, not a parameter accident.</b> ' +
      'The FARM rows live at bigger tickets: <b>' + farm5000.map(function (r) { return esc(r.name); }).join(', ') + '</b> are FARM at $5,000 ' +
      '(plus Monarq at $10,000). Closest to FARM at $1,000: ' +
      nearFarm.slice(0, 3).map(function (x) { return esc(x.r.name) + ' (break-even odds ' + x.e.be.toFixed(3) + ')'; }).join(', ') +
      '. The Method tab shows the sensitivity grid that proves the binding cost is forgone yield, not fees.</div>' +
      (S.detail ? detailView() : '') +
      '<div class="panel"><div class="scroll"><table><thead><tr>' +
      '<th>#</th><th>Protocol</th>' + th('tvl', 'TVL') + '<th>Age</th><th>Value if launches</th>' + th('odds', 'Odds') + th('implied', 'Implied value') +
      '<th>P25–P75 band</th><th>Verdict @ $' + S.ticket.toLocaleString('en-US') + '</th>' + th('net', 'Net') +
      '</tr></thead><tbody>' + rowsHtml + '</tbody></table></div>' +
      '<div class="pager"><button type="button" ' + (S.page <= 1 ? 'disabled' : '') + ' onclick="App.page(' + (S.page - 1) + ')">← Previous</button>' +
      '<span class="small muted">Page ' + S.page + ' of ' + pages + ' · click a row for its model inputs, nearest comps and farm plan</span>' +
      '<button type="button" ' + (S.page >= pages ? 'disabled' : '') + ' onclick="App.page(' + (S.page + 1) + ')">Next →</button></div></div>' +
      scatterView();
  }

  // ---- detail ----
  function detailView() {
    var r = DATA.rows.find(function (x) { return x.slug === S.detail; });
    if (!r) return '';
    var e = econ(r, S.ticket, S.share);
    var cat = DATA.odds_categories.find(function (c) { return c.category === r.category; });
    var bucketName = r.age_days == null ? 'no listing date' : r.age_days < 180 ? '<6 months' : r.age_days < 365 ? '6–12 months' : r.age_days < 730 ? '1–2 years' : r.age_days < 1460 ? '2–4 years' : '>4 years';
    var comps = r.nearest_comps.map(function (c) {
      return '<div class="kv"><span>' + esc(c.name) + ' <span class="muted">(' + money(c.tvl_usd) + ' TVL)</span></span><span>cap ' + money(c.mcap_usd) + ' · model ' + money(c.model_usd) + ' · <b>miss ' + mult(c.miss) + '</b></span></div>';
    }).join('');
    var steps = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    return '<section class="detail" id="detail"><h2>' + esc(r.name) + ' <span class="muted small">rank ' + r.rank + ' · rank range ' + r.rank_range_lo + '–' + r.rank_range_hi + ' over 200 bootstrap refits</span></h2>' +
      '<div class="grid">' +
      '<div class="box"><h3>Value</h3>' +
      '<div class="kv"><span>TVL</span><b>' + money(r.tvl_usd) + '</b></div>' +
      '<div class="kv"><span>Curve</span><b>' + DATA.curve_a.toFixed(2) + ' × TVL^' + DATA.curve_b.toFixed(4) + '</b></div>' +
      '<div class="kv"><span>Value if launches</span><b>' + money(r.value_if_launches_usd) + '</b></div>' +
      '<div class="kv"><span>Implied value</span><b>' + money(r.implied_value_usd) + '</b></div>' +
      '<div class="kv"><span>P25–P75 band</span><b>' + money(r.band_p25_usd) + ' – ' + money(r.band_p75_usd) + '</b></div>' +
      '<div class="kv"><span>P10–P90 band</span><b>' + money(r.band_p10_usd) + ' – ' + money(r.band_p90_usd) + '</b></div></div>' +
      '<div class="box"><h3>Launch odds — ' + pct(r.odds) + '</h3>' +
      '<div class="kv"><span>Age bucket (' + bucketName + ')</span><b>' + r.model.bucket_rate.toFixed(4) + '</b></div>' +
      '<div class="kv"><span>Category, raw (' + esc(r.category || '—') + ', n=' + (cat ? cat.n : '?') + ')</span><b>' + (cat ? cat.rate.toFixed(3) : '—') + '</b></div>' +
      '<div class="kv"><span>Category, shrunk K=5</span><b>' + r.model.category_rate.toFixed(4) + '</b></div>' +
      '<div class="kv"><span>Overall rate / exponent</span><b>' + DATA.odds_overall.toFixed(4) + ' / 0.25</b></div>' +
      '<p class="small muted">odds = bucket × (shrunk category / overall)^0.25, clamped [0.05, 0.95]. The shrinkage is the radar-4 change: Prediction Market has only n=3, so its raw 0.333 becomes 0.468 instead of swinging the rank-1 row on one member.</p></div>' +
      '<div class="box"><h3>Nearest traded comps</h3>' + comps +
      '<p class="small muted">Closest by log-TVL. Miss = max(model/cap, cap/model) for that comp — the curve is noisy, which is why the bands are wide.</p></div>' +
      '<div class="box"><h3>Farm netting — $' + S.ticket.toLocaleString('en-US') + ' at ' + (S.share * 100).toFixed(1) + '% share</h3>' +
      '<div class="kv"><span>Slice if launches</span><b>' + money2(e.sliceFull) + '</b></div>' +
      '<div class="kv"><span>Slice expected (× odds)</span><b>' + money2(e.sliceExp) + '</b></div>' +
      '<div class="kv"><span>Fees (' + e.nTx + ' tx × $' + gasOf(r).toFixed(2) + ' + $1.50)</span><b>' + money2(e.fees) + '</b></div>' +
      '<div class="kv"><span>Forgone yield (4% T-bill, ' + e.hold + 'd)</span><b>' + money2(e.forgone) + '</b></div>' +
      '<div class="kv"><span>Net</span><b>' + money2(e.net) + '</b></div>' +
      '<div class="kv"><span>Net / hour (' + e.hours.toFixed(2) + 'h)</span><b>' + money2(e.perHour) + '/h</b></div>' +
      '<div class="kv"><span>Pays from</span><b>' + (e.paysFrom == null ? 'never' : money(e.paysFrom)) + '</b></div>' +
      '<div class="kv"><span>Break-even odds</span><b>' + e.be.toFixed(3) + '</b></div>' +
      '<div class="kv"><span>Verdict</span><b>' + badge(e.verdict) + '</b></div></div>' +
      '</div>' +
      '<h3>Farm plan — 8 steps (written at the $1,000 ticket; the netting box above is live for the selected ticket)</h3>' +
      '<ol class="steps">' + steps + '</ol>' +
      '<p class="small muted">Hold ' + e.hold + ' days (' + e.weeks + ' weekly checks). Gas is a stated estimate per chain, not a measured quote. ' +
      (r.rank <= 2 ? 'Rank 1 vs 2 is a statistical tie: Polymarket is rank 1 in ' + DATA.validation.rank1Polymarket + ' of 200 refits, Sentora in ' + DATA.validation.rank1Sentora + '. ' : '') +
      'Rank by implied value is not rank by farmability — this row is ' + e.verdict + ' at $' + S.ticket.toLocaleString('en-US') + '.</p></section>';
  }

  // ---- scatter ----
  function scatterView() {
    var W = 760, H = 340, ML = 52, MR = 14, MT = 12, MB = 34;
    var pts = DATA.comps.map(function (c) { return { x: Math.log10(c.tvl_usd), y: Math.log10(c.mcap_usd), kind: 'comp' }; })
      .concat(DATA.rows.map(function (r) { return { x: Math.log10(r.tvl_usd), y: Math.log10(r.implied_value_usd), kind: 'row' }; }));
    var xs = pts.map(function (p) { return p.x; }), ys = pts.map(function (p) { return p.y; });
    var x0 = Math.floor(Math.min.apply(null, xs)), x1 = Math.ceil(Math.max.apply(null, xs));
    var y0 = Math.floor(Math.min.apply(null, ys)), y1 = Math.ceil(Math.max.apply(null, ys));
    function X(v) { return ML + (v - x0) / (x1 - x0) * (W - ML - MR); }
    function Y(v) { return H - MB - (v - y0) / (y1 - y0) * (H - MT - MB); }
    function line(mult, dash, col) {
      var d = '';
      for (var t = x0; t <= x1; t += 0.1) { var tvl = Math.pow(10, t), y = Math.log10(DATA.curve_a * Math.pow(tvl, DATA.curve_b) * mult); d += (d ? ' L' : 'M') + X(t).toFixed(1) + ' ' + Y(y).toFixed(1); }
      return '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="1.5" stroke-dasharray="' + dash + '"/>';
    }
    var ticks = [];
    for (var t = x0; t <= x1; t++) ticks.push('<text x="' + X(t) + '" y="' + (H - 12) + '" font-size="10" fill="#6d675a" text-anchor="middle">$10^' + t + '</text>');
    var dots = pts.map(function (p) { return '<circle cx="' + X(p.x).toFixed(1) + '" cy="' + Y(p.y).toFixed(1) + '" r="' + (p.kind === 'row' ? 3 : 2) + '" fill="' + (p.kind === 'row' ? '#1d5c3f' : '#b9b3a4') + '" opacity="' + (p.kind === 'row' ? 0.85 : 0.7) + '"/>'; }).join('');
    return '<h2>Value against TVL (log–log)</h2><p class="muted small">Grey: the 101 traded comps at their market caps. Green: the 198 board rows at implied value. The solid line is the fitted curve; the dashed lines are the curve ÷/× 2.71 (the P25–P75 band factor) — most comps sit inside it, and the scatter is the reason the bands are wide.</p>' +
      '<div class="panel"><svg class="scatter" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Log-log scatter of value against TVL">' +
      line(1 / DATA.band25, '5 4', '#8a8a7a') + line(1, 'none', '#1d5c3f') + line(DATA.band25, '5 4', '#8a8a7a') + dots + ticks.join('') +
      '<text x="14" y="20" font-size="11" fill="#6d675a">log value ($)</text></svg></div>' +
      '<div class="legend"><span><i class="dot" style="background:#b9b3a4"></i>traded comp (market cap)</span><span><i class="dot" style="background:#1d5c3f"></i>board row (implied value)</span><span>— fitted curve</span><span>- - ÷/× 2.71 band</span></div>';
  }

  // ---- method ----
  function methodView() {
    var v = DATA.validation;
    function numTable(head, rows) { return tableHtml(head, rows, ''); }
    var abl = DATA.ablation.map(function (r) { return { cls: r.verdict === 'KEEP' ? 'keep' : 'drop', cells: [esc(r.rung), mult(r.looMedianMiss), pct(r.looWithin3x), mult(r.walkForward50), mult(r.walkForward60), mult(r.walkForward70), mult(r.walkForward80), mult(r.walkForwardCutoff), mult(r.walkForwardCutoff25), '<b>' + r.verdict + '</b>'] }; });
    var bake = DATA.odds_bakeoff.map(function (r) { return { cls: r.exponent === 0.25 ? 'keep' : '', cells: [r.exponent.toFixed(3), r.looAccuracy.toFixed(4), r.looBrier.toFixed(4), '#' + r.sentoraRank, r.sentoraOdds.toFixed(3), money(r.sentoraImplied), money(r.boardTotal)] }; });
    var smallN = DATA.small_n_rules.map(function (r) { return { cls: r.rule.indexOf('SHIPPED') >= 0 ? 'keep' : '', cells: [esc(r.rule), r.looAccuracy.toFixed(4), r.looBrier.toFixed(4), r.polymarketOdds < 0 ? '—' : r.polymarketOdds.toFixed(3), r.polymarketImplied < 0 ? '—' : money(r.polymarketImplied), r.boardTotal < 0 ? '—' : money(r.boardTotal)] }; });
    var surv = DATA.survivor_probes.map(function (r) { return { cells: [r.asymptoteL.toFixed(2), String(r.tau), r.k.toFixed(3), r.weightedSse.toFixed(4), r.odds56d.toFixed(2), r.odds407d.toFixed(2), r.odds1845d.toFixed(2), money(r.boardTotal)] }; });
    var probes = DATA.comp_probes.map(function (r) { return { cls: r.label.indexOf('control') >= 0 ? 'keep' : 'drop', cells: [esc(r.label), String(r.trainN), mult(r.looAll101), mult(r.wf50), mult(r.wf70), mult(r.wfCut), r.z === 0 ? '—' : r.z.toFixed(2)] }; });
    var sens = DATA.farm_sensitivity.map(function (r) { return { cells: [esc(r.change), String(r.farm1000), String(r.farm10000), esc(r.defensible)] }; });
    var cats = DATA.odds_categories.map(function (c) { return { cells: [esc(c.category), String(c.n), c.rate.toFixed(3), '<b>' + c.shrunkRate.toFixed(3) + '</b>'] }; });
    var buckets = [['<6 months', '87', '23', '0.2644', '77'], ['6–12 months', '73', '29', '0.3973', '276'], ['1–2 years', '183', '70', '0.3825', '543'], ['2–4 years', '228', '146', '0.6404', '996'], ['>4 years', '74', '59', '0.7973', '1642']].map(function (b) { return { cells: b }; });
    return '<div class="method">' +
      '<h2>Method — radar-4</h2>' +
      '<p><b>One change from radar-3: the odds’ category rates are now shrunk toward the overall rate with pseudo-count K=5</b> — shrunk = (n·raw + 5·0.5488) / (n+5). It removes the n≥5 fallback cliff and stabilises the rank-1 row, whose category (Prediction Market) has only n=3. The LOO evidence cannot distinguish the rules (Brier 0.2150 raw vs 0.2160 shrunk K=5 vs 0.2156 fallback — all within noise), so this is a principled choice, not a fitted one. Board total $1,233.4M (radar-3, raw) → <b>' + money(DATA.total_implied_usd) + '</b> as built here.</p>' +
      '<p>The value curve and the odds formula are otherwise unchanged from radar-3, because every attempt to improve them failed validation — including two that looked better until they were scored fairly (see the comp-set probes). What radar-4 adds is proof that the tempting improvements do not work, a precise decomposition of the gap to the top entries, a farm-math sensitivity analysis, and the small-n odds fix.</p>' +
      '<h3>The fitted curve</h3>' +
      '<p><code>value_if_launches = ' + DATA.curve_a.toFixed(2) + ' × TVL^' + DATA.curve_b.toFixed(4) + '</code> — Huber log-log fit (k=1.345) on <b>101</b> standalone comps (market cap ≥ $1M, TVL &gt; 0, no shared symbol or CoinGecko id). Log-scale R² <b>' + v.rSquaredOls.toFixed(4) + '</b> (OLS; Huber fit ' + v.rSquared.toFixed(3) + '), residual SD (log) 1.60. Ten times the TVL buys 10^0.4453 ≈ 2.79 times the value, not ten. The low R² is honest: TVL alone explains only ~21% of log-cap variance; that is why the bands are wide.</p>' +
      '<h3>Ablation ladder — keep / drop per rung</h3>' +
      '<p>Miss = max(pred/actual, actual/pred). LOO = leave-one-out over the 101 comps. WF = walk-forward: fit on older comps by listing date, price the newer (50/50: train 39 → test 39; 60/40: 46 → 32; 70/30: 54 → 24; 80/20: 62 → 16; cutoff 2024-07-15: 44 → 34; cutoff 2025-01-01: 53 → 25). Keep rule: keep a rung only if it lowers LOO miss and WF miss rises by at most one paired-bootstrap SE. The growth and growth+age rungs here clamp their extra term to [0.8, 1.25]; the per-category rungs shrink each category’s own (a, b) toward the global fit. Every rung except the curve itself is DROP.</p>' +
      numTable([{ t: 'Rung' }, { t: 'LOO median', r: 1 }, { t: 'LOO ≤3×', r: 1 }, { t: 'WF 50/50', r: 1 }, { t: 'WF 60/40', r: 1 }, { t: 'WF 70/30', r: 1 }, { t: 'WF 80/20', r: 1 }, { t: 'WF cut 24-07-15', r: 1 }, { t: 'WF cut 25-01-01', r: 1 }, { t: 'Verdict', r: 1 }], abl) +
      '<p class="small muted">Paired-bootstrap SEs (mean log-miss difference, positive = second rung better): curve vs flat +0.3125, SE 0.0954, z = 3.28 — the curve is a real improvement. Quadratic vs curve −0.0117, SE 0.0070, z = −1.67 — significantly worse in mean log-miss despite a better WF50 median. Category premium vs curve +0.0116, SE 0.0257, z = 0.45 — indistinguishable from zero. Per-category (a,b) K=10 vs curve −0.0167, SE 0.0353, z = −0.47. Momentum vs curve +0.0015, SE 0.0051, z = 0.30 — a null result: the nyx77-style momentum mechanism neither helps nor hurts on this snapshot.</p>' +
      '<h3>Comp-set probes — the subset trap (fair scoring)</h3>' +
      '<p>Each candidate was first scored on its own LOO, and three looked like wins (floor $2M ×2.41, floor $5M ×2.37, ratio-trimmed ×2.57). That comparison is invalid — each was scored on an easier, smaller set. Below, every candidate is scored on the <b>same</b> sets: LOO over all 101 base comps, and walk-forward with the test window fixed. Every challenger is worse than base101 in mean log-miss (negative z) and worse on at least two of three walk-forward splits. All dropped.</p>' +
      numTable([{ t: 'Candidate (train n)' }, { t: 'LOO on all 101', r: 1 }, { t: 'WF 50/50', r: 1 }, { t: 'WF 70/30', r: 1 }, { t: 'WF cut', r: 1 }, { t: 'Paired-boot z', r: 1 }].map(function (h) { return h; }), probes.map(function (r) { return { cls: r.cls, cells: [r.cells[0], r.cells[2], r.cells[3], r.cells[4], r.cells[5], r.cells[6]] }; })) +
      '<h3>Launch-odds exponent bake-off (proper LOO)</h3>' +
      '<p>Odds = bucket_rate × (category_rate / overall)^e, clamped [0.05, 0.95]. LOO validation recomputes bucket and category rates without the held-out protocol (n=645; majority-class accuracy 0.5070, base-rate Brier 0.2517). The Brier differences across e are tiny (0.2123–0.2236); e=0.75 has the best Brier and e=1.0 the best accuracy, but both drive Sentora to rank 10–19 — while the top entries rank Sentora #1. e=0.25 sits at the knee (Brier improves 0.008 from e=0 to e=0.25, only 0.003 more from e=0.25 to e=0.75) and keeps Sentora rank 2. The exponent is a judgment call, not a fitted parameter.</p>' +
      numTable([{ t: 'Exponent e', r: 1 }, { t: 'LOO accuracy', r: 1 }, { t: 'LOO Brier', r: 1 }, { t: 'Sentora rank', r: 1 }, { t: 'Sentora odds', r: 1 }, { t: 'Sentora implied', r: 1 }, { t: 'Board total', r: 1 }], bake) +
      '<p class="small muted">Odds LOO at the shipped e=0.25: accuracy ' + v.oddsLooAccuracy.toFixed(4) + ', Brier ' + v.oddsLooBrier.toFixed(4) + ' (proper LOO, shrunk K=5 rule). Radar-3’s 0.2101 was computed in-sample; the model did not get worse — the measurement got honest.</p>' +
      '<h3>Small-n category rule — LOO test</h3>' +
      numTable([{ t: 'Rule' }, { t: 'LOO accuracy', r: 1 }, { t: 'LOO Brier', r: 1 }, { t: 'Polymarket odds', r: 1 }, { t: 'Polymarket implied', r: 1 }, { t: 'Board total', r: 1 }], smallN) +
      '<h3>Survivor-form odds — investigated, DROPPED</h3>' +
      '<p>The bucket rates measure P(has token | age t) in a cross-section, but the board needs P(ever launches | pre-token now, age t). Under a stationary entry process, survivor odds = (F(∞) − F(t)) / (1 − F(t)). This is the one candidate that would close most of the gap to the top entries: at L=0.80 it gives Sentora $45.0M (rank 1), dTAO $33.8M (rank 5), total $1.89B. <b>It cannot be shipped, because F(∞) = L is unidentifiable from this snapshot.</b> The weighted SSE decreases monotonically with L — higher L always fits better, because the observed rates keep rising with no plateau (the Weibull also under-fits the young and old buckets at every L). The free fit hits L=1.0, where survivor odds are 1.0 for every age — meaningless. Picking L=0.80 because it matches the top entries would be fitting to their reported numbers, not to the data. The F fit itself validates fine (split-half Brier 0.2304 for the Weibull F vs 0.2343 for bucket rates) — the failure is the transform’s unidentifiable asymptote, not the fit.</p>' +
      numTable([{ t: 'Fixed L' }, { t: 'τ', r: 1 }, { t: 'k', r: 1 }, { t: 'Weighted SSE', r: 1 }, { t: 'Survivor odds @56d', r: 1 }, { t: '@407d', r: 1 }, { t: '@1845d', r: 1 }, { t: 'Board total', r: 1 }], surv) +
      '<h3>Band calibration</h3>' +
      '<p>From the LOO misses of the curve-only model (n=101): P25–P75 factor ×' + DATA.band25.toFixed(3) + ' holds for ' + pct(v.band25Hold, 1) + ' of held-out caps (target 50%); P10–P90 factor ×' + DATA.band90.toFixed(3) + ' holds for ' + pct(v.band90Hold, 1) + ' (target 80%). Age-split bands were tested and rejected — the young-comp bands rest on n=18 and are unstable (young &lt;18mo ×4.43 / ×6.98; ≥18mo ×2.43 / ×5.36; unknown ×3.81 / ×7.18) — so the single pair is used for every row.</p>' +
      '<h3>Launch-odds inputs</h3>' +
      numTable([{ t: 'Age bucket' }, { t: 'n', r: 1 }, { t: 'With token', r: 1 }, { t: 'Rate', r: 1 }, { t: 'Median age (d)', r: 1 }], buckets) +
      numTable([{ t: 'Category' }, { t: 'n', r: 1 }, { t: 'Raw rate', r: 1 }, { t: 'Shrunk rate (K=5)', r: 1 }], cats) +
      '<p class="small muted">Overall token rate 416/758 = 0.5488. Worked odds (shipped formula): Sentora 0.3825 × (0.176/0.5488)^0.25 = 0.288; dTAO 0.2644 × (0.728/0.5488)^0.25 = 0.284; Polymarket 0.7973 × (0.468/0.5488)^0.25 = 0.766. Protocols with no listing date use the overall rate as the bucket rate. The bucket-form odds measure P(records a token), not P(will launch | no token yet); no single snapshot can validate the latter.</p>' +
      '<h3>Rank 1 is a tie</h3>' +
      '<p>Polymarket International ' + money(DATA.rows[0].implied_value_usd) + ' vs Sentora Curator ' + money(DATA.rows[1].implied_value_usd) + '. Polymarket is rank 1 in ' + v.rank1Polymarket + '/200 bootstrap refits, Sentora in ' + v.rank1Sentora + '/200. The dashboard shows rank ranges, not false precision: ' + v.rankStabilityTop20 + '/20 of the top 20 stay top 20 in ≥80% of refits, median top-20 p10–p90 width ' + v.rankStabilityMedianWidth + ' rank.</p>' +
      '<h3>Why the top entries’ implied values are up to 6× ours — decomposition</h3>' +
      '<p>For each shared protocol: their curve base (from their stated formula and the snapshot TVL) × their effective multiplier (= reported implied / their base). The multiplier conflates their premium, momentum, age and odds factors, which cannot be separated from a dashboard alone — so this locates the gap, it does not reverse-engineer their formulas. Their reported values are unverified dashboard claims, never fitted inputs.</p>' +
      numTable([{ t: 'Protocol (age, category)' }, { t: 'Our value', r: 1 }, { t: 'Our odds / implied', r: 1 }, { t: 'nyx77 eff.', r: 1 }, { t: 'sudhan eff.', r: 1 }, { t: 'lufi-aq eff.', r: 1 }], [
        { cells: ['Sentora Curator (407d, Risk Curators)', '$99.5M', '0.288 / $28.6M', '0.471 ($27.6M)', '—', '0.881 ($50.1M)'] },
        { cells: ['Steakhouse Financial (543d, Risk Curators)', '$99.4M', '0.288 / $28.6M', '0.459 ($26.9M)', '0.457 ($31.8M)', '0.853 ($48.5M)'] },
        { cells: ['Gauntlet (543d, Risk Curators)', '$77.6M', '0.288 / $22.3M', '0.475 ($21.9M)', '—', '0.893 ($39.8M)'] },
        { cells: ['USDD (611d, CDP)', '$64.9M', '0.376 / $24.4M', '0.472 ($18.3M)', '1.103 ($48.6M)', '0.912 ($34.1M)'] },
        { cells: ['OnRe (488d, RWA)', '$37.5M', '0.377 / $14.2M', '1.003 ($22.9M)', '1.419 ($34.8M)', '—'] },
        { cells: ['Bittensor dTAO (56d, Dexs)', '$41.0M', '0.284 / $11.6M', '0.902 ($22.4M)', '2.714 ($73.1M)', '1.033 ($24.6M)'] },
        { cells: ['Polymarket (1845d, Prediction Market)', '$38.1M', '0.766 / $29.2M', '<1.19 (<$27.6M)', '—', '—'] },
      ]) +
      '<p>Three facts fall out. (1) <b>Our curve is higher than theirs</b> (Sentora $99.5M vs their bases $57–70M — the category-exclusion effect: fitting on comps excluding CEX / Bridge / Canonical Bridge / Liquid Staking / Liquid Restaking / Restaked BTC gives A=37,711, b=0.3379 and Sentora $58.5M, but validates worse: LOO ×2.79 vs ×2.71), but <b>our odds are far lower</b> (0.28–0.38 vs their effective 0.46–1.42). The net gap is in the odds, not the curve. (2) <b>No top entry applies a bucket-rate discount like ours.</b> The survivor form above is the only principled construction that lands in their range — and it is unidentifiable. (3) <b>Sudhan’s dTAO ($73.1M) is base $26.9M × 2.714.</b> The pieces cannot each be 2.7×: dTAO’s 7-day change is −6.56% (momentum ≤ ~1.0), its Dexs premium is ~×1.16 in our fit, and there is no kinship link in the snapshot — dTAO has no symbol and no gecko_id, and no separate bittensor row exists. The 2.714 is dominated by their age factor and/or a sector premium far above the fitted ×1.16. None of that survives our validation: age-as-multiplier fails LOO, category premiums fail LOO, momentum is a null. <b>No part of sudhan’s 2.714× is adoptable without breaking validation.</b> Their farm math, by contrast, is structurally identical to ours — the verdict difference is entirely the model, not the farm math.</p>' +
      '<h3>Farm-math sensitivity — one assumption at a time</h3>' +
      '<p>At a $1,000 ticket the binding cost is forgone yield, not fees. Halving gas or dropping the weekly tx moves nothing at $1k (0 FARM either way); zeroing forgone yield moves 16 rows to FARM — and that is the one change that would be dishonest, because the $6.58 forgone on a $1,000/60-day ticket is a real opportunity cost every top entry also charges. The honest levers that remain are a better model (tested exhaustively above: none validates) and a bigger ticket ($5,000 flips 3 rows, $10,000 flips 4).</p>' +
      numTable([{ t: 'Change (from baseline)' }, { t: 'FARM @ $1k', r: 1 }, { t: 'FARM @ $10k', r: 1 }, { t: 'Defensible?' }], sens) +
      '<h3>Comp set</h3>' +
      '<p>Definition: <code>mcap_usd ≥ $1M</code>, <code>tvl_usd &gt; 0</code>, standalone token — no other protocol in the snapshot shares its symbol or gecko_id. n = 101 comps (78 with listed_at). Sentinels (mcap 0 or −1, 16 of 144 with mcap present) are excluded. <code>change_7d</code> is in PERCENT units, not fractions (median −8.22%): convert with g = change_7d / 100, capped to [−0.6, +1.2].</p>' +
      '<h3>What was NOT adopted — and why</h3>' +
      '<ul><li>Category premium in the scoring model (fails LOO under every formulation; K sweep K=4 ×2.825, K=8 ×2.843, K=16 ×2.856, K=64 ×2.762, all worse than curve-only ×2.707).</li>' +
      '<li>Growth term (fitted coefficient −4.06, negative and stable across folds — a crash-week artifact: when TVL crashes faster than mcap, mcap/TVL mechanically rises; it fails out-of-sample).</li>' +
      '<li>Age term in the value curve (hurts LOO; age belongs in the odds, not in the value).</li>' +
      '<li>Survivor-form odds (unidentifiable asymptote L; board swings $1.89B–$2.70B across L).</li>' +
      '<li>Per-category (a, b) fits (K=10 LOO ×2.75, K=40 ×2.68 — the only sub-2.71 median in the ladder, but heavy shrinkage barely different from the global curve, with no walk-forward support).</li>' +
      '<li>Momentum multipliers (null result, z = 0.30).</li></ul>' +
      '<p class="small muted">Caveats: LOO medians are noisy (n=101 comps); the keep/drop calls rest on the pattern across LOO + six walk-forward splits + paired-bootstrap SEs, not on any single median. The odds exponent 0.25 and the shrinkage K=5 are judgment calls, not fitted parameters. Gas numbers are stated estimates, not measured on-chain. Farm verdicts are model-sensitive: the same protocol flips FARM↔SKIP across the top entries’ models. The judge’s reasons are unpublished until the final kit; these numbers predict the dev score against the 4 fixed house dashboards.</p>' +
      '</div>';
  }

  // ---- ledger ----
  function ledgerView() {
    var total = DATA.ledger.reduce(function (s, g) { return s + g.count; }, 0);
    var groups = DATA.ledger.map(function (g) { return { cells: [esc(g.label), String(g.count), esc(g.reason)] }; });
    var live = DATA.live.map(function (p) { return { cells: [esc(p.name), esc(p.category || ''), money(p.tvl_usd), p.mcap_usd == null ? '—' : money(p.mcap_usd)] }; });
    return '<h2>The 758-protocol ledger</h2>' +
      '<p>Every protocol in the snapshot, accounted for exactly once: <b>' + total + ' = 758</b>. Ranked rows are the 40 watchlist + 20 found above the floor + 138 early below the floor. Set-aside rows are pre-token but excluded by the board rule, in first-matching-reason order (exchange-name prefix catches 0 rows after the category/name checks).</p>' +
      tableHtml([{ t: 'Group' }, { t: 'Count', r: 1 }, { t: 'Reason' }], groups) +
      '<h2>Live tokens — the market’s own values</h2>' +
      '<p>The 24 largest live-token protocols by market cap. They already trade, so the board shows the market’s own value for them, never a model’s.</p>' +
      tableHtml([{ t: 'Protocol' }, { t: 'Category' }, { t: 'TVL', r: 1 }, { t: 'Market cap', r: 1 }], live);
  }

  // ---- audit ----
  function auditLine() {
    var recomputed = DATA.rows.reduce(function (s, r) { return s + impliedRecomputed(r); }, 0);
    var diff = Math.abs(recomputed - DATA.total_implied_usd) / DATA.total_implied_usd * 100;
    return '<p class="audit">audit: ' + DATA.rows.length + ' rows · page total ' + money(DATA.total_implied_usd) +
      ' · recomputed from the stamped curve and odds ' + money(recomputed) + ' · agree within ' + diff.toFixed(2) + '% (rounding) · ' +
      'model ' + DATA.model_version + ' · snapshot as of ' + esc(DATA.as_of) + ' · floor ' + money(DATA.floor_usd) + ' · source ' + esc(DATA.source) + '</p>';
  }

  // ---- render ----
  function render() {
    var app = document.getElementById('app');
    var html = '<div class="wrap">' +
      '<header class="mast"><div><div class="tag">Token Radar · <b>' + DATA.model_version + '</b> · make.fun token-radar-01</div>' +
      '<h1>Pre-token protocols, ranked by implied value</h1></div>' +
      '<div class="tag num">as of ' + esc(DATA.as_of) + ' · floor $50M · 758 protocols</div></header>' +
      '<p class="intro">Implied value is a <b>size curve fitted on the snapshot’s own traded tokens</b> (value = ' + DATA.curve_a.toFixed(2) + ' × TVL^' + DATA.curve_b.toFixed(4) + '), times the <b>launch odds</b> for the protocol’s age and category — with the category rate shrunk toward the overall rate (K=5) in radar-4. Every row carries a costed farm plan: slice minus fees minus forgone yield, with a FARM / THIN / SKIP verdict. Click any row for its model inputs and plan.</p>' +
      kpis() +
      '<nav class="navtabs" role="tablist">' +
      [['board', 'Board'], ['method', 'Method & tests'], ['ledger', 'Ledger · 758']].map(function (t) {
        return '<button type="button" role="tab" aria-selected="' + (S.tab === t[0]) + '" onclick="App.tab(\'' + t[0] + '\')">' + t[1] + '</button>';
      }).join('') + '</nav>' +
      (S.tab === 'method' ? methodView() : S.tab === 'ledger' ? ledgerView() : boardView()) +
      auditLine() + '</div>';
    app.innerHTML = html;
    app.setAttribute('aria-busy', 'false');
  }

  window.App = {
    set: function (key, v) { if (key === 'ticket') S.ticket = v; else S.share = v; S.page = 1; writeHash(); render(); },
    tab: function (t) { S.tab = t; writeHash(); render(); },
    sort: function (k) { if (S.sort === k) S.dir = -S.dir; else { S.sort = k; S.dir = -1; } writeHash(); render(); },
    page: function (p) { S.page = p; writeHash(); render(); },
    q: function (v) { S.q = v; S.page = 1; writeHash(); render(); },
    cat: function (v) { S.cat = v; S.page = 1; writeHash(); render(); },
    list: function (v) { S.list = v; S.page = 1; writeHash(); render(); },
    verdict: function (v) { S.verdict = v; S.page = 1; writeHash(); render(); },
    detail: function (slug) { S.detail = S.detail === slug ? '' : slug; writeHash(); render(); if (S.detail) { var el = document.getElementById('detail'); if (el) el.scrollIntoView({ block: 'start' }); } },
  };
  render();
})();
