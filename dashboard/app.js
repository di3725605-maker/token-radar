// Token Radar's plain dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a filterable table, a per-protocol detail drawer with the model's own
// inputs and the protocol's farm plan. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
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
  // The model in one function: the page recomputes a row from the snapshot figures and checks the
  // number board.json carries, so the page's code and the board's data are visibly the same arithmetic.
  // implied = round(tvl x category multiple x growth multiplier x maturity multiplier).
  function growthMultOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var mult = 1 + (growth / 100) * model.growth_weight;
    return Math.min(model.growth_max, Math.max(model.growth_min, mult));
  }
  function maturityMultOf(row, model) {
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    return model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  }
  function impliedOf(row, model) {
    return Math.max(1, Math.round(row.tvl_usd * row.multiple * growthMultOf(row, model) * maturityMultOf(row, model)));
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

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and age
  // decide the action, the capital, the hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function gasFor(chain) {
    return chain.toLowerCase() === 'ethereum' ? 'about $8 of gas' : 'about $2 to $4 of gas on ' + chain;
  }
  function planFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    var cap = '$' + capital;
    if (c.indexOf('cdp') >= 0) return {
      action: 'Deposit ' + cap + ' of collateral on ' + name + ' (' + chain + ') and mint the protocol stablecoin against it at a safe ratio, well above the minimum.',
      weekly: 'Check the ' + name + ' collateral ratio on ' + chain + ', top up collateral if the price moved, and confirm no stability fee accrued unpaid.',
      exit: 'Repay the stablecoin debt, withdraw the collateral and move the funds out.'
    };
    if (c.indexOf('lend') >= 0) return {
      action: 'Supply ' + cap + ' of a major stablecoin into the base lending market on ' + name + ' (' + chain + '), then borrow a small amount against it to establish a real position.',
      weekly: 'Claim any accrued supply interest on ' + name + ' (' + chain + ') and re-supply it, or top up the position by a small amount to keep it active.',
      exit: 'Repay the borrow, withdraw the supply and move the funds out.'
    };
    if (c.indexOf('dex') >= 0) return {
      action: 'Provide ' + cap + ' of liquidity to a major pair on ' + name + ' (' + chain + ') within a sensible range, and keep the position narrow to limit impermanent loss.',
      weekly: 'Check the ' + name + ' liquidity position on ' + chain + ', rebalance the range if it drifted out, and collect any fees.',
      exit: 'Remove the liquidity, swap back to the starting asset and move the funds out.'
    };
    if (c.indexOf('yield aggregator') >= 0) return {
      action: 'Deposit ' + cap + ' into a single vault on ' + name + ' (' + chain + ') that the aggregator routes to, and note the underlying strategy and any deposit fee before depositing.',
      weekly: 'Check the ' + name + ' vault on ' + chain + ' for strategy changes, share price, and whether the yield rate still justifies the fee.',
      exit: 'Withdraw the shares, unwrap if needed and move the funds out.'
    };
    if (c.indexOf('yield') >= 0) return {
      action: 'Deposit ' + cap + ' into the base yield strategy on ' + name + ' (' + chain + ') for a major asset, and note the current yield source before depositing.',
      weekly: 'Check the ' + name + ' position on ' + chain + ', claim any yield, and re-deposit it or move it to a safer strategy if the rate dropped.',
      exit: 'Withdraw the position, unwrap if needed and move the funds out.'
    };
    if (c.indexOf('rwa') >= 0) return {
      action: 'Deposit ' + cap + ' into the base real-world-asset product on ' + name + ' (' + chain + '), such as a tokenized treasury or credit pool, and confirm any whitelist or lockup terms before depositing.',
      weekly: 'Check the ' + name + ' position on ' + chain + ' for accrued yield, redemption windows, and any lockup status.',
      exit: 'Redeem the position at the next window, unwrap if needed and move the funds out.'
    };
    if (c.indexOf('curator') >= 0) return {
      action: 'Deposit ' + cap + ' into a curated vault on ' + name + ' (' + chain + ') only after reading its curator terms and lockup note.',
      weekly: 'Check the ' + name + ' vault on ' + chain + ' for allocation changes, curator updates, and any withdrawal queue; withdraw if the risk note changes.',
      exit: 'Withdraw from the queue at the end of the hold and move the funds out.'
    };
    if (c.indexOf('allocator') >= 0) return {
      action: 'Deposit ' + cap + ' into a diversified allocation on ' + name + ' (' + chain + '), and note the share price and fees before depositing.',
      weekly: 'Check the ' + name + ' vault on ' + chain + ' for strategy rebalances, share price, and fee changes.',
      exit: 'Redeem the shares and move the funds out.'
    };
    if (c.indexOf('derivative') >= 0) return {
      action: 'Open a small hedged margin position of ' + cap + ' on ' + name + ' (' + chain + '), a perpetual with an offset spot leg, and set a stop so the loss is capped.',
      weekly: 'Check the ' + name + ' margin position on ' + chain + ' for funding costs and liquidation distance, and top up margin if it is close.',
      exit: 'Close the perpetual, close the spot leg and move the funds out.'
    };
    if (c.indexOf('liquidity manager') >= 0) return {
      action: 'Deposit ' + cap + ' into a managed liquidity position on ' + name + ' (' + chain + '), where the manager sets the range, and note the fee split and withdrawal rules.',
      weekly: 'Check the ' + name + ' managed position on ' + chain + ' for range drift, fees collected, and any manager rebalance.',
      exit: 'Withdraw the managed position and move the funds out.'
    };
    if (c.indexOf('basis') >= 0) return {
      action: 'Deposit ' + cap + ' into a delta-neutral basis position on ' + name + ' (' + chain + '), long spot and short perpetual, and confirm the funding rate and collateral rules before depositing.',
      weekly: 'Check the ' + name + ' basis position on ' + chain + ' for funding rate, collateral ratio, and any leg drift, and rebalance if needed.',
      exit: 'Close both legs of the basis position and move the funds out.'
    };
    if (c.indexOf('leveraged farm') >= 0) return {
      action: 'Open a leveraged farm position on ' + name + ' (' + chain + ') with ' + cap + ' of equity at a low leverage of 2x or less, and check the liquidation price before borrowing.',
      weekly: 'Check the ' + name + ' leveraged position on ' + chain + ' for health factor and liquidation distance, and repay or add collateral if it is close.',
      exit: 'Close the leveraged position, repay the borrow and move the funds out.'
    };
    if (c.indexOf('prediction') >= 0) return {
      action: 'Fund ' + cap + ' on ' + name + ' (' + chain + ') and place one market position on an outcome you can follow.',
      weekly: 'Check the ' + name + ' market position on ' + chain + ', close it if it resolved, and place one new position.',
      exit: 'Close or resolve the open positions and withdraw the balance.'
    };
    if (c.indexOf('insurance') >= 0) return {
      action: 'Buy ' + cap + ' of cover from ' + name + ' (' + chain + ') and keep the policy active.',
      weekly: 'Check the ' + name + ' policy on ' + chain + ' for coverage status and any claim window.',
      exit: 'Let the policy lapse at the end of the hold, or claim if the covered event happened.'
    };
    if (c.indexOf('payment') >= 0) return {
      action: 'Route ' + cap + ' of payments through ' + name + ' (' + chain + ') and keep the receipts.',
      weekly: 'Make one payment through ' + name + ' (' + chain + ') and check the limits and fees.',
      exit: 'Stop routing new payments and withdraw any remaining balance.'
    };
    if (c.indexOf('staking pool') >= 0) return {
      action: "Stake " + cap + " of the chain's staking asset through " + name + ' (' + chain + ') and keep the receipt.',
      weekly: 'Check the ' + name + ' stake on ' + chain + ' for rewards, and claim or restake them.',
      exit: 'Unstake the position and withdraw the asset.'
    };
    if (c.indexOf('anchor btc') >= 0) return {
      action: 'Mint ' + cap + ' of the wrapped bitcoin asset on ' + name + ' (' + chain + ') and hold it.',
      weekly: 'Check the ' + name + ' position on ' + chain + ' for the peg and the redemption window.',
      exit: 'Redeem the wrapped asset for bitcoin and move the funds out.'
    };
    return {
      action: 'Deposit ' + cap + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.',
      weekly: 'Make one qualifying action each week on ' + name + ' (' + chain + '), such as a deposit, a borrow, a swap or a vote.',
      exit: 'Withdraw the position and move the funds out.'
    };
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var plan = planFor(p, capital, chain);
    var gas = gasFor(chain);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: '$0 to set up', time: '15 minutes' },
      { text: plan.action, cost: gas + ' and $' + capital + ' of capital', time: '20 minutes to set up' },
      { text: plan.weekly, cost: gas + ' a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '5 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it. ' + plan.exit, cost: 'nothing but the log', time: '10 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
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
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
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

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor. Implied value is a model, not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
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

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
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

  function modelPanel() {
    var m = DATA.model;
    var multRows = DATA.multiples.slice().sort(function (a, b) { return b.multiple - a.multiple; }).map(function (x) {
      return el('tr', null,
        el('td', { text: x.category }),
        el('td', { class: 'num', text: String(x.n) }),
        el('td', { class: 'num', text: x.raw_median === null ? 'n/a' : x.raw_median.toFixed(4) }),
        el('td', { class: 'num', text: x.multiple.toFixed(4) }),
        el('td', { text: x.source === 'comparators' ? 'comparators' : 'global fallback' })
      );
    });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x category multiple x growth multiplier x maturity multiplier )'
      ),
      el('p', { class: 'sub', text: 'TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. Growth is clamped to ' + m.growth_floor + '% .. ' + m.growth_cap + '% before it moves the value by ' + (m.growth_weight * 100) + '% of the change, and the growth multiplier itself is clamped to ' + m.growth_min + ' .. ' + m.growth_max + '. Maturity runs from ' + m.maturity_floor + ' to ' + (m.maturity_floor + m.maturity_range) + ' over ' + m.maturity_days + ' days.' }),
      el('h3', { text: 'Category multiples' }),
      el('p', { class: 'sub', text: 'Each multiple is the median market-cap-to-TVL ratio of the snapshot\u2019s own tokenized protocols in that category, shrunk toward the snapshot-wide median of ' + DATA.global_median.toFixed(4) + ' (' + (DATA.multiples.reduce(function (s, x) { return s + x.n; }, 0)) + ' comparators) with a pseudo-count of 6, then clamped to 0.05 .. 0.60. A category with fewer than 3 comparators uses the global median instead.' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'multiples' },
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Category' }),
            el('th', { scope: 'col', text: 'Comparators' }),
            el('th', { scope: 'col', text: 'Raw median' }),
            el('th', { scope: 'col', text: 'Multiple' }),
            el('th', { scope: 'col', text: 'Source' })
          )),
          el('tbody', null, multRows)
        )
      ),
      el('p', { class: 'sub', text: 'The early radar is every pre-token protocol below the watchlist floor, by TVL, excluding exchanges, bridges, liquid staking and restaking, versioned names, and wrapped or staked tokens. The live-token protocols are set aside with their market caps shown.' })
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
    var steps = farmSteps(row);
    var multSource = row.multiple_source === 'comparators'
      ? 'the median of its category\u2019s tokenized comparators'
      : 'the snapshot-wide median, because its category has fewer than 3 tokenized comparators';
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Category multiple' }), el('b', { class: 'num', text: row.multiple.toFixed(4) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'The multiple is ' + multSource + '. Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(impliedOf(row, DATA.model)) + (impliedOf(row, DATA.model) === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
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
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
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
