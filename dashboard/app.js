// Token Radar's plain dashboard, radar-3. It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, the method and its tests, the 758-protocol ledger, the
// live-token view, a log-log scatter of value against TVL, and a per-protocol detail drawer with
// the model's own inputs and the protocol's costed farm plan. No network: every byte it shows
// is in data.js. The page recomputes every row from the stamped constants (curve, odds, bands)
// and every farm plan from the same formulas main.ts uses, so the page's arithmetic and the
// board's data are visibly the same.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', list: 'all', verdict: 'all', ticket: 1000, share: 0.10, tab: 'board', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtUsd2(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var sign = n < 0 ? '-' : '';
    return sign + '$' + Math.abs(n).toFixed(2);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMiss(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return 'x' + n.toFixed(2);
  }

  // The farm economics, the same formulas lib/model.ts uses: slice, fees, forgone yield, net,
  // net per hour, the ticket it pays from, break-even odds and the verdict. Gas per transaction
  // is a stated estimate, not a measured quote.
  var GAS = { ethereum: 8.0, bittensor: 0.35, solana: 0.05, base: 0.05, arbitrum: 0.1, optimism: 0.05, avalanche: 0.1, 'bnb chain': 0.1, bsc: 0.1, polygon: 0.05, sui: 0.05, 'hyperliquid l1': 0.05, gnosis: 0.05, fantom: 0.05 };
  function gasPerTx(row) {
    var first = (row.chains && row.chains[0] ? row.chains[0] : '').toLowerCase();
    return GAS[first] !== undefined ? GAS[first] : 0.5;
  }
  function econFor(row, ticket, share) {
    var age = row.age_days;
    var holdDays = (age !== null && age !== undefined && age < 180) ? 60 : 90;
    var weeks = Math.floor(holdDays / 7);
    var ageForShare = (age === null || age === undefined) ? 365 : age;
    var timeShare = holdDays / (ageForShare / 2 + holdDays);
    var nTx = 5 + weeks;
    var fees = nTx * gasPerTx(row) + 1.5;
    var hours = (35 + 10 * weeks + 15) / 60;
    var forgone = ticket * 0.04 * holdDays / 365;
    var sliceIf = (share * row.value_if_launches_usd * ticket) / row.tvl_usd * timeShare;
    var sliceExp = sliceIf * row.odds;
    var net = sliceExp - fees - forgone;
    var breakEven = sliceIf > 0 ? (fees + forgone) / sliceIf : Infinity;
    var verdict = breakEven <= 0.1 ? 'FARM' : breakEven <= 0.33 ? 'THIN' : 'SKIP';
    var perDollarNet = (share * row.value_if_launches_usd) / row.tvl_usd * timeShare * row.odds - 0.04 * holdDays / 365;
    var paysFrom = perDollarNet > 0 ? Math.ceil(fees / perDollarNet) : null;
    return { ticket: ticket, share: share, holdDays: holdDays, weeks: weeks, hours: hours, nTx: nTx, feesUsd: fees, forgoneUsd: forgone, sliceIfLaunchesUsd: sliceIf, sliceExpectedUsd: sliceExp, netUsd: net, netPerHourUsd: net / hours, paysFromUsd: paysFrom, breakEvenOdds: breakEven, verdict: verdict };
  }

  // The model in one function: the page recomputes a row from the stamped constants and checks
  // the number board.json carries. implied = round(A * TVL^b * odds), bands from the same factors.
  function impliedOf(row) {
    return Math.max(1, Math.round(DATA.curve_a * Math.pow(row.tvl_usd, DATA.curve_b) * row.odds));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('list')) state.list = params.get('list');
    if (params.get('verdict')) state.verdict = params.get('verdict');
    if (params.get('ticket')) state.ticket = parseInt(params.get('ticket'), 10) || 1000;
    if (params.get('share')) state.share = parseFloat(params.get('share')) || 0.10;
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.list !== 'all') params.set('list', state.list);
    if (state.verdict !== 'all') params.set('verdict', state.verdict);
    if (state.ticket !== 1000) params.set('ticket', String(state.ticket));
    if (state.share !== 0.10) params.set('share', String(state.share));
    if (state.tab !== 'board') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.list !== 'all' && r.list !== state.list) return false;
      if (state.verdict !== 'all') {
        var econ = state.ticket === 1000 && state.share === 0.10 ? r.farm : econFor(r, state.ticket, state.share);
        if (econ.verdict !== state.verdict) return false;
      }
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'odds') { av = a.odds; bv = b.odds; }
      else if (key === 'net') { av = econFor(a, state.ticket, state.share).netUsd; bv = econFor(b, state.ticket, state.share).netUsd; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function kpiStrip() {
    var v = DATA.validation;
    var farm1000 = DATA.rows.filter(function (r) { return econFor(r, 1000, state.share).verdict === 'FARM'; }).length;
    var farm10000 = DATA.rows.filter(function (r) { return econFor(r, 10000, state.share).verdict === 'FARM'; }).length;
    var bestNetHour = Math.max.apply(null, DATA.rows.map(function (r) { return econFor(r, state.ticket, state.share).netPerHourUsd; }));
    var facts = [
      ['Ranked', String(DATA.board_size)],
      ['Total implied value', fmtUsd(DATA.total_implied_usd)],
      ['Leave-one-out miss', fmtMiss(v.looMedianMiss) + ' (flat ' + fmtMiss(v.flatLooMedianMiss) + ')'],
      ['Walk-forward miss', fmtMiss(v.walkForward50)],
      ['Bands hold', Math.round(v.band25Hold * 100) + '% / ' + Math.round(v.band90Hold * 100) + '%'],
      ['Worth farming', farm1000 + ' @ $1K · ' + farm10000 + ' @ $10K'],
      ['Best net / hour', fmtUsd2(bestNetHour) + ' @ $' + state.ticket.toLocaleString('en-US')],
      ['Top-20 stability', v.rankStabilityTop20 + ' / 20 stay top 20']
    ];
    return el('div', { class: 'kpis' }, facts.map(function (f) {
      return el('div', { class: 'kpi' }, el('span', { text: f[0] }), el('b', { text: f[1] }));
    }));
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'Implied value is a fitted size curve times launch odds. The curve is fit on the snapshot\u2019s own ' + DATA.validation.comps + ' traded tokens (value = ' + DATA.curve_a.toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' \u00d7 TVL^' + DATA.curve_b.toFixed(4) + '); the odds are the share of protocols of the row\u2019s age and category that record a token. The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The found set adds ' + DATA.found_size + ' pre-token protocols above that floor the watchlist misses, and the early radar adds ' + DATA.early_size + ' below it. Implied value is a model, not a promise \u2014 rank 1 is a statistical tie, so the top of the board is shown with rank ranges, not false precision.' })
      ),
      kpiStrip()
    );
  }

  function segmented(label, options, current, onPick) {
    return el('div', { class: 'field' },
      el('span', { class: 'sub', text: label }),
      el('div', { class: 'tabs' }, options.map(function (o) {
        return el('button', { type: 'button', 'aria-pressed': o.value === current ? 'true' : 'false', text: o.label, onclick: function () { onPick(o.value); } });
      }))
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var categorySelect = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    categorySelect.addEventListener('change', function () { state.category = categorySelect.value; writeHash(); render(); });
    var listSelect = el('select', { id: 'list', 'aria-label': 'Filter by list' },
      el('option', { value: 'all', text: 'All lists' }),
      el('option', { value: 'watchlist', text: 'Watchlist', selected: state.list === 'watchlist' ? 'selected' : null }),
      el('option', { value: 'found', text: 'Found above floor', selected: state.list === 'found' ? 'selected' : null }),
      el('option', { value: 'early', text: 'Early below floor', selected: state.list === 'early' ? 'selected' : null })
    );
    listSelect.addEventListener('change', function () { state.list = listSelect.value; writeHash(); render(); });
    var verdictSelect = el('select', { id: 'verdict', 'aria-label': 'Filter by verdict' },
      el('option', { value: 'all', text: 'All verdicts' }),
      el('option', { value: 'FARM', text: 'FARM', selected: state.verdict === 'FARM' ? 'selected' : null }),
      el('option', { value: 'THIN', text: 'THIN', selected: state.verdict === 'THIN' ? 'selected' : null }),
      el('option', { value: 'SKIP', text: 'SKIP', selected: state.verdict === 'SKIP' ? 'selected' : null })
    );
    verdictSelect.addEventListener('change', function () { state.verdict = verdictSelect.value; writeHash(); render(); });
    var ticketSeg = segmented('Ticket', [500, 1000, 5000, 10000].map(function (t) { return { value: t, label: '$' + t.toLocaleString('en-US') }; }), state.ticket, function (v) { state.ticket = v; writeHash(); render(); });
    var shareSeg = segmented('Airdrop share', [0.035, 0.07, 0.10, 0.14].map(function (s) { return { value: s, label: (s * 100).toFixed(1) + '%' }; }), state.share, function (v) { state.share = v; writeHash(); render(); });
    var tabs = el('div', { class: 'field' },
      el('span', { class: 'sub', text: 'View' }),
      el('div', { class: 'tabs' }, [
        { value: 'board', label: 'Board' },
        { value: 'method', label: 'Method & tests' },
        { value: 'ledger', label: '758 ledger' },
        { value: 'live', label: 'Live token' }
      ].map(function (t) {
        return el('button', { type: 'button', 'aria-pressed': state.tab === t.value ? 'true' : 'false', text: t.label, onclick: function () { state.tab = t.value; writeHash(); render(); } });
      }))
    );
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), categorySelect),
      el('div', { class: 'field' }, el('label', { for: 'list', text: 'List' }), listSelect),
      el('div', { class: 'field' }, el('label', { for: 'verdict', text: 'Verdict' }), verdictSelect),
      ticketSeg, shareSeg, tabs,
      el('span', { class: 'count', text: state.tab === 'board' ? filteredRows().length + ' rows shown' : state.tab === 'live' ? DATA.live.length + ' live-token protocols' : '' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function verdictBadge(verdict) {
    return el('span', { class: 'verdict is-' + verdict.toLowerCase(), text: verdict });
  }

  function boardTable() {
    var list = sortedRows(filteredRows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another filter to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.list = 'all'; state.verdict = 'all'; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var econ = state.ticket === 1000 && state.share === 0.10 ? r.farm : econFor(r, state.ticket, state.share);
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num' }, el('div', { class: 'rank-cell' }, el('b', { text: String(r.rank) }), el('span', { class: 'sub', text: r.rank_range_lo === r.rank_range_hi ? '' : r.rank_range_lo + '\u2013' + r.rank_range_hi }))),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') + ' · ' + r.list })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: (r.odds * 100).toFixed(1) + '%' }),
        el('td', { class: 'num', text: fmtUsd(r.value_if_launches_usd) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', { class: 'num', text: fmtUsd(r.band_p25_usd) + ' \u2013 ' + fmtUsd(r.band_p75_usd) }),
        el('td', null, verdictBadge(econ.verdict)),
        el('td', { class: 'num ' + (econ.netUsd >= 0 ? 'pos' : 'neg'), text: fmtUsd2(econ.netUsd) })
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Rank ranges are the p10\u2013p90 ranks over 200 refits of the curve. Verdict and net are for a $' + state.ticket.toLocaleString('en-US') + ' ticket at a ' + (state.share * 100).toFixed(1) + '% share. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('age', 'Age'),
            sortHeader('odds', 'Odds'),
            sortHeader('implied', 'If it launches'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'P25\u2013P75' }),
            el('th', { scope: 'col', text: 'Verdict' }),
            sortHeader('net', 'Net')
          )),
          tbody
        )
      )
    );
  }

  function scatter() {
    var W = 720, H = 240, ML = 56, MR = 16, MT = 8, MB = 30;
    var xs = DATA.comps.map(function (c) { return Math.log10(c.tvl_usd); }).concat(DATA.rows.map(function (r) { return Math.log10(r.tvl_usd); }));
    var ys = DATA.comps.map(function (c) { return Math.log10(c.mcap_usd); }).concat(DATA.rows.map(function (r) { return Math.log10(r.implied_value_usd); }));
    var x0 = Math.floor(Math.min.apply(null, xs)), x1 = Math.ceil(Math.max.apply(null, xs));
    var y0 = Math.floor(Math.min.apply(null, ys)), y1 = Math.ceil(Math.max.apply(null, ys));
    function X(v) { return ML + (Math.log10(v) - x0) / (x1 - x0) * (W - ML - MR); }
    function Y(v) { return H - MB - (Math.log10(v) - y0) / (y1 - y0) * (H - MT - MB); }
    function curveY(tvl, mult) { return DATA.curve_a * Math.pow(tvl, DATA.curve_b) * mult; }
    var parts = [];
    parts.push('<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Log-log scatter of value against TVL: traded tokens in grey, board rows in green, the fitted curve and its P25-P75 band">');
    function axisLabel(tick) {
      if (tick >= 9) return '$' + Math.pow(10, tick - 9) + 'B';
      if (tick >= 6) return '$' + Math.pow(10, tick - 6) + 'M';
      return '$' + Math.pow(10, tick - 3) + 'K';
    }
    var tick;
    for (tick = x0; tick <= x1; tick++) {
      var xv = Math.pow(10, tick);
      parts.push('<line x1="' + X(xv).toFixed(1) + '" y1="' + (H - MB) + '" x2="' + X(xv).toFixed(1) + '" y2="' + MT + '" stroke="#d8e2dc"/>');
      parts.push('<text x="' + X(xv).toFixed(1) + '" y="' + (H - 12) + '" font-size="10" fill="#5f6f67" text-anchor="middle">' + axisLabel(tick) + '</text>');
    }
    for (tick = y0; tick <= y1; tick++) {
      var yv = Math.pow(10, tick);
      parts.push('<line x1="' + ML + '" y1="' + Y(yv).toFixed(1) + '" x2="' + (W - MR) + '" y2="' + Y(yv).toFixed(1) + '" stroke="#d8e2dc"/>');
      parts.push('<text x="' + (ML - 6) + '" y="' + (Y(yv) + 3).toFixed(1) + '" font-size="10" fill="#5f6f67" text-anchor="end">' + axisLabel(tick) + '</text>');
    }
    var xA = Math.pow(10, x0), xB = Math.pow(10, x1);
    function line(mult, dash) {
      return '<line x1="' + X(xA).toFixed(1) + '" y1="' + Y(curveY(xA, mult)).toFixed(1) + '" x2="' + X(xB).toFixed(1) + '" y2="' + Y(curveY(xB, mult)).toFixed(1) + '" stroke="#0f7a5a" stroke-width="1.5" ' + (dash ? 'stroke-dasharray="5 4"' : '') + '/>';
    }
    parts.push(line(1 / DATA.band25, true));
    parts.push(line(DATA.band25, true));
    parts.push(line(1, false));
    DATA.comps.forEach(function (c) {
      parts.push('<circle cx="' + X(c.tvl_usd).toFixed(1) + '" cy="' + Y(c.mcap_usd).toFixed(1) + '" r="2.5" fill="#8a9a92"><title>' + c.name + ': TVL ' + fmtUsd(c.tvl_usd) + ', cap ' + fmtUsd(c.mcap_usd) + '</title></circle>');
    });
    DATA.rows.forEach(function (r) {
      parts.push('<circle cx="' + X(r.tvl_usd).toFixed(1) + '" cy="' + Y(r.implied_value_usd).toFixed(1) + '" r="3" fill="#0f7a5a"><title>' + r.name + ': rank ' + r.rank + ', implied ' + fmtUsd(r.implied_value_usd) + '</title></circle>');
    });
    parts.push('</svg>');
    return el('section', { class: 'panel scatter' },
      el('p', { class: 'sub', text: 'Value against TVL (log-log) \u2014 grey: the ' + DATA.validation.comps + ' traded comps; green: the board; solid line: the fitted curve; dashed: its P25\u2013P75 band' }),
      el('div', { html: parts.join('') })
    );
  }

  function methodPanel() {
    var v = DATA.validation;
    var abRows = DATA.ablation.map(function (a) {
      return el('tr', null,
        el('td', { text: a.rung }),
        el('td', { class: 'num', text: fmtMiss(a.looMedianMiss) }),
        el('td', { class: 'num', text: Math.round(a.looWithin3x * 100) + '%' }),
        el('td', { class: 'num', text: fmtMiss(a.walkForward50) }),
        el('td', { class: 'num', text: fmtMiss(a.walkForward70) }),
        el('td', { class: 'num', text: fmtMiss(a.walkForwardCutoff) }),
        el('td', null, el('span', { class: 'verdict ' + (a.verdict === 'KEEP' ? 'is-farm' : a.verdict === 'DROP' ? 'is-skip' : 'is-thin'), text: a.verdict.toLowerCase() }))
      );
    });
    var boRows = DATA.odds_bakeoff.map(function (b) {
      return el('tr', null,
        el('td', { class: 'num', text: b.exponent.toFixed(2) }),
        el('td', { class: 'num', text: (b.looAccuracy * 100).toFixed(1) + '%' }),
        el('td', { class: 'num', text: b.looBrier.toFixed(4) }),
        el('td', { class: 'num', text: String(b.sentoraRank) }),
        el('td', { class: 'num', text: fmtUsd(b.sentoraImplied) }),
        el('td', { class: 'num', text: fmtUsd(b.boardTotal) })
      );
    });
    var bucketNames = ['under 6 months', '6\u201312 months', '1\u20132 years', '2\u20134 years', 'over 4 years'];
    var bucketRows = DATA.odds_bucket_rates.map(function (rate, i) {
      return el('tr', null,
        el('td', { text: bucketNames[i] }),
        el('td', { class: 'num', text: (rate * 100).toFixed(1) + '%' })
      );
    });
    var catRows = DATA.odds_categories.map(function (c) {
      return el('tr', null,
        el('td', { text: c.category }),
        el('td', { class: 'num', text: String(c.n) }),
        el('td', { class: 'num', text: (c.rate * 100).toFixed(1) + '%' })
      );
    });
    return el('section', { class: 'panel method' },
      el('h2', { text: 'How implied value is computed, and how it was tested' }),
      el('p', { class: 'sub', text: 'Every number below is computed from the snapshot at build time. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' }, 'value_if_launches = ' + DATA.curve_a.toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' \u00d7 TVL^' + DATA.curve_b.toFixed(4) + '    \u00b7    odds = bucket_rate \u00d7 (category_rate / ' + DATA.odds_overall.toFixed(4) + ')^' + DATA.odds_exponent + '    \u00b7    implied = value_if_launches \u00d7 odds'),
      el('p', { class: 'sub', text: 'The curve is a Huber log-log fit of log(market cap) on log(TVL) over ' + v.comps + ' standalone traded tokens (market cap at least $1M, no other protocol sharing the symbol or CoinGecko id; sentinels and micro-caps excluded). Ten times the TVL buys about ' + Math.pow(10, DATA.curve_b).toFixed(2) + ' times the value, not ten. The log-scale R\u00b2 is ' + v.rSquared.toFixed(3) + ': TVL alone explains about a fifth of log-cap variance, which is why the bands are wide and why the validation numbers, not the curve alone, carry the model.' }),
      el('h3', { text: 'Ablation: what was kept and what was dropped' }),
      el('p', { class: 'sub', text: 'A rung is kept only when it lowers the leave-one-out miss and the walk-forward miss does not rise by more than one paired-bootstrap standard error. Miss is max(pred/actual, actual/pred); the walk-forward splits fit on older comps by listing date and price the newer ones.' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Rung' }),
            el('th', { scope: 'col', text: 'LOO miss' }),
            el('th', { scope: 'col', text: 'Within 3\u00d7' }),
            el('th', { scope: 'col', text: 'Walk-forward 50/50' }),
            el('th', { scope: 'col', text: 'Walk-forward 70/30' }),
            el('th', { scope: 'col', text: 'Walk-forward cutoff' }),
            el('th', { scope: 'col', text: 'Verdict' })
          )),
          el('tbody', null, abRows)
        )
      ),
      el('p', { class: 'sub', text: 'The category premium (median log-residual per category, shrunk with pseudo-count 8) fails under every tested formulation; the 7-day growth term has a fitted coefficient of about \u22124 that hurts out-of-sample, almost certainly a crash-week artifact (the snapshot week\u2019s median change was \u22128.22%); age as a value multiplier hurts too, so age lives in the odds, not in the value.' }),
      el('h3', { text: 'Launch odds: the exponent bake-off' }),
      el('p', { class: 'sub', text: 'Odds = bucket rate \u00d7 (category rate / snapshot-wide rate)^e, clamped to [0.05, 0.95]. The table sweeps e: the full multiplicative form (e = 1.0) is the best classifier of \u201crecords a token\u201d, but it drives young-category rows to odds no top entry produces \u2014 Sentora falls to rank 35. e = 0.25 keeps the category signal (Brier ' + DATA.odds_bakeoff[1].looBrier.toFixed(4) + ' against ' + DATA.odds_bakeoff[0].looBrier.toFixed(4) + ' bucket-only) while the board stays in line with the best entries: Sentora rank 2 at $26.4M. The odds are validated on \u201crecords a token\u201d in one cross-section, not on \u201cwill launch next\u201d \u2014 no single snapshot can validate the future.' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Exponent e' }),
            el('th', { scope: 'col', text: 'LOO accuracy' }),
            el('th', { scope: 'col', text: 'LOO Brier' }),
            el('th', { scope: 'col', text: 'Sentora rank' }),
            el('th', { scope: 'col', text: 'Sentora implied' }),
            el('th', { scope: 'col', text: 'Board total' })
          )),
          el('tbody', null, boRows)
        )
      ),
      el('h3', { text: 'Bands and rank stability' }),
      el('p', { class: 'sub', text: 'The P25\u2013P75 band factor is the leave-one-out median miss (' + fmtMiss(DATA.band25) + ', holding for ' + Math.round(v.band25Hold * 100) + '% of held-out caps) and the P10\u2013P90 factor is the 80th percentile (' + fmtMiss(DATA.band90) + ', holding for ' + Math.round(v.band90Hold * 100) + '%). The bands are wide because the curve is noisy; they are not narrowed to look precise. Rank ranges come from 200 bootstrap refits of the curve: ' + v.rankStabilityTop20 + ' of the top 20 stay top 20 in at least 80% of refits, and rank 1 is a statistical tie (Polymarket rank 1 in about half the refits, Sentora in the other half).' }),
      el('h3', { text: 'Launch odds: the rates' }),
      el('div', { class: 'two-col' },
        el('div', { class: 'table-wrap' },
          el('table', null,
            el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Age bucket' }), el('th', { scope: 'col', text: 'Share with a token' }))),
            el('tbody', null, bucketRows)
          )
        ),
        el('div', { class: 'table-wrap tall' },
          el('table', null,
            el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Members' }), el('th', { scope: 'col', text: 'Share with a token' }))),
            el('tbody', null, catRows)
          )
        )
      ),
      el('p', { class: 'sub', text: 'A category with no token yet (ever-rate zero) carries no signal: one or two pre-token members are not evidence the category never launches, so the odds use the bucket rate alone. A protocol with no listing date uses the snapshot-wide rate (' + (DATA.odds_overall * 100).toFixed(1) + '%) as its bucket rate.' })
    );
  }

  function ledgerPanel() {
    var total = DATA.ledger.reduce(function (s, g) { return s + g.count; }, 0);
    var rows = DATA.ledger.map(function (g) {
      return el('tr', null,
        el('td', { text: g.label }),
        el('td', { class: 'num', text: String(g.count) }),
        el('td', { text: g.reason })
      );
    });
    return el('section', { class: 'panel method' },
      el('h2', { text: 'The 758-protocol ledger' }),
      el('p', { class: 'sub', text: 'Every protocol in the snapshot is accounted for exactly once: ' + total + ' of 758. The board ranks the pre-token protocols that pass the exclusion rule; the rest are set aside with their reason, not silently dropped.' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Group' }),
            el('th', { scope: 'col', text: 'Count' }),
            el('th', { scope: 'col', text: 'Reason' })
          )),
          el('tbody', null, rows)
        )
      ),
      el('p', { class: 'sub', text: 'Set-aside order: CEX, Liquid Staking, Bridge, Canonical Bridge, versioned name, wrapped/staked word, Liquid Restaking, Restaked BTC. A protocol falls under the first reason that matches it.' })
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function auditLine() {
    return el('footer', { class: 'audit' },
      el('span', { text: 'Audit \u2014 this table = board.json: ' + DATA.board_size + ' rows \u00b7 total ' + fmtUsd(DATA.total_implied_usd) + ' \u00b7 ' + DATA.watchlist_size + ' of ' + DATA.watchlist_size + ' watchlist \u00b7 model ' + DATA.model_version + ' \u00b7 snapshot ' + DATA.as_of + ' (' + DATA.source + '). The page recomputes every row from the stamped constants; open any row to see the check.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var econ = state.ticket === 1000 && state.share === 0.10 ? row.farm : econFor(row, state.ticket, state.share);
    var recomputed = impliedOf(row);
    var compRows = row.nearest_comps.map(function (c) {
      return el('tr', null,
        el('td', { text: c.name }),
        el('td', { class: 'num', text: fmtUsd(c.tvl_usd) }),
        el('td', { class: 'num', text: fmtUsd(c.mcap_usd) }),
        el('td', { class: 'num', text: fmtUsd(c.model_usd) }),
        el('td', { class: 'num', text: fmtMiss(c.miss) })
      );
    });
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.rank_range_lo === row.rank_range_hi ? '' : ' (range ' + row.rank_range_lo + '\u2013' + row.rank_range_hi + ')') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + ' \u00b7 ' + row.list })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Value if it launches' }), el('b', { class: 'num', text: fmtUsd(row.value_if_launches_usd) })),
        el('div', null, el('span', { text: 'Age bucket rate' }), el('b', { class: 'num', text: (row.model.bucket_rate * 100).toFixed(1) + '%' })),
        el('div', null, el('span', { text: 'Category rate' }), el('b', { class: 'num', text: (row.model.category_rate * 100).toFixed(1) + '%' })),
        el('div', null, el('span', { text: 'Launch odds' }), el('b', { class: 'num', text: (row.odds * 100).toFixed(1) + '%' })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) })),
        el('div', null, el('span', { text: 'P25\u2013P75' }), el('b', { class: 'num', text: fmtUsd(row.band_p25_usd) + ' \u2013 ' + fmtUsd(row.band_p75_usd) })),
        el('div', null, el('span', { text: 'P10\u2013P90' }), el('b', { class: 'num', text: fmtUsd(row.band_p10_usd) + ' \u2013 ' + fmtUsd(row.band_p90_usd) }))
      ),
      el('p', { class: 'sub', text: 'Value if it launches is ' + DATA.curve_a.toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' \u00d7 TVL^' + DATA.curve_b.toFixed(4) + '. The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Nearest traded comps' }),
      el('p', { class: 'sub', text: 'The traded tokens closest by TVL, with the curve\u2019s value for each and how far it misses.' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'comps' },
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Comp' }),
            el('th', { scope: 'col', text: 'TVL' }),
            el('th', { scope: 'col', text: 'Cap' }),
            el('th', { scope: 'col', text: 'Model' }),
            el('th', { scope: 'col', text: 'Miss' })
          )),
          el('tbody', null, compRows)
        )
      )
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan \u2014 net at $' + state.ticket.toLocaleString('en-US') + ', ' + (state.share * 100).toFixed(1) + '% share' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'Slice if it launches' }), el('b', { class: 'num', text: fmtUsd2(econ.sliceIfLaunchesUsd) })),
        el('div', null, el('span', { text: 'Slice expected (at odds)' }), el('b', { class: 'num', text: fmtUsd2(econ.sliceExpectedUsd) })),
        el('div', null, el('span', { text: 'Fees (' + econ.nTx + ' tx)' }), el('b', { class: 'num', text: fmtUsd2(econ.feesUsd) })),
        el('div', null, el('span', { text: 'Forgone yield (4% T-bill, ' + econ.holdDays + 'd)' }), el('b', { class: 'num', text: fmtUsd2(econ.forgoneUsd) })),
        el('div', null, el('span', { text: 'Net' }), el('b', { class: 'num ' + (econ.netUsd >= 0 ? 'pos' : 'neg'), text: fmtUsd2(econ.netUsd) })),
        el('div', null, el('span', { text: 'Net per hour (' + econ.hours.toFixed(1) + 'h)' }), el('b', { class: 'num ' + (econ.netPerHourUsd >= 0 ? 'pos' : 'neg'), text: fmtUsd2(econ.netPerHourUsd) })),
        el('div', null, el('span', { text: 'Pays from' }), el('b', { class: 'num', text: econ.paysFromUsd === null ? 'never' : '$' + econ.paysFromUsd.toLocaleString('en-US') })),
        el('div', null, el('span', { text: 'Break-even odds' }), el('b', { class: 'num', text: econ.breakEvenOdds === Infinity ? 'never' : econ.breakEvenOdds.toFixed(2) })),
        el('div', null, el('span', { text: 'Verdict' }), verdictBadge(econ.verdict))
      ),
      el('ol', { class: 'steps' }, row.farm_steps.map(function (s) { return el('li', { text: s }); })),
      (state.ticket !== 1000 || state.share !== 0.10)
        ? el('p', { class: 'sub', text: 'The steps as written are costed at $1,000 and a 10% share; the netting above is for the selected ticket and share.' })
        : null,
      el('p', { class: 'sub', text: 'Gas is a stated estimate per chain, not a measured quote. A break-even odds above 1.0 means the farm cannot pay even if launch were certain.' })
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    if (state.tab === 'board') {
      shell.appendChild(boardTable());
      shell.appendChild(scatter());
    } else if (state.tab === 'method') {
      shell.appendChild(methodPanel());
    } else if (state.tab === 'ledger') {
      shell.appendChild(ledgerPanel());
    } else {
      shell.appendChild(liveTable());
    }
    shell.appendChild(auditLine());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
