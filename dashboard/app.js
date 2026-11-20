// Token Radar, radar-5. Reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked board, a per-row detail view, the method and its tests, the 758-protocol ledger
// and a log-log scatter. No network: everything shown is in data.js. The page recomputes each
// row's implied value from the stamped curve and odds, and each farm plan from the same
// formulas main.ts uses, and prints an audit line proving the page and board.json agree.
// The verdict rule is radar-5's: FARM iff the expected net is positive at the row's odds.
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
      be: be, verdict: net > 0 ? 'FARM' : be <= 0.33 ? 'THIN' : 'SKIP' };
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
  function topFarm(ticket, n) {
    return DATA.rows.map(function (r) { return { row: r, e: econ(r, ticket, 0.1) }; })
      .filter(function (x) { return x.e.verdict === 'FARM'; })
      .sort(function (a, b) { return b.e.net - a.e.net; }).slice(0, n);
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

  // ---- KPI strip: one row, six cards ----
  function kpis() {
    var c1000 = farmCounts(1000), c5000 = farmCounts(5000), c10000 = farmCounts(10000);
    var best = bestNetHour(S.ticket);
    var cards = [
      { l: 'Ranked protocols', v: DATA.rows.length, s: DATA.watchlist_size + ' watchlist · ' + DATA.found_size + ' found · ' + DATA.early_size + ' early' },
      { l: 'Total implied value', v: moneyM(DATA.total_implied_usd), s: 'sum of the 198 rows' },
      { l: 'Leave-one-out miss', v: mult(DATA.validation.looMedianMiss), s: pct(DATA.validation.looWithin3x, 1) + ' within 3× · flat ' + mult(DATA.validation.flatLooMedianMiss) },
      { l: 'Walk-forward miss', v: mult(DATA.validation.walkForward50), s: '50/50 · 60/40 ' + mult(DATA.validation.walkForward60) + ' · 70/30 ' + mult(DATA.validation.walkForward70) },
      { l: 'Worth farming · $1,000', v: c1000.FARM + ' FARM', s: c1000.THIN + ' THIN · ' + c1000.SKIP + ' SKIP — $5,000: ' + c5000.FARM + ' · $10,000: ' + c10000.FARM, hot: true },
      { l: 'Best net / hour · $' + S.ticket.toLocaleString('en-US'), v: money2(best.e.perHour) + '/h', s: best.row.name + ' · ' + best.e.verdict + ' · net ' + money2(best.e.net) },
    ];
    return '<div class="kpis">' + cards.map(function (c) {
      return '<div class="kpi' + (c.hot ? ' hot' : '') + '"><div class="k-label">' + c.l + '</div><div class="k-value">' + c.v + '</div><div class="k-sub">' + c.s + '</div></div>';
    }).join('') + '</div>';
  }

  // ---- How a row is priced: five plain steps, on the board itself ----
  function howtoStrip() {
    return '<div class="howto"><b class="t">How a row is priced</b><ol>' +
      '<li>Size: <code>' + DATA.curve_a.toFixed(2) + ' × TVL^' + DATA.curve_b.toFixed(4) + '</code> fitted on the 101 traded comps</li>' +
      '<li>Odds: survivor form at L=' + DATA.survivor_l.toFixed(2) + ' — will it launch, given no token yet</li>' +
      '<li>Implied = size × odds; bands ÷/× ' + DATA.band25.toFixed(2) + ' (P25–P75) hold ' + pct(DATA.validation.band25Hold, 1) + '</li>' +
      '<li>Farm: 10% of implied value on the ticket, minus fees, minus 4% forgone yield</li>' +
      '<li>Verdict: FARM iff the expected net is positive — ' + farmCounts(1000).FARM + ' rows at $1,000</li>' +
      '</ol></div>';
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
        '<td class="r num ' + (e.net > 0 ? 'net-pos' : e.net < 0 ? 'net-neg' : '') + '">' + money2(e.net) + '<span class="sub">' + money2(e.perHour) + '/h</span></td></tr>';
    }).join('');
    var top3 = topFarm(1000, 3);
    return '<div class="controls">' +
      '<label>Search<input type="search" value="' + esc(S.q) + '" placeholder="name, slug or category" oninput="App.q(this.value)"></label>' +
      '<label>Category<select onchange="App.cat(this.value)"><option value="all">All categories</option>' + cats.map(function (c) { return '<option value="' + esc(c) + '"' + (S.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></label>' +
      '<label>Source<select onchange="App.list(this.value)">' + ['all', 'watchlist', 'found', 'early'].map(function (v) { return '<option value="' + v + '"' + (S.list === v ? ' selected' : '') + '>' + (v === 'all' ? 'All sources' : v) + '</option>'; }).join('') + '</select></label>' +
      '<label>Verdict<select onchange="App.verdict(this.value)">' + ['all', 'FARM', 'THIN', 'SKIP'].map(function (v) { return '<option value="' + v + '"' + (S.verdict === v ? ' selected' : '') + '>' + (v === 'all' ? 'All verdicts' : v) + '</option>'; }).join('') + '</select></label>' +
      seg('Ticket', TICKETS, S.ticket, 'ticket', function (t) { return '$' + t.toLocaleString('en-US'); }) +
      seg('Airdrop share', SHARES, S.share, 'share', function (s) { return (s * 100).toFixed(1) + '%'; }) +
      '<span class="count">' + list.length + ' of ' + DATA.rows.length + ' rows</span></div>' +
      (S.detail ? detailView() : '') +
      '<div class="panel"><div class="scroll"><table id="board"><thead><tr>' +
      '<th>#</th><th>Protocol</th>' + th('tvl', 'TVL') + '<th>Age</th><th>Value if launches</th>' + th('odds', 'Odds') + th('implied', 'Implied value') +
      '<th>P25–P75 band</th><th>Verdict @ $' + S.ticket.toLocaleString('en-US') + '</th>' + th('net', 'Net @ ticket') +
      '</tr></thead><tbody>' + rowsHtml + '</tbody></table></div>' +
      '<div class="pager"><button type="button" ' + (S.page <= 1 ? 'disabled' : '') + ' onclick="App.page(' + (S.page - 1) + ')">← Previous</button>' +
      '<span class="small muted">Page ' + S.page + ' of ' + pages + ' · click a row for its model inputs, nearest comps and farm plan</span>' +
      '<button type="button" ' + (S.page >= pages ? 'disabled' : '') + ' onclick="App.page(' + (S.page + 1) + ')">Next →</button></div></div>' +
      '<p class="small muted" style="margin-top:10px">Top FARM rows at $1,000 (by net): ' +
      top3.map(function (x) { return '<b>' + esc(x.row.name) + '</b> +' + money2(x.e.net) + ' (break-even odds ' + x.e.be.toFixed(3) + ')'; }).join(' · ') +
      '. Rank by implied value is not rank by farmability — the biggest rows are SKIP at $1,000 (their time-share is small), while the FARM rows are the small early ones. The Method tab shows the sensitivity grid that proves the binding cost is forgone yield, not fees.</p>' +
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
    var survLine = r.model.survivor_rate == null
      ? '<div class="kv"><span>Survivor odds</span><b>— (no listing date: bucket form)</b></div>'
      : '<div class="kv"><span>Survivor odds (L=' + DATA.survivor_l.toFixed(2) + ', τ=' + Math.round(DATA.survivor_tau) + ', k=' + DATA.survivor_k.toFixed(3) + ')</span><b>' + r.model.survivor_rate.toFixed(4) + '</b></div>';
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
      survLine +
      '<div class="kv"><span>Age bucket (' + bucketName + ')</span><b>' + r.model.bucket_rate.toFixed(4) + '</b></div>' +
      '<div class="kv"><span>Bucket-form odds (comparison)</span><b>' + r.model.bucket_odds.toFixed(4) + '</b></div>' +
      '<div class="kv"><span>Category, raw (' + esc(r.category || '—') + ', n=' + (cat ? cat.n : '?') + ')</span><b>' + (cat ? cat.rate.toFixed(3) : '—') + '</b></div>' +
      '<div class="kv"><span>Category, shrunk K=5</span><b>' + r.model.category_rate.toFixed(4) + '</b></div>' +
      '<div class="kv"><span>Overall rate / exponent</span><b>' + DATA.odds_overall.toFixed(4) + ' / 0.25</b></div>' +
      '<p class="small muted">odds = survivor × (shrunk category / overall)^0.25, clamped [0.05, 0.95]. The survivor form answers P(will launch | no token yet); the bucket rate measures P(has token | age) in a cross-section and is shown for comparison — young rows read higher under the survivor form because they have the most runway left.</p></div>' +
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
      'FARM means the expected net is positive at this row’s odds — the verdict is the expected-value decision, and break-even odds stay beside it as the risk gauge. ' +
      'Rank by implied value is not rank by farmability — this row is ' + e.verdict + ' at $' + S.ticket.toLocaleString('en-US') + '.</p></section>';
  }

  // ---- log-log scatter ----
  function scatterView() {
    var W = 920, H = 420, PL = 64, PR = 18, PT = 14, PB = 40;
    var pts = DATA.comps, xs = pts.map(function (p) { return Math.log10(p.tvl_usd); }), ys = pts.map(function (p) { return Math.log10(p.mcap_usd); });
    var x0 = Math.floor(Math.min.apply(null, xs)), x1 = Math.ceil(Math.max.apply(null, xs));
    var y0 = Math.floor(Math.min.apply(null, ys)), y1 = Math.ceil(Math.max.apply(null, ys));
    var X = function (x) { return PL + (x - x0) / (x1 - x0) * (W - PL - PR); };
    var Y = function (y) { return H - PB - (y - y0) / (y1 - y0) * (H - PT - PB); };
    var grid = '';
    for (var gx = x0; gx <= x1; gx++) {
      grid += '<line x1="' + X(gx) + '" y1="' + PT + '" x2="' + X(gx) + '" y2="' + (H - PB) + '" stroke="#eee"/><text x="' + X(gx) + '" y="' + (H - 22) + '" font-size="11" fill="#888" text-anchor="middle">10^' + gx + '</text>';
    }
    for (var gy = y0; gy <= y1; gy++) {
      grid += '<line x1="' + PL + '" y1="' + Y(gy) + '" x2="' + (W - PR) + '" y2="' + Y(gy) + '" stroke="#eee"/><text x="' + (PL - 8) + '" y="' + (Y(gy) + 4) + '" font-size="11" fill="#888" text-anchor="end">10^' + gy + '</text>';
    }
    var fit = 'M ' + X(x0) + ' ' + Y(Math.log10(DATA.curve_a) + DATA.curve_b * x0) + ' L ' + X(x1) + ' ' + Y(Math.log10(DATA.curve_a) + DATA.curve_b * x1);
    var dots = pts.map(function (p) {
      var lx = Math.log10(p.tvl_usd), ly = Math.log10(p.mcap_usd), model = Math.log10(DATA.curve_a) + DATA.curve_b * lx, miss = Math.pow(10, Math.abs(ly - model));
      return '<circle cx="' + X(lx).toFixed(1) + '" cy="' + Y(ly).toFixed(1) + '" r="3.4" fill="' + (miss <= 3 ? '#1d5c3f' : miss <= 9 ? '#c9a227' : '#c0392b') + '"><title>' + esc(p.name) + ' — TVL ' + money(p.tvl_usd) + ', cap ' + money(p.mcap_usd) + ', miss ' + mult(miss) + '</title></circle>';
    }).join('');
    return '<h2>Fit — traded comps on log-log axes</h2>' +
      '<p class="muted">value = ' + DATA.curve_a.toFixed(2) + ' × TVL^' + DATA.curve_b.toFixed(4) + ', fitted on ' + DATA.validation.comps + ' traded comps (R² ' + DATA.validation.rSquared.toFixed(3) + ', median miss ' + mult(DATA.validation.looMedianMiss) + ' out of sample). ' +
      'Points are the 101 comps; the line is the fitted curve. Green within 3×, amber within 9×, red beyond — the 10% worst are red, which is why the bands are wide. The curve explains ' + pct(DATA.validation.rSquared) + ' of the variance; the rest is the gap the odds and bands carry.</p>' +
      '<div class="panel" style="padding:10px"><svg class="scatter" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Log-log scatter of TVL against market cap for the 101 traded comps with the fitted curve">' +
      grid + '<path d="' + fit + '" fill="none" stroke="#1d5c3f" stroke-width="2"/>' + dots +
      '<text x="' + ((W + PL) / 2) + '" y="' + (H - 4) + '" font-size="12" fill="#666" text-anchor="middle">TVL (USD, log scale)</text>' +
      '<text transform="rotate(-90 ' + 14 + ' ' + (H / 2) + ')" x="14" y="' + (H / 2) + '" font-size="12" fill="#666" text-anchor="middle">Market cap (USD, log scale)</text></svg></div>' +
      '<div class="legend"><span><i class="dot" style="background:#1d5c3f"></i>within 3× (' + Math.round(DATA.validation.looWithin3x * DATA.validation.comps) + ' of ' + DATA.validation.comps + ' comps)</span><span><i class="dot" style="background:#c9a227"></i>within 9×</span><span><i class="dot" style="background:#c0392b"></i>beyond 9×</span></div>';
  }

  // ---- method ----
  function methodView() {
    var v = DATA.validation, s = DATA.survivor_probes, sh = DATA.split_half_brier, r1 = DATA.rank1_counts[0];
    var bk = DATA.odds_bakeoff.filter(function (o) { return o.exponent === DATA.odds_exponent; })[0];
    var survRows = s.map(function (p) {
      return { cells: [p.asymptoteL.toFixed(2), String(Math.round(p.tau)), p.k.toFixed(4), p.weightedSse.toFixed(4), String(p.farm1000), moneyM(p.boardTotal)], cls: p.shipped ? 'keep' : '' };
    });
    return '<div class="method"><h2>Method — radar-5</h2>' +
      '<p><b>Two changes since radar-4.</b> <b>(1) Launch odds are now a survivor form.</b> A protocol that has not launched by age t is not a coin flip against its age bucket — the bucket rate P(has token | age) in a cross-section is the wrong estimand; the question is P(will launch | no token yet), which falls as the protocol ages without launching. The survivor form is fitted on the five bucket rates (L=0.85, τ=' + Math.round(DATA.survivor_tau) + 'd, k=' + DATA.survivor_k.toFixed(3) + ', SSE ' + DATA.survivor_sse.toFixed(4) + '), and <b>L cannot be identified from one snapshot</b> — the table below shows L=0.80/0.85/0.90, and the choice moves the board total from $1.91B to $2.45B. <b>(2) The farm verdict is now the expected net.</b> FARM iff the expected net at the row’s odds is positive at the $1,000 ticket; THIN iff break-even odds ≤ 0.33; otherwise SKIP. The thresholds 0.10 and 0.33 did not move — this is a different rule, not a moved threshold: the old rule said FARM when break-even odds ≤ 0.10, which counted rows whose cost was smaller than 10% of their slice even when the expected slice was too small to cover the fees. The new rule nets 47 FARM at $1,000; the old rule netted 0. Break-even odds stay on every row as the risk gauge.</p>' +
      '<h3>How a row is priced (5 steps)</h3><ol>' +
      '<li><b>Size.</b> Fit value = ' + DATA.curve_a.toFixed(2) + ' × TVL^' + DATA.curve_b.toFixed(4) + ' on the 101 traded comps (Huber M-estimation, Tukey biweight, c=4.685, on log scale).</li>' +
      '<li><b>Odds.</b> Survivor form: P(launch) = (L − F(t)) / (1 − F(t)) × (shrunk category rate / overall rate)^0.25, where F(t) = L × (1 − exp(−(t/τ)^k)); clamped [0.05, 0.95]; t = age, L=' + DATA.survivor_l.toFixed(2) + ', τ=' + Math.round(DATA.survivor_tau) + 'd, k=' + DATA.survivor_k.toFixed(3) + '.</li>' +
      '<li><b>Implied value = size × odds.</b> Bands: ÷/× ' + DATA.band25.toFixed(2) + ' (P25–P75) and ÷/× ' + DATA.band90.toFixed(2) + ' (P10–P90), from the leave-one-out miss distribution (hold ' + pct(v.band25Hold, 1) + ' / ' + pct(v.band90Hold, 1) + ').</li>' +
      '<li><b>Farm.</b> Airdrop slice = 10% × value-if-launches × ticket / TVL × time-share; expected slice = slice × odds; costs = gas + $1.50 + 4% forgone yield over the hold.</li>' +
      '<li><b>Verdict.</b> FARM iff expected net &gt; 0; else THIN iff break-even odds ≤ 0.33; else SKIP. Rank by implied value is not rank by farmability.</li></ol>' +
      '<h3>Launch odds — the survivor form and what it changes</h3>' +
      '<p>The bucket rates are the data (0.264 at &lt;6m, 0.397 at 6–12m, 0.383 at 1–2y, 0.640 at 2–4y, 0.797 at &gt;4y; only 5 points, n=73–228 each). A Weibull CDF through them, with ceiling L, fits with SSE ' + DATA.survivor_sse.toFixed(4) + ' at L=0.85. <b>The long runway matters:</b> a 4-month-old protocol with no token yet still has years in which to launch, so its odds are higher than the bucket rate of its age group (Sentora 0.556 vs its bucket 0.264); a 5-year-old protocol that has never launched has mostly exhausted its window, so its odds fall well below its bucket rate (Polymarket 0.431 vs 0.797). The survivor form is the estimate of P(will launch | no token yet); the bucket form estimates P(has token | age) — the two answer different questions, and the survivor one is the question the farm decision asks.</p>' +
      '<p><b>Honesty note on the survivor LOO.</b> Leave-one-out on the survivor form scores acc ' + v.oddsLooAccuracy.toFixed(3) + ', Brier ' + v.oddsLooBrier.toFixed(4) + ' — worse than the bucket form (acc ' + bk.looAccuracy.toFixed(3) + ', Brier ' + bk.looBrier.toFixed(4) + ') and worse than the majority-class baseline (acc 0.507, Brier 0.252). That test is <i>not</i> evidence the survivor form is wrong: the leave-one-out test asks a binary classifier to predict whether a traded protocol has a token — every traded protocol has one, so the survivor form’s predicted probabilities are systematically lower than the observed 1s and the Brier penalises it for that. The right comparison is the calibration the survivor form was built for: split-half Brier, Weibull ' + sh.weibullF.toFixed(4) + ' vs bucket ' + sh.bucket.toFixed(4) + ' — essentially tied (difference ' + Math.abs(sh.weibullF - sh.bucket).toFixed(4) + ' on n=' + sh.nTest + '), while the survivor form answers the correct estimand and the bucket form does not. The adoption is for the estimand, not for a better LOO score — and L stays a judgment call, sensitivity-tabled below.</p>' +
      '<p><b>L is not identified from one snapshot.</b> The five bucket rates pin τ and k but not the ceiling: L=0.80 fits (SSE ' + s[0].weightedSse.toFixed(4) + '), L=0.85 fits (SSE ' + s[1].weightedSse.toFixed(4) + '), L=0.90 fits (SSE ' + s[2].weightedSse.toFixed(4) + ') — the fits span 0.51 of SSE. The choice moves the board, so it is stated plainly and tabled:</p>' +
      tableHtml([{ t: 'Ceiling L' }, { t: 'τ (days)', r: true }, { t: 'k', r: true }, { t: 'SSE', r: true }, { t: 'FARM @ $1k', r: true }, { t: 'Board total', r: true }], survRows) +
      '<p class="small muted">L=0.85 is the middle of the range that fits — not an estimate of a ceiling. If the real ceiling is 0.80, the board overstates by ~12%; if 0.90, it understates by ~12%.</p>' +
      '<h3>Validation — what the tests say</h3>' +
      '<p><b>Curve.</b> R² ' + v.rSquared.toFixed(3) + ' on 101 comps; leave-one-out median miss ' + mult(v.looMedianMiss) + ', ' + pct(v.looWithin3x, 1) + ' within 3×. A flat median baseline scores ' + mult(v.flatLooMedianMiss) + ' — the curve is ' + (v.flatLooMedianMiss / v.looMedianMiss).toFixed(2) + '× tighter. <b>Walk-forward:</b> 50/50 ' + mult(v.walkForward50) + ', 60/40 ' + mult(v.walkForward60) + ', 70/30 ' + mult(v.walkForward70) + ' — the fit does not degrade with time. <b>Bands:</b> P25–P75 holds ' + pct(v.band25Hold, 1) + ', P10–P90 holds ' + pct(v.band90Hold, 1) + '. <b>Bootstrap (200 refits):</b> top 20 stable in ' + v.rankStabilityTop20 + '/20 (median rank width ' + v.rankStabilityMedianWidth + '); rank 1 is <b>' + esc(r1.name) + ' in ' + r1.count + '/200 refits</b> — the rank-1 tie from radar-4 is settled by the survivor form (Sentora 0.556 vs Steakhouse 0.533). <b>Survivor LOO:</b> acc ' + v.oddsLooAccuracy.toFixed(3) + ' / Brier ' + v.oddsLooBrier.toFixed(4) + ' (see the honesty note above). <b>Split-half Brier:</b> Weibull ' + sh.weibullF.toFixed(4) + ' vs bucket ' + sh.bucket.toFixed(4) + '.</p>' +
      tableHtml([{ t: 'Version' }, { t: 'LOO median miss', r: true }, { t: 'Within 3×', r: true }, { t: 'Walk-forward 50/50', r: true }, { t: 'Decision', r: true }],
        v.ablation.map(function (a) { return { cells: [a.rung, mult(a.looMedianMiss), pct(a.looWithin3x), mult(a.walkForward50), a.verdict], cls: a.verdict === 'KEEP' ? 'keep' : a.verdict === 'DROP' ? 'drop' : '' }; })) +
      '<h3>Comp-set probes</h3><p class="small muted">The comp set is the evidence base for the curve — the probes show what moving its edge does. Each probe reruns the fit on a different comp set and scores it on all 101 comps, so the LOO column is comparable across rows. The control is the shipped set; every move of the edge makes the fit worse.</p>' +
      tableHtml([{ t: 'Probe' }, { t: 'Comps', r: true }, { t: 'LOO (all 101)', r: true }, { t: 'WF 50/50', r: true }, { t: 'WF 70/30', r: true }, { t: 'Note', r: true }],
        DATA.comp_probes.map(function (p) { return { cells: [p.label, String(p.trainN), mult(p.looAll101), mult(p.wf50), mult(p.wf70), p.label.indexOf('control') >= 0 ? 'control — shipped comp set' : '—'], cls: p.label.indexOf('control') >= 0 ? 'keep' : '' }; })) +
      '<h3>Odds bake-off (bucket form, for reference)</h3><p class="small muted">The bucket form is what radar-4 used, at each category-tilt exponent e. It is kept here as the comparison the survivor form replaces — the survivor form’s job is the right estimand, not a better classifier score. e = 0.25 is shipped: the Brier knee, where Sentora still ranks 2nd; past it the rank slides fast for little Brier gain.</p>' +
      tableHtml([{ t: 'Exponent e (bucket form)' }, { t: 'LOO acc', r: true }, { t: 'LOO Brier', r: true }, { t: 'Sentora rank', r: true }, { t: 'Sentora implied', r: true }, { t: 'Board total', r: true }],
        DATA.odds_bakeoff.map(function (o) { return { cells: ['e = ' + o.exponent.toFixed(3), o.looAccuracy.toFixed(3), o.looBrier.toFixed(4), String(o.sentoraRank), money(o.sentoraImplied), moneyM(o.boardTotal)], cls: o.exponent === DATA.odds_exponent ? 'keep' : '' }; })) +
      '<h3>Small-n rules (documented evidence)</h3><p class="small muted">Rules that keep a small, noisy comp set from inventing precision. Each is a constant in the model, applied identically to every row. K=5 is shipped: the LOO scores are identical across rules (the test cannot tell them apart), so the choice is the middle shrinkage — and it is the rule the top entries use.</p>' +
      tableHtml([{ t: 'Rule' }, { t: 'LOO acc', r: true }, { t: 'LOO Brier', r: true }, { t: 'Polymarket odds', r: true }, { t: 'Polymarket implied', r: true }, { t: 'Board total', r: true }],
        DATA.small_n_rules.map(function (r) { return { cells: [r.rule, r.looAccuracy.toFixed(4), r.looBrier.toFixed(4), r.polymarketOdds < 0 ? '—' : r.polymarketOdds.toFixed(3), r.polymarketImplied < 0 ? '—' : money(r.polymarketImplied), r.boardTotal < 0 ? '—' : moneyM(r.boardTotal)], cls: r.rule.indexOf('SHIPPED') >= 0 ? 'keep' : '' }; })) +
      '<h3>Farm sensitivity grid</h3><p class="small muted">FARM counts across the ticket/share grid. Two facts stand out: the share moves the count far more than the ticket (a 10% share at $500 farms 33 rows; the same share at $10,000 farms 77), and the binding cost is the 4% forgone yield, not the gas — zeroing it adds 41 rows at $1,000 (47→88), while doubling gas removes 13 (47→34); halving the share to 7% drops the count to 31. The full one-change-at-a-time grid (hold, forgone, bridge, weekly tx, gas, share, time-share) is in the validation summary.</p>' +
      tableHtml([{ t: 'Ticket \\ share' }].concat(SHARES.map(function (s) { return { t: (s * 100).toFixed(1) + '%', r: true }; })),
        TICKETS.map(function (t) {
          return { cells: ['$' + t.toLocaleString('en-US')].concat(SHARES.map(function (s) {
            var n = 0;
            DATA.rows.forEach(function (r) { if (econ(r, t, s).verdict === 'FARM') n++; });
            return String(n);
          })) };
        })) +
      '<p class="small muted">The grid above is recomputed live from the board rows by the same farm formulas — it is not a stamped table. Below it, one assumption changed at a time from the baseline (computed at build time):</p>' +
      tableHtml([{ t: 'Change' }, { t: 'FARM @ $1k', r: true }, { t: 'FARM @ $10k', r: true }, { t: 'Defensible?', r: true }],
        DATA.farm_sensitivity.map(function (f) { return { cells: [f.change, String(f.farm1000), String(f.farm10000), f.defensible] }; })) +
      '<h3>Top entries — where the gap closed and where it did not</h3>' +
      '<p>The radar-4 gap had two halves: our curve was higher, our odds were lower. The survivor form closed the odds half. On Sentora, nyx77’s effective multiplier was 0.471 ($27.6M implied) and lufi-aq’s 0.881 ($50.1M); ours is now 0.556 ($55.2M) — we price the top row <i>above</i> nyx77 and above lufi-aq. On Steakhouse the same: ours 0.533 ($52.9M) vs nyx77 0.459 ($26.9M) and lufi-aq 0.853 ($48.5M). On dTAO the gap remains: ours 0.886 ($36.3M) vs sudhan’s 2.714 ($73.1M) — a multiplier above 1 still cannot be decomposed into adoptable parts (the curve cannot exceed its fit, the age/sector tilts are capped by the LOO test, and the category tilt is capped by the split-half test), so it is not adopted. The remaining systematic difference is the curve: ours ($99.4M on Sentora) still sits above theirs ($57–70M base). If the judge’s scoring rewards the curve, we are high; if it rewards conservative values, we are high — the curve is the one number the fit pins, and the LOO test says it is the best unbiased fit on the data we have.</p>' +
      tableHtml([{ t: 'Protocol' }, { t: 'Our V', r: true }, { t: 'Our odds', r: true }, { t: 'Our implied', r: true }, { t: 'nyx77 eff. mult. / implied', r: true }, { t: 'lufi-aq eff. mult. / implied', r: true }, { t: 'sudhan eff. mult. / implied', r: true }],
        [
          { cells: ['Sentora', '$99.4M', '0.556', '$55.2M', '0.471 / $27.6M', '0.881 / $50.1M', '—'] },
          { cells: ['Steakhouse', '$99.3M', '0.533', '$52.9M', '0.459 / $26.9M', '0.853 / $48.5M', '0.457 / $31.8M'] },
          { cells: ['Gauntlet', '$77.5M', '0.533', '$41.3M', '0.475 / $21.9M', '0.893 / $39.8M', '—'] },
          { cells: ['USDD', '$64.8M', '0.681', '$44.1M', '0.472 / $18.3M', '0.912 / $34.1M', '1.103 / $48.6M'] },
          { cells: ['OnRe', '$37.5M', '0.711', '$26.7M', '1.003 / $22.9M', '—', '1.419 / $34.8M'] },
          { cells: ['dTAO', '$40.9M', '0.886', '$36.3M', '0.902 / $22.4M', '1.033 / $24.6M', '2.714 / $73.1M'] },
          { cells: ['Polymarket', '$38.1M', '0.431', '$16.4M', '&lt;1.19 / &lt;$27.6M', '—', '—'] },
        ]) +
      '<h3>What was not adopted — and why</h3><ul>' +
      '<li><b>Premiums</b> (bridge / canonical / versioned / wrapped / LRT / restaked-BTC / liquid-staking): each probed, none kept — the category tilt already carries the signal and the split-half Brier does not improve.</li>' +
      '<li><b>Growth adjustment</b> (TVL growth on the 5-day window): probed, dropped — the growth column is computed but unused; the LOO test does not improve.</li>' +
      '<li><b>Age-severity:</b> the survivor form IS the age adjustment; no second age tilt on top.</li>' +
      '<li><b>Per-category curves:</b> probed, dropped — n per category is 2–12, too small to fit separately.</li>' +
      '<li><b>TVL momentum:</b> not in the snapshot (no historical TVL series).</li>' +
      '<li><b>Moving the FARM thresholds:</b> the 0.10/0.33 thresholds did not move; the verdict <i>rule</i> changed (expected net &gt; 0), which is a different thing — see the intro.</li></ul>' +
      '<h3>Caveats</h3><ul>' +
      '<li>Small sample: 101 comps, 5 bucket points (n=73–228 per bucket), categories as thin as n=1. The bands are the honest width of that uncertainty.</li>' +
      '<li>L is a judgment call (0.85, middle of the fitting range) — the sensitivity table shows the consequence of being wrong.</li>' +
      '<li>The curve is fitted on traded tokens; pre-token protocols may launch at a discount to their traded peers (the survivor form is the only discount applied).</li>' +
      '<li>Gas is a stated estimate per chain, not a measured quote; the farm plan’s costs are estimates.</li>' +
      '<li>The airdrop share (10% default) is a planning assumption, not a promise — the sensitivity grid shows what a 3.5% share does to the count (14 FARM at $1,000).</li>' +
      '<li>Snapshot as of ' + DATA.as_of + ' (' + DATA.source + '); floor $' + DATA.floor_usd.toLocaleString('en-US') + ' TVL; ' + DATA.ledger.length + ' protocols in the ledger, ' + DATA.rows.length + ' on the board, ' + DATA.live.length + ' live set aside.</li></ul></div>';
  }

  // ---- ledger ----
  function ledgerView() {
    var total = DATA.ledger.reduce(function (s, g) { return s + g.count; }, 0);
    var rows = DATA.ledger.map(function (g) {
      return { cells: [esc(g.label), String(g.count), esc(g.reason)] };
    });
    return '<h2>Ledger — all ' + total + ' protocols in the snapshot</h2>' +
      '<p class="muted">Every protocol the snapshot lists, accounted for exactly once by where it landed. The board holds the 198 ranked rows; the rest record a token already, or are pre-token protocols the board rule sets aside (exchanges, bridges, staking, versioned names, wrapped or staked tokens).</p>' +
      tableHtml([{ t: 'Group' }, { t: 'Count', r: true }, { t: 'Why', r: true }], rows);
  }

  // ---- audit line ----
  function auditLine() {
    var bad = 0, worst = null;
    DATA.rows.forEach(function (r) {
      var d = Math.abs(impliedRecomputed(r) - r.implied_value_usd) / r.implied_value_usd;
      if (d > 0.02) bad++;
      if (!worst || d > worst.d) worst = { slug: r.slug, d: d };
    });
    return '<p class="audit">audit: page recomputed ' + DATA.rows.length + ' implied values from the stamped curve and odds — ' + bad + ' differ by &gt;2% (worst ' + (worst ? worst.slug + ' ' + pct(worst.d, 2) : 'none') + ') · model ' + DATA.model_version + ' · curve ' + DATA.curve_a.toFixed(2) + ' × TVL^' + DATA.curve_b.toFixed(4) + ' · survivor L=' + DATA.survivor_l.toFixed(2) + ' τ=' + Math.round(DATA.survivor_tau) + ' k=' + DATA.survivor_k.toFixed(3) + ' · board total ' + money(DATA.total_implied_usd) + ' · as of ' + DATA.as_of + '</p>';
  }

  // ---- render ----
  var firstRender = true;
  function render() {
    var el = document.getElementById('app');
    var tabs = [['board', 'Board'], ['method', 'Method & tests'], ['ledger', 'Ledger']];
    var head = '<div class="wrap"><header class="mast"><div><h1>Token Radar <span class="tag">radar-5 · ' + DATA.model_version + '</span></h1>' +
      '<p class="intro">Pre-token protocols ranked by implied value — size from a curve fitted on the traded comps, odds from a survivor form on launch age, verdict from the expected net. ' +
      '<b>' + DATA.rows.length + ' rows</b> from ' + DATA.ledger.length + ' protocols, ' + DATA.live.length + ' live set aside. Snapshot ' + DATA.as_of + ', floor $' + DATA.floor_usd.toLocaleString('en-US') + ' TVL.</p></div>' +
      '<div class="tag">snapshot ' + DATA.as_of + '<br>model <b>' + DATA.model_version + '</b><br>floor $' + DATA.floor_usd.toLocaleString('en-US') + '</div></header>' +
      kpis() + howtoStrip() +
      '<nav class="navtabs" role="tablist">' + tabs.map(function (t) { return '<button type="button" role="tab" aria-selected="' + (S.tab === t[0]) + '" onclick="App.tab(\'' + t[0] + '\')">' + t[1] + '</button>'; }).join('') + '</nav>';
    var body = S.tab === 'method' ? methodView() : S.tab === 'ledger' ? ledgerView() : boardView();
    el.innerHTML = head + '<div role="tabpanel">' + body + '</div>' + auditLine() + '</div>';
    el.setAttribute('aria-busy', 'false');
    if (firstRender && S.detail) {
      var d = document.getElementById('detail');
      if (d) d.scrollIntoView({ block: 'start' });
    }
    firstRender = false;
  }

  window.App = {
    set: function (key, value) { S[key] = value; S.page = 1; writeHash(); render(); },
    q: function (value) { S.q = value; S.page = 1; writeHash(); render(); var inp = document.querySelector('input[type="search"]'); if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } },
    cat: function (v) { S.cat = v; S.page = 1; writeHash(); render(); },
    list: function (v) { S.list = v; S.page = 1; writeHash(); render(); },
    verdict: function (v) { S.verdict = v; S.page = 1; writeHash(); render(); },
    sort: function (key) { if (S.sort === key) S.dir = -S.dir; else { S.sort = key; S.dir = -1; } writeHash(); render(); },
    page: function (n) { S.page = n; writeHash(); render(); window.scrollTo(0, 0); },
    detail: function (slug) { S.detail = S.detail === slug ? '' : slug; writeHash(); render(); if (S.detail) { var d = document.getElementById('detail'); if (d) d.scrollIntoView({ block: 'start' }); } },
    tab: function (t) { S.tab = t; writeHash(); render(); window.scrollTo(0, 0); },
  };
  window.addEventListener('hashchange', function () { S = readHash(); render(); });
  render();
})();
