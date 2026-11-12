// DOCKET Worker: the site, the public API, the SEC poller (cron) and the Telegram bot.
//   GET  /api/feed?symbols=NVDA,TSLA&kind=trade&level=2&days=30&limit=200
//   GET  /api/tokens
//   GET  /api/brief?address=0x...        a wallet's stock tokens and what was filed about them
//   GET  /api/status
//   GET  /rss?address=0x... | ?symbols=NVDA,TSLA [&level=2]
//   POST /tg/<TG_SECRET>                 Telegram webhook
// Secrets: TG_TOKEN, TG_SECRET (alerts stay off until both are set), RH_RPC_URL (optional keyed RPC).
import { SEC_UA, KINDS, LEVELS, readFiling, parseAtom, ATOM_FEEDS, atomUrl, parseSubmissions, loadTokens } from './read.mjs';

const PUBLIC_RPC = 'https://rpc.mainnet.chain.robinhood.com';
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
const KEEP_DAYS = 45;
const now = () => Math.floor(Date.now() / 1000);
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=60' } });
const isAddress = (s) => /^0x[0-9a-fA-F]{40}$/.test(s || '');
const symbolsOf = (s) => [...new Set((s || '').toUpperCase().split(/[\s,]+/).filter((x) => /^[A-Z.]{1,6}$/.test(x)))].slice(0, 220);

// ---------- database helpers ----------
const all = async (env, sql, ...args) => (await env.DB.prepare(sql).bind(...args).all()).results;
const run = (env, sql, ...args) => env.DB.prepare(sql).bind(...args).run();
const getState = async (env, key) => (await env.DB.prepare('SELECT value FROM state WHERE key=?').bind(key).first())?.value ?? null;
const setState = (env, key, value) => run(env, 'INSERT INTO state VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, String(value));
const marks = (n) => Array(n).fill('?').join(',');

async function entriesFor(env, { symbols, kind, level = 1, days = 30, limit = 200 }) {
  const where = ['ts >= ?', 'level >= ?'], args = [now() - Math.min(days, KEEP_DAYS) * 86400, level];
  if (symbols?.length) { where.push(`symbol IN (${marks(symbols.length)})`); args.push(...symbols); }
  if (kind && KINDS[kind]) { where.push('kind = ?'); args.push(kind); }
  return all(env, `SELECT * FROM entries WHERE ${where.join(' AND ')} ORDER BY ts DESC LIMIT ?`, ...args, Math.min(limit, 500));
}

// ---------- chain: a wallet's stock tokens through Multicall3 ----------
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
async function ethCalls(env, calls) {
  const out = [];
  for (let i = 0; i < calls.length; i += 120) {
    const res = await fetch(env.RH_RPC_URL || PUBLIC_RPC, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: MULTICALL3, data: encodeAggregate3(calls.slice(i, i + 120)) }, 'latest'] }),
    });
    const body = await res.json();
    if (body.error) throw new Error(body.error.message);
    out.push(...decodeAggregate3(body.result));
  }
  return out;
}
async function holdings(env, address) {
  const tokens = await all(env, 'SELECT symbol, name, address, feed FROM tokens');
  const arg = address.slice(2).toLowerCase().padStart(64, '0');
  const balances = await ethCalls(env, tokens.map((t) => ({ to: t.address, data: '0x70a08231' + arg })));
  const held = tokens.map((t, i) => ({ symbol: t.symbol, name: t.name, feed: t.feed, units: balances[i] && balances[i] !== '0x' ? Number(BigInt(balances[i])) / 1e18 : 0 })).filter((t) => t.units > 0);
  const priced = held.filter((t) => t.feed);
  const rounds = priced.length ? await ethCalls(env, priced.map((t) => ({ to: t.feed, data: '0xfeaf968c' }))) : [];
  priced.forEach((t, i) => {
    const answer = rounds[i] && rounds[i].length >= 130 ? Number(BigInt('0x' + rounds[i].slice(66, 130))) / 1e8 : 0;
    if (answer > 0) t.usd = Math.round(t.units * answer * 100) / 100;
  });
  return held.map(({ feed, ...t }) => t).sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0));
}

