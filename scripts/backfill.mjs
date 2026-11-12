// Reads the last DAYS of filings for every stock token's company and writes data/backfill.sql
// (tokens, entries, seen). Load it with:
//   npx wrangler d1 execute docket --remote --file=../data/backfill.sql   (from worker/)
// Filings already read are kept in data/backfill.json, so a rerun only fetches new ones.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SEC_UA, loadTokens, parseSubmissions, readFiling } from '../worker/src/read.mjs';

const DAYS = Number(process.env.DAYS || 30);
const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (url) => {
  const sec = url.includes('sec.gov');
  if (sec) await sleep(120); // SEC allows 10 requests a second
  const res = await fetch(url, sec ? { headers: { 'User-Agent': process.env.SEC_USER_AGENT || SEC_UA } } : {});
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
};

const since = new Date(Date.now() - DAYS * 864e5).toISOString().slice(0, 10);
const old = await readFile(path.join(dataDir, 'backfill.json'), 'utf8').then(JSON.parse, () => ({ entries: [], seen: [] }));
const seen = new Set(old.seen);
const entries = old.entries.filter((e) => e.filed >= since);
const tokens = await loadTokens(get);
let read = 0;
for (const t of tokens) {
  if (!t.cik) continue;
  try {
    const filings = parseSubmissions(JSON.parse(await get(`https://data.sec.gov/submissions/CIK${t.cik}.json`)), t.cik, t.symbol, since);
    for (const f of filings) {
      const key = `${f.acc}:${t.symbol}`;
      if (seen.has(key)) continue;
      try { entries.push(...await readFiling(f, get)); read++; seen.add(key); } catch (err) { console.error(`  ${t.symbol} ${f.form} ${f.acc}: ${err.message}`); }
    }
  } catch (err) { console.error(`skipped ${t.symbol}: ${err.message}`); }
}
entries.sort((a, b) => b.ts - a.ts);
await writeFile(path.join(dataDir, 'backfill.json'), JSON.stringify({ updated: new Date().toISOString(), tokens, entries, seen: [...seen] }));

const q = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
let sql = 'DELETE FROM tokens;\n';
for (const t of tokens) sql += `INSERT INTO tokens VALUES (${[t.symbol, t.name, t.address, t.feed, t.cik].map(q).join(',')});\n`;
for (const e of entries) sql += `INSERT OR REPLACE INTO entries VALUES (${[e.id, e.symbol, e.form, e.kind, e.level, e.title, e.detail, e.value, e.side, e.filed, e.ts, e.url].map(q).join(',')});\n`;
const now = Math.floor(Date.now() / 1000);
for (const k of seen) sql += `INSERT OR IGNORE INTO seen VALUES (${q(k)},${now});\n`;
await writeFile(path.join(dataDir, 'backfill.sql'), sql);
const by = {}; for (const e of entries) by[e.kind] = (by[e.kind] || 0) + 1;
console.log(`${tokens.length} tokens (${tokens.filter((t) => t.cik).length} with SEC filings), ${read} new filings read, ${entries.length} entries`, by);
