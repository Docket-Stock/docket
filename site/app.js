// DOCKET site script. Wrapped in a function so nothing leaks into the page's globals
// (wallet extensions define their own).
(function () {
  const cfg = window.DOCKET_CONFIG;
  const $ = (id) => document.getElementById(id);
  const page = document.body.dataset.page;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const api = async (path) => {
    const res = await fetch(cfg.api + path);
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    return body;
  };
  const isAddress = (s) => /^0x[0-9a-fA-F]{40}$/.test(s);
  const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
  const KINDS = { trade: 'Insider trade', notice: 'Notice to sell', stake: 'Large holder', event: 'Company event', report: 'Report' };
  const LEVELS = { 3: 'Major', 2: 'Notable', 1: 'Routine' };
  const usd = (n) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(2)}`);
  const dayLabel = (iso) => {
    const d = new Date(iso + 'T12:00:00Z'), today = new Date().toISOString().slice(0, 10);
    if (iso === today) return 'Today';
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  };
  const ago = (ts) => {
    const m = Math.max(0, Math.round((Date.now() / 1000 - ts) / 60));
    return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
  };
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private window */ } },
  };

  // ---- one entry, and a list grouped by day ----
  const row = (e) => `<a class="row l${e.level}${e.side ? ' ' + e.side : ''}" href="${esc(e.url)}" target="_blank" rel="noopener">
    <span class="lvl"><i class="dot l${e.level}"></i>${LEVELS[e.level]}</span>
    <span class="sym">${esc(e.symbol)}</span>
    <span class="what"><b>${esc(e.title)}</b><small>${esc(e.detail)}</small></span>
    <span class="kind">${KINDS[e.kind]}</span>
  </a>`;
  function list(entries, empty) {
    if (!entries.length) return `<p class="empty">${empty}</p>`;
    let html = '', day = '';
    for (const e of entries) {
      if (e.filed !== day) { day = e.filed; html += `<p class="day">${dayLabel(day)}</p>`; }
      html += row(e);
    }
    return html;
  }
  const tile = (n, label, cls = '') => `<div class="tile ${cls}"><b>${n}</b><span>${label}</span></div>`;
  const chips = (el, items, current, onPick) => {
    el.innerHTML = items.map(([id, label, n]) => `<button data-id="${id}"${String(id) === String(current) ? ' class="on"' : ''}>${label}${n === undefined ? '' : ` <i>${n}</i>`}</button>`).join('');
    el.onclick = (ev) => { const b = ev.target.closest('button'); if (b) onPick(b.dataset.id); };
  };

  // ---- rail and footer ----
  let statusPromise;
  const status = () => (statusPromise ||= api('/api/status'));
  function chrome() {
    const pons = cfg.links.pons || (cfg.tokenAddress ? `https://pons.family/token/${cfg.tokenAddress}` : '');
    $('rail-ca').innerHTML = cfg.tokenAddress
      ? `<button class="ca" title="Copy the contract address" data-ca>$DOCKET <code>${short(cfg.tokenAddress)}</code></button>`
      : '<a class="ca soon" href="token.html">$DOCKET <code>soon</code></a>';
    const links = [['x', 'X'], ['github', 'GitHub']].filter(([k]) => cfg.links[k]).map(([k, label]) => `<a href="${esc(cfg.links[k])}" target="_blank" rel="noopener">${label}</a>`);
    if (pons) links.push(`<a href="${esc(pons)}" target="_blank" rel="noopener">Pons</a>`);
    links.push('<a href="/rss">RSS</a>');
    $('foot-links').innerHTML = links.join('');
    document.addEventListener('click', (ev) => {
      const ca = ev.target.closest('[data-ca]');
      if (ca) { navigator.clipboard?.writeText(cfg.tokenAddress); ca.classList.add('done'); setTimeout(() => ca.classList.remove('done'), 1200); }
      const copy = ev.target.closest('[data-copy]');
      if (copy) { navigator.clipboard?.writeText($(copy.dataset.copy).textContent); const t = copy.textContent; copy.textContent = 'Copied'; setTimeout(() => (copy.textContent = t), 1200); }
    });
    status().then((s) => {
      $('status').classList.add(s.updated && Date.now() / 1000 - s.updated < 1200 ? 'live' : 'stale');
      $('status').querySelector('span').textContent = s.updated ? `Filings read ${ago(s.updated)}` : 'Waiting for the first read';
    }).catch(() => { $('status').querySelector('span').textContent = 'Offline'; });
  }

  // ---- a wallet's stock tokens, read in the browser through Multicall3 ----
  const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
  const word = (n) => BigInt(n).toString(16).padStart(64, '0');
  function encodeAggregate3(calls) {
    const tuples = calls.map((c) => {
      const bytes = c.data.slice(2);
      return c.to.slice(2).toLowerCase().padStart(64, '0') + word(1) + word(0x60) + word(bytes.length / 2) + bytes.padEnd(Math.ceil(bytes.length / 64) * 64, '0');
    });
    let offset = calls.length * 32;
    const heads = tuples.map((t) => { const h = word(offset); offset += t.length / 2; return h; });
    return '0x82ad56cb' + word(0x20) + word(calls.length) + heads.join('') + tuples.join('');
  }
  function decodeAggregate3(hex) {
    const d = hex.slice(2), at = (byte) => parseInt(d.slice(byte * 2, byte * 2 + 64), 16), base = 64;
    return Array.from({ length: at(32) }, (_, i) => {
      const tuple = base + at(base + i * 32), bytes = tuple + at(tuple + 32);
      return at(tuple) === 1 ? '0x' + d.slice((bytes + 32) * 2, (bytes + 32 + at(bytes)) * 2) : null;
    });
  }
  async function ethCalls(calls) {
    const out = [];
    for (let i = 0; i < calls.length; i += 100) {
      const res = await fetch(cfg.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: MULTICALL3, data: encodeAggregate3(calls.slice(i, i + 100)) }, 'latest'] }) });
      if (!res.ok) throw new Error(`The chain did not answer (${res.status}). Try again in a minute.`);
      const body = await res.json();
      if (body.error) throw new Error(body.error.message);
      out.push(...decodeAggregate3(body.result));
    }
    return out;
  }
  async function loadBrief(address) {
    const { tokens } = await api('/api/tokens');
    const arg = address.slice(2).toLowerCase().padStart(64, '0');
    const balances = await ethCalls(tokens.map((t) => ({ to: t.address, data: '0x70a08231' + arg })));
    const held = tokens.map((t, i) => ({ symbol: t.symbol, name: t.name, feed: t.feed, units: balances[i] && balances[i] !== '0x' ? Number(BigInt(balances[i])) / 1e18 : 0 })).filter((t) => t.units > 0);
    const priced = held.filter((t) => t.feed);
    const rounds = priced.length ? await ethCalls(priced.map((t) => ({ to: t.feed, data: '0xfeaf968c' }))) : [];
    priced.forEach((t, i) => {
      // latestRoundData(): the answer is the second word, 8 decimals
      const answer = rounds[i] && rounds[i].length >= 130 ? Number(BigInt('0x' + rounds[i].slice(66, 130))) / 1e8 : 0;
      if (answer > 0) t.usd = t.units * answer;
    });
    held.sort((x, y) => (y.usd ?? 0) - (x.usd ?? 0));
    const entries = held.length ? (await api(`/api/feed?symbols=${held.map((h) => encodeURIComponent(h.symbol)).join(',')}&days=30&limit=500`)).entries : [];
    return { holdings: held, entries };
  }

  // ---- Brief ----
  function initBrief() {
    Promise.all([api('/api/feed?level=2&days=7&limit=40'), status()]).then(([feed, s]) => {
      const major = feed.entries.filter((e) => e.level === 3).length;
      $('tiles').innerHTML = tile(s.tokens, 'stock tokens read') + tile(s.entries, 'entries in 45 days') + tile(major, 'major in the last 7 days', 'hot') + tile('5 min', 'between reads');
      $('top-list').innerHTML = list(feed.entries.slice(0, 14), 'Nothing notable was filed in the last 7 days.');
    }).catch((err) => { $('top-list').innerHTML = `<p class="empty">Could not load the feed: ${esc(err.message)}</p>`; });

    const box = $('brief'), input = $('address');
    async function read(address) {
      box.hidden = false;
      box.innerHTML = '<div class="panel"><p class="muted">Reading the wallet…</p></div>';
      try {
        const b = await loadBrief(address);
        store.set('docket-address', address);
        if (!b.holdings.length) {
          box.innerHTML = `<div class="panel"><h2>No stock tokens in ${short(address)}</h2><p class="muted">This wallet holds none of the stock tokens on Robinhood Chain right now. You can still follow any ticker on the <a href="alerts.html">Alerts</a> page or browse the <a href="feed.html">feed</a>.</p></div>`;
          return;
        }
        const count = (l) => b.entries.filter((e) => e.level === l).length;
        const total = b.holdings.reduce((s, h) => s + (h.usd || 0), 0);
        const quiet = b.holdings.filter((h) => !b.entries.some((e) => e.symbol === h.symbol)).map((h) => h.symbol);
        let level = count(3) + count(2) > 0 ? 2 : 1;
        const draw = () => {
          const shown = b.entries.filter((e) => e.level >= level);
          box.innerHTML = `<div class="panel">
            <div class="head"><h2>Brief for ${short(address)}</h2><a class="btn small primary" href="alerts.html">Get these as alerts</a></div>
            <div class="holdings">${b.holdings.map((h) => `<a href="companies.html#${esc(h.symbol)}"><b>${esc(h.symbol)}</b>${h.usd ? `<span>${usd(h.usd)}</span>` : ''}</a>`).join('')}</div>
            <div class="tiles">${tile(b.holdings.length, total ? `stock tokens, ${usd(total)}` : 'stock tokens') + tile(count(3), 'major', count(3) ? 'hot' : '') + tile(count(2), 'notable') + tile(count(1), 'routine')}</div>
            <div class="chips" id="brief-levels"></div>
            <div class="list">${list(shown, 'Nothing at this level in the last 30 days.')}</div>
            ${quiet.length ? `<p class="fine">Nothing filed in 30 days for: ${quiet.map(esc).join(', ')}.</p>` : ''}
          </div>`;
          chips($('brief-levels'), [[2, 'Major and notable', count(3) + count(2)], [1, 'Everything', b.entries.length], [3, 'Major only', count(3)]], level, (id) => { level = Number(id); draw(); });
        };
        draw();
      } catch (err) {
        box.innerHTML = `<div class="panel"><p class="empty">Could not read the wallet: ${esc(err.message)}</p></div>`;
      }
    }
    $('brief-form').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const a = input.value.trim();
      if (!isAddress(a)) { input.classList.add('bad'); input.focus(); return; }
      input.classList.remove('bad');
      read(a);
    });
    $('connect').addEventListener('click', async () => {
      if (!window.ethereum) { $('connect').textContent = 'No wallet found'; return; }
      try {
        const [a] = await window.ethereum.request({ method: 'eth_requestAccounts' });
        if (a) { input.value = a; read(a); }
      } catch { /* the user closed the wallet window */ }
    });
    const saved = store.get('docket-address');
    if (saved && isAddress(saved)) { input.value = saved; read(saved); }
  }

  // ---- Feed ----
  function initFeed() {
    let entries = [], level = 2, kind = 'all', query = (location.hash.slice(1) || '').toUpperCase();
    $('feed-search').value = query;
    const draw = () => {
      const byText = entries.filter((e) => !query || e.symbol.startsWith(query));
      const shown = byText.filter((e) => e.level >= level && (kind === 'all' || e.kind === kind));
      chips($('feed-levels'), [[2, 'Major and notable'], [3, 'Major only'], [1, 'Everything']], level, (id) => { level = Number(id); draw(); });
      const inLevel = byText.filter((e) => e.level >= level);
      chips($('feed-kinds'), [['all', 'All kinds', inLevel.length], ...Object.entries(KINDS).map(([k, label]) => [k, label, inLevel.filter((e) => e.kind === k).length])], kind, (id) => { kind = id; draw(); });
      $('feed-count').textContent = `${shown.length} ${shown.length === 1 ? 'entry' : 'entries'}${shown.length > 300 ? ', showing the newest 300' : ''}`;
      $('feed-list').innerHTML = list(shown.slice(0, 300), 'Nothing matches these filters.');
    };
    $('feed-search').addEventListener('input', (ev) => { query = ev.target.value.trim().toUpperCase(); draw(); });
    // two requests: the notable ones arrive whole, routine ones fill in the rest
    Promise.all([api('/api/feed?level=2&days=30&limit=500'), api('/api/feed?level=1&days=30&limit=500')]).then(([a, b]) => {
      const seen = new Set();
      entries = [...a.entries, ...b.entries].filter((e) => !seen.has(e.id) && seen.add(e.id)).sort((x, y) => y.ts - x.ts);
      draw();
    }).catch((err) => { $('feed-list').innerHTML = `<p class="empty">Could not load the feed: ${esc(err.message)}</p>`; });
  }

  // ---- Companies ----
  function initCompanies() {
    let tokens = [], filter = 'busy', query = '';
    const tests = { busy: (t) => t.entries > 0, major: (t) => t.major > 0, all: () => true };
    const draw = () => {
      chips($('co-filters'), [['busy', 'With filings', tokens.filter(tests.busy).length], ['major', 'With a major entry', tokens.filter(tests.major).length], ['all', 'All', tokens.length]], filter, (id) => { filter = id; draw(); });
      const q = query.toLowerCase();
      const shown = tokens.filter(tests[filter]).filter((t) => !q || t.symbol.toLowerCase().startsWith(q) || t.name.toLowerCase().includes(q)).sort((a, b) => b.major - a.major || b.entries - a.entries || a.symbol.localeCompare(b.symbol));
      $('co-grid').innerHTML = shown.map((t) => `<a class="co${t.major ? ' hot' : ''}" href="#${esc(t.symbol)}"><b>${esc(t.symbol)}</b><span>${esc(t.name)}</span><small>${t.entries ? `${t.entries} ${t.entries === 1 ? 'entry' : 'entries'}${t.major ? ` · ${t.major} major` : ''}` : 'quiet'}</small></a>`).join('') || '<p class="empty">No company matches.</p>';
    };
    async function open(symbol) {
      const box = $('co-detail');
      const t = tokens.find((x) => x.symbol === symbol);
      if (!t) { box.hidden = true; return; }
      box.hidden = false;
      box.innerHTML = `<div class="panel"><p class="muted">Reading ${esc(symbol)}…</p></div>`;
      box.scrollIntoView({ block: 'start', behavior: 'smooth' });
      try {
        const { entries } = await api(`/api/feed?symbols=${encodeURIComponent(symbol)}&days=45&limit=300`);
        box.innerHTML = `<div class="panel">
          <div class="head"><h2>${esc(symbol)} <span class="muted">${esc(t.name)}</span></h2><a class="btn small" href="#">Close</a></div>
          <p class="fine">Token <a href="${cfg.explorer}/token/${esc(t.address)}" target="_blank" rel="noopener"><code>${short(t.address)}</code></a> · ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'} in 45 days · <a href="alerts.html#${esc(symbol)}">get alerts for ${esc(symbol)}</a></p>
          <div class="list">${list(entries, 'Nothing was filed about this company in the last 45 days.')}</div>
        </div>`;
      } catch (err) { box.innerHTML = `<div class="panel"><p class="empty">${esc(err.message)}</p></div>`; }
    }
    $('co-search').addEventListener('input', (ev) => { query = ev.target.value.trim(); draw(); });
    const route = () => open(decodeURIComponent(location.hash.slice(1)).toUpperCase());
    addEventListener('hashchange', route);
    api('/api/tokens').then((r) => { tokens = r.tokens; draw(); if (location.hash.length > 1) route(); }).catch((err) => { $('co-grid').innerHTML = `<p class="empty">${esc(err.message)}</p>`; });
  }

  // ---- Alerts ----
  function initAlerts() {
    const input = $('al-input');
    input.value = location.hash.length > 1 ? decodeURIComponent(location.hash.slice(1)) : store.get('docket-address') || '';
    let bot = null, known = false;
    const draw = () => {
      const raw = input.value.trim();
      const wallet = isAddress(raw) ? raw : '';
      const symbols = wallet ? [] : [...new Set(raw.toUpperCase().split(/[\s,]+/).filter((s) => /^[A-Z.]{1,6}$/.test(s)))];
      const origin = cfg.api || location.origin;
      $('al-note').textContent = wallet ? `Following everything held by ${short(wallet)}.` : symbols.length ? `Following ${symbols.join(', ')}.` : 'Type a wallet address to follow everything in it, or tickers separated by commas.';
      $('rss-url').textContent = `${origin}/rss?${wallet ? `address=${wallet}` : symbols.length ? `symbols=${symbols.join(',')}` : 'level=2'}`;
      $('api-url').textContent = wallet ? `${origin}/api/brief?address=${wallet}` : `${origin}/api/feed?${symbols.length ? `symbols=${symbols.join(',')}&` : ''}level=2`;
      if (!known) return;
      if (!bot) { $('way-tg').innerHTML = '<p class="soon-note">The bot opens soon. RSS and the API work now.</p>'; return; }
      // Telegram start payloads allow letters, digits, _ and -, up to 64 characters
      const fit = [];
      for (const s of symbols.filter((x) => /^[A-Z]+$/.test(x))) { if (['s', ...fit, s].join('_').length <= 64) fit.push(s); }
      const payload = wallet ? `w_${wallet}` : fit.length ? `s_${fit.join('_')}` : '';
      $('way-tg').innerHTML = `<a class="btn primary" href="https://t.me/${esc(bot)}${payload ? `?start=${payload}` : ''}" target="_blank" rel="noopener">Open @${esc(bot)}</a>${symbols.length > fit.length ? '<p class="fine">Some tickers did not fit in the link. Add them in the bot with /watch.</p>' : ''}`;
    };
    input.addEventListener('input', draw);
    draw();
    status().then((s) => { bot = s.alerts ? s.bot : null; known = true; draw(); }).catch(() => { known = true; draw(); });
    api('/api/feed?level=3&days=30&limit=1').then(({ entries: [e] }) => {
      if (e) $('sample').textContent = `${e.symbol} · ${LEVELS[e.level]}\n${e.title}\n${e.detail}\n${KINDS[e.kind]} · ${/^[0-9]/.test(e.form) ? 'Form ' : ''}${e.form} · filed ${e.filed}\n${e.url}`;
    }).catch(() => {});
  }

  // ---- Token ----
  function initToken() {
    const pons = cfg.links.pons || (cfg.tokenAddress ? `https://pons.family/token/${cfg.tokenAddress}` : '');
    $('token-note').textContent = cfg.tokenAddress ? '$DOCKET is live on Pons, Robinhood Chain. Check the address below against the one in our posts before you buy.' : '$DOCKET is not launched yet. When it is, the contract address will appear here, in the GitHub README and in a pinned post. Anything else is not ours.';
    $('ca-box').innerHTML = cfg.tokenAddress ? `<code>${cfg.tokenAddress}</code><button class="btn small" data-ca>Copy</button>` : '<code>Contract address: not launched yet</code>';
    const links = [];
    if (pons) links.push(`<a class="btn primary" href="${esc(pons)}" target="_blank" rel="noopener">Trade on Pons</a>`);
    if (cfg.tokenAddress) links.push(`<a class="btn" href="${cfg.explorer}/token/${cfg.tokenAddress}" target="_blank" rel="noopener">Explorer</a>`);
    $('token-links').innerHTML = links.join('');
    $('tokenomics').innerHTML = cfg.tokenomics.map(([k, v]) => `<div class="tr"><span><b>${esc(k)}</b></span><span>${esc(v)}</span></div>`).join('');
  }

  chrome();
  ({ index: initBrief, feed: initFeed, companies: initCompanies, alerts: initAlerts, token: initToken }[page] || (() => {}))();
})();