// ---------- the poller ----------
async function refreshTokens(env) {
  const get = async (url) => { const r = await fetch(url, url.includes('sec.gov') ? { headers: { 'User-Agent': SEC_UA } } : {}); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.text(); };
  const tokens = await loadTokens(get);
  if (tokens.length < 50) throw new Error('token registry looks empty');
  const stmt = env.DB.prepare('INSERT INTO tokens VALUES (?,?,?,?,?) ON CONFLICT(symbol) DO UPDATE SET name=excluded.name, address=excluded.address, feed=excluded.feed, cik=excluded.cik');
  await env.DB.batch(tokens.map((t) => stmt.bind(t.symbol, t.name, t.address, t.feed, t.cik)));
  await setState(env, 'tokens_at', now());
}

const alertText = (e) => `${e.symbol} · ${LEVELS[e.level]}\n${e.title}\n${e.detail}\n${KINDS[e.kind]} · ${/^[0-9]/.test(e.form) ? 'Form ' : ''}${e.form} · filed ${e.filed}\n${e.url}`;

async function poll(env) {
  if (now() - Number((await getState(env, 'tokens_at')) || 0) > 86400) { await refreshTokens(env); return { refreshed: true }; }
  const tokens = await all(env, 'SELECT symbol, cik FROM tokens WHERE cik IS NOT NULL');
  const symbolOf = new Map(tokens.map((t) => [t.cik, t.symbol]));
  let budget = 28; // SEC requests this run; Workers allow 50 subrequests and the bot needs some
  const get = async (url) => {
    if (--budget < 0) throw new Error('out of budget');
    const r = await fetch(url, { headers: { 'User-Agent': SEC_UA } });
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return r.text();
  };
  const lastPoll = Number((await getState(env, 'last_poll')) || 0);
  const found = new Map(); // "acc:symbol" -> filing
  const take = (f) => { const symbol = symbolOf.get(f.cik); if (symbol) found.set(`${f.acc}:${symbol}`, { ...f, symbol }); };
  for (const [type, owner] of ATOM_FEEDS) {
    try {
      let page = parseAtom(await get(atomUrl(type, owner)));
      page.forEach(take);
      // a busy hour can push more than 100 filings between two runs
      if (page.length > 90 && lastPoll && Math.min(...page.map((f) => f.ts)) > lastPoll && budget > 12) parseAtom(await get(atomUrl(type, owner, 100))).forEach(take);
    } catch (err) { console.error(`feed ${type}: ${err.message}`); }
  }
  // safety sweep: two companies a run from their own filing lists, in rotation
  const sweepAt = Number((await getState(env, 'sweep_at')) || 0);
  const since = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10);
  for (let k = 0; k < 2 && budget > 8; k++) {
    const t = tokens[(sweepAt + k) % tokens.length];
    try { parseSubmissions(JSON.parse(await get(`https://data.sec.gov/submissions/CIK${t.cik}.json`)), t.cik, t.symbol, since).forEach((f) => found.set(`${f.acc}:${f.symbol}`, f)); } catch (err) { console.error(`sweep ${t.symbol}: ${err.message}`); }
  }
  await setState(env, 'sweep_at', (sweepAt + 2) % tokens.length);

  const keys = [...found.keys()], known = new Set();
  for (let i = 0; i < keys.length; i += 80) (await all(env, `SELECT acc FROM seen WHERE acc IN (${marks(Math.min(80, keys.length - i))})`, ...keys.slice(i, i + 80))).forEach((r) => known.add(r.acc));
  const fresh = keys.filter((k) => !known.has(k)).map((k) => [k, found.get(k)]).sort((a, b) => a[1].ts - b[1].ts);
  const added = [];
  for (const [key, f] of fresh) {
    let entries;
    try { entries = await readFiling(f, get); } catch (err) { if (err.message === 'out of budget') break; console.error(`${f.form} ${f.acc}: ${err.message}`); continue; }
    const stmts = [env.DB.prepare('INSERT OR IGNORE INTO seen VALUES (?,?)').bind(key, now())];
    for (const e of entries) stmts.push(env.DB.prepare('INSERT OR IGNORE INTO entries VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(e.id, e.symbol, e.form, e.kind, e.level, e.title, e.detail, e.value, e.side, e.filed, e.ts, e.url));
    await env.DB.batch(stmts);
    added.push(...entries);
  }
  // queue alerts for what is new and still recent
  for (const e of added) {
    if (now() - e.ts > 2 * 86400) continue;
    const chats = await all(env, 'SELECT s.chat_id FROM subs s JOIN chats c ON c.chat_id = s.chat_id WHERE s.symbol = ? AND c.level <= ?', e.symbol, e.level);
    if (chats.length) await env.DB.batch(chats.map((c) => env.DB.prepare('INSERT INTO outbox (chat_id, text) VALUES (?,?)').bind(c.chat_id, alertText(e))));
  }
  await flushOutbox(env);
  await setState(env, 'last_poll', now());
  if (new Date().getUTCMinutes() < 5) {
    await run(env, 'DELETE FROM entries WHERE ts < ?', now() - KEEP_DAYS * 86400);
    await run(env, 'DELETE FROM seen WHERE ts < ?', now() - 60 * 86400);
  }
  return { found: found.size, fresh: fresh.length, added: added.length, budget };
}

// ---------- Telegram ----------
async function tg(env, method, body) {
  if (!env.TG_TOKEN) return null;
  const r = await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
  return r ? r.json().catch(() => null) : null;
}
const say = (env, chat, text) => tg(env, 'sendMessage', { chat_id: chat, text, disable_web_page_preview: true });
async function flushOutbox(env) {
  if (!env.TG_TOKEN) return;
  for (const m of await all(env, 'SELECT id, chat_id, text FROM outbox ORDER BY id LIMIT 15')) {
    const r = await say(env, m.chat_id, m.text);
    if (r?.ok || r?.error_code === 400 || r?.error_code === 403) await run(env, 'DELETE FROM outbox WHERE id = ?', m.id);
    // the chat blocked the bot: stop writing to it
    if (r?.error_code === 403) { await run(env, 'DELETE FROM subs WHERE chat_id = ?', m.chat_id); await run(env, 'DELETE FROM chats WHERE chat_id = ?', m.chat_id); }
  }
}

const HELP = `Commands:
/watch NVDA TSLA — follow tickers
/unwatch NVDA — stop following
/wallet 0x… — follow every stock token in a wallet
/list — what you follow
/level 1|2|3 — 1 everything, 2 notable and major (default), 3 major only
/brief — the last 7 days for your list
/stop — remove everything`;

async function watch(env, chat, symbols, src) {
  const known = new Set((await all(env, `SELECT symbol FROM tokens WHERE symbol IN (${marks(symbols.length)})`, ...symbols)).map((r) => r.symbol));
  const ok = symbols.filter((s) => known.has(s));
  if (ok.length) await env.DB.batch(ok.map((s) => env.DB.prepare('INSERT OR IGNORE INTO subs VALUES (?,?,?)').bind(chat, s, src)));
  return { ok, unknown: symbols.filter((s) => !known.has(s)) };
}
async function followWallet(env, chat, address) {
  const held = await holdings(env, address);
  await run(env, "DELETE FROM subs WHERE chat_id = ? AND src = 'wallet'", chat);
  await run(env, 'UPDATE chats SET wallet = ? WHERE chat_id = ?', address.toLowerCase(), chat);
  if (!held.length) return `No stock tokens in ${address.slice(0, 6)}…${address.slice(-4)} right now. I saved the wallet and will check it again once a day.`;
  await watch(env, chat, held.map((h) => h.symbol), 'wallet');
  return `Following ${held.length} stock tokens from ${address.slice(0, 6)}…${address.slice(-4)}:\n${held.map((h) => h.symbol).join(', ')}\n\nThe wallet is checked again once a day.`;
}

async function onMessage(env, msg) {
  const chat = String(msg.chat.id), text = (msg.text || '').trim();
  await run(env, 'INSERT OR IGNORE INTO chats (chat_id, level, created) VALUES (?, 2, ?)', chat, now());
  const [cmdRaw, ...rest] = text.split(/\s+/);
  const cmd = cmdRaw.toLowerCase().replace(/@.*$/, ''), arg = rest.join(' ');
  if (cmd === '/start') {
    // deep links from the site: w_<address> or s_NVDA_TSLA
    if (arg.startsWith('w_') && isAddress(arg.slice(2))) return say(env, chat, `DOCKET is on.\n\n${await followWallet(env, chat, arg.slice(2))}\n\n${HELP}`);
    if (arg.startsWith('s_')) { const r = await watch(env, chat, symbolsOf(arg.slice(2).replace(/_/g, ',')), 'manual'); return say(env, chat, `DOCKET is on. Following: ${r.ok.join(', ') || 'nothing yet'}\n\n${HELP}`); }
    return say(env, chat, `DOCKET sends you a message when something is filed with the SEC about a stock you hold as a token on Robinhood Chain.\n\n${HELP}`);
  }
  if (cmd === '/watch') {
    const symbols = symbolsOf(arg);
    if (!symbols.length) return say(env, chat, 'Send tickers after the command: /watch NVDA TSLA');
    const r = await watch(env, chat, symbols, 'manual');
    return say(env, chat, `${r.ok.length ? `Following: ${r.ok.join(', ')}` : 'Nothing added.'}${r.unknown.length ? `\nNo stock token on Robinhood Chain for: ${r.unknown.join(', ')}` : ''}`);
  }
  if (cmd === '/unwatch') {
    const symbols = symbolsOf(arg);
    if (!symbols.length) return say(env, chat, 'Send tickers after the command: /unwatch NVDA');
    await run(env, `DELETE FROM subs WHERE chat_id = ? AND symbol IN (${marks(symbols.length)})`, chat, ...symbols);
    return say(env, chat, `Stopped following: ${symbols.join(', ')}`);
  }
  if (cmd === '/wallet') {
    if (!isAddress(arg)) return say(env, chat, 'Send a Robinhood Chain address after the command: /wallet 0x…');
    return say(env, chat, await followWallet(env, chat, arg));
  }
  if (cmd === '/list') {
    const subs = await all(env, 'SELECT symbol FROM subs WHERE chat_id = ? ORDER BY symbol', chat);
    const c = (await all(env, 'SELECT level, wallet FROM chats WHERE chat_id = ?', chat))[0];
    return say(env, chat, subs.length ? `Following ${subs.length}: ${subs.map((s) => s.symbol).join(', ')}\nLevel: ${c.level} (${['', 'everything', 'notable and major', 'major only'][c.level]})${c.wallet ? `\nWallet: ${c.wallet}` : ''}` : 'You follow nothing yet. /watch NVDA or /wallet 0x…');
  }
  if (cmd === '/level') {
    if (!/^[123]$/.test(arg)) return say(env, chat, '/level 1 — everything\n/level 2 — notable and major\n/level 3 — major only');
    await run(env, 'UPDATE chats SET level = ? WHERE chat_id = ?', Number(arg), chat);
    return say(env, chat, `Level set to ${arg}.`);
  }
  if (cmd === '/brief') {
    const subs = (await all(env, 'SELECT symbol FROM subs WHERE chat_id = ?', chat)).map((s) => s.symbol);
    if (!subs.length) return say(env, chat, 'You follow nothing yet. /watch NVDA or /wallet 0x…');
    const level = (await all(env, 'SELECT level FROM chats WHERE chat_id = ?', chat))[0].level;
    const list = await entriesFor(env, { symbols: subs, level, days: 7, limit: 12 });
    return say(env, chat, list.length ? `Last 7 days on your docket:\n\n${list.map((e) => `${e.filed.slice(5)} ${e.symbol} · ${e.title}`).join('\n')}` : 'Nothing filed at your level in the last 7 days.');
  }
  if (cmd === '/stop') {
    await run(env, 'DELETE FROM subs WHERE chat_id = ?', chat);
    await run(env, 'DELETE FROM chats WHERE chat_id = ?', chat);
    return say(env, chat, 'Removed. Nothing more will be sent.');
  }
  return say(env, chat, HELP);
}

// once a day: wallets may have new tokens
async function refreshWallets(env) {
  for (const c of await all(env, 'SELECT chat_id, wallet FROM chats WHERE wallet IS NOT NULL ORDER BY RANDOM() LIMIT 15')) {
    try {
      const held = await holdings(env, c.wallet);
      await run(env, "DELETE FROM subs WHERE chat_id = ? AND src = 'wallet'", c.chat_id);
      if (held.length) await watch(env, c.chat_id, held.map((h) => h.symbol), 'wallet');
    } catch (err) { console.error(`wallet ${c.chat_id}: ${err.message}`); }
  }
}

// ---------- RSS ----------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function rss(list, title, link) {
  const items = list.map((e) => `<item><title>${esc(`${e.symbol}: ${e.title}`)}</title><link>${esc(e.url)}</link><guid isPermaLink="false">${esc(e.id)}</guid><pubDate>${new Date(e.ts * 1000).toUTCString()}</pubDate><category>${esc(KINDS[e.kind])}</category><description>${esc(`${LEVELS[e.level]} · ${e.detail} · ${e.form}`)}</description></item>`).join('');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${esc(title)}</title><link>${esc(link)}</link><description>SEC filings about stock tokens on Robinhood Chain</description>${items}</channel></rss>`, { headers: { 'content-type': 'application/rss+xml; charset=utf-8', 'cache-control': 'public, max-age=120' } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url), p = url.pathname, q = url.searchParams;
    try {
      if (p === '/api/feed') return json({ entries: await entriesFor(env, { symbols: symbolsOf(q.get('symbols')), kind: q.get('kind'), level: Number(q.get('level')) || 1, days: Number(q.get('days')) || 30, limit: Number(q.get('limit')) || 200 }) });
      if (p === '/api/tokens') {
        const since = now() - 30 * 86400;
        return json({ tokens: await all(env, `SELECT t.symbol, t.name, t.address, t.feed, COUNT(e.id) AS entries, COALESCE(SUM(e.level = 3), 0) AS major, MAX(e.ts) AS last FROM tokens t LEFT JOIN entries e ON e.symbol = t.symbol AND e.ts >= ? GROUP BY t.symbol ORDER BY t.symbol`, since) });
      }
      if (p === '/api/brief') {
        const address = q.get('address');
        if (!isAddress(address)) return json({ error: 'address must be a 0x address' }, 400);
        const held = await holdings(env, address);
        const entries = held.length ? await entriesFor(env, { symbols: held.map((h) => h.symbol), days: Number(q.get('days')) || 30, limit: 500 }) : [];
        return json({ address, holdings: held, entries });
      }
      if (p === '/api/status') {
        const c = await env.DB.prepare('SELECT COUNT(*) AS entries, MAX(ts) AS newest FROM entries').first();
        return json({ updated: Number(await getState(env, 'last_poll')) || null, entries: c.entries, newest: c.newest, tokens: (await env.DB.prepare('SELECT COUNT(*) AS n FROM tokens').first()).n, bot: env.BOT_NAME || null, alerts: Boolean(env.TG_TOKEN && env.BOT_NAME) });
      }
      if (p === '/rss') {
        const level = Number(q.get('level')) || 2;
        if (isAddress(q.get('address'))) {
          const held = await holdings(env, q.get('address'));
          return rss(held.length ? await entriesFor(env, { symbols: held.map((h) => h.symbol), level, limit: 60 }) : [], `DOCKET · wallet ${q.get('address').slice(0, 8)}…`, url.origin);
        }
        const symbols = symbolsOf(q.get('symbols'));
        return rss(await entriesFor(env, { symbols, level, limit: 60 }), `DOCKET · ${symbols.join(', ') || 'all stock tokens'}`, url.origin);
      }
      // run the poller by hand: /admin/poll?key=ADMIN_KEY
      if (p === '/admin/poll') {
        if (!env.ADMIN_KEY || q.get('key') !== env.ADMIN_KEY) return new Response('no', { status: 403 });
        return json(await poll(env));
      }
      if (p.startsWith('/tg/') && request.method === 'POST') {
        if (!env.TG_SECRET || p.slice(4) !== env.TG_SECRET) return new Response('no', { status: 403 });
        const update = await request.json().catch(() => null);
        if (update?.message?.text) await onMessage(env, update.message).catch((err) => console.error(`tg: ${err.message}`));
        return new Response('ok');
      }
    } catch (err) {
      return json({ error: err.message }, 500);
    }
    return env.ASSETS.fetch(request);
  },
  async scheduled(event, env, ctx) {
    if (event.cron === '17 5 * * *') ctx.waitUntil(refreshWallets(env));
    else ctx.waitUntil(poll(env).then((r) => console.log(JSON.stringify(r)), (err) => console.error(`poll: ${err.message}`)));
  },
};
