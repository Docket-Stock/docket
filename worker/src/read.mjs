// Turns SEC filings into DOCKET entries. Shared by the Worker (live polling) and scripts/backfill.mjs.
// An entry: { id, symbol, form, kind, level, title, detail, value, filed, ts, url }
//   kind:  trade | notice | stake | event | report
//   level: 3 major, 2 notable, 1 routine

export const SEC_UA = 'Docket filings brief contact@docketstock.com';
export const KINDS = { trade: 'Insider trade', notice: 'Notice to sell', stake: 'Large holder', event: 'Company event', report: 'Report' };
export const LEVELS = { 3: 'Major', 2: 'Notable', 1: 'Routine' };
// forms DOCKET reads; anything else is ignored
export const FORMS = new Set(['4', '4/A', '144', '144/A', 'SCHEDULE 13D', 'SCHEDULE 13D/A', 'SCHEDULE 13G', 'SCHEDULE 13G/A', '8-K', '8-K/A', '10-Q', '10-K', '6-K', '20-F']);

const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}>\\s*(?:<value>)?\\s*([^<]*?)\\s*(?:</value>|</${name}>)`, 'i'));
  return m ? m[1].replace(/&amp;/g, '&') : '';
};
const tags = (block, name) => [...block.matchAll(new RegExp(`<${name}>\\s*([^<]*?)\\s*</${name}>`, 'gi'))].map((m) => m[1].replace(/&amp;/g, '&'));
const flag = (block, name) => /^(1|true)$/i.test(tag(block, name));
const titleCase = (s) => s.toLowerCase().replace(/(^|[\s\-'.&])([a-z])/g, (_, sep, c) => sep + c.toUpperCase());
const ENTITY = /\b(L\.?P\.?|LLC|INC|LTD|TRUST|FUND|PARTNERS|CORP|HOLDINGS|CAPITAL|MANAGEMENT|FINANCIAL|GROUP|SPV|CO|BANK|ADVISORS|ASSOCIATES|GRAT|N\.?A\.?|PLC|AG|SA)\b/i;
const tidy = (raw) => (raw === raw.toUpperCase() ? titleCase(raw.trim()) : raw.trim());
// ownership forms list people surname first ("COHEN RYAN")
const personName = (raw) => {
  const name = titleCase(raw.trim());
  if (ENTITY.test(raw)) return name;
  const [last, ...rest] = name.split(/\s+/);
  return rest.length ? `${rest.join(' ')} ${last}` : name;
};
export const money = (n) => (n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n)}`);
const isoDate = (us) => { const m = us.match(/^(\d\d)\/(\d\d)\/(\d{4})$/); return m ? `${m[3]}-${m[1]}-${m[2]}` : us; };

// ---- Form 4: open-market buys and sells by insiders ----
const MIN_TRADE = 10_000; // smaller tickets are mostly employee purchase plans
const BRASS = /\b(ceo|chief executive|cfo|chief financial|president|chair)/i;
function form4(xml) {
  const sides = {};
  for (const [block] of xml.matchAll(/<nonDerivativeTransaction>[\s\S]*?<\/nonDerivativeTransaction>/g)) {
    const code = tag(block, 'transactionCode');
    if (code !== 'P' && code !== 'S') continue; // grants, option exercises, tax withholding and gifts are left out
    const shares = Number(tag(block, 'transactionShares'));
    const price = Number(tag(block, 'transactionPricePerShare'));
    if (!(shares > 0) || !(price > 0)) continue;
    const side = (sides[code] ||= { shares: 0, value: 0 });
    side.shares += shares;
    side.value += shares * price;
  }
  const owner = personName(tag(xml, 'rptOwnerName'));
  const title = tag(xml, 'officerTitle');
  const role = title || (flag(xml, 'isDirector') ? 'Director' : flag(xml, 'isTenPercentOwner') ? '10% owner' : 'Insider');
  const planned = flag(xml, 'aff10b5One'); // a 10b5-1 plan was set up months earlier
  return Object.entries(sides).filter(([, s]) => s.value >= MIN_TRADE).map(([code, s]) => {
    const buy = code === 'P';
    let level = buy ? (s.value >= 1e6 || (BRASS.test(role) && s.value >= 1e5) ? 3 : 2) : s.value >= 5e6 ? 3 : s.value >= 5e5 ? 2 : 1;
    if (!buy && planned && level > 1) level--;
    return {
      kind: 'trade', level, value: Math.round(s.value), side: buy ? 'buy' : 'sell',
      title: `${owner} ${buy ? 'bought' : 'sold'} ${money(s.value)}`,
      detail: `${role} · ${Math.round(s.shares).toLocaleString('en-US')} shares${planned ? ' · planned sale (10b5-1)' : ''}`,
    };
  });
}

// ---- Form 144: an insider gives notice of a sale ----
function form144(xml, cik) {
  if (tag(xml, 'issuerCik').padStart(10, '0') !== cik) return [];
  const value = Number(tag(xml, 'aggregateMarketValue')) || 0;
  if (value < MIN_TRADE) return [];
  const who = tidy(tag(xml, 'nameOfPersonForWhoseAccountTheSecuritiesAreToBeSold'));
  const relation = tags(xml, 'relationshipToIssuer').join(', ') || 'Insider';
  const planned = /<planAdoptionDate>/.test(xml);
  const date = isoDate(tag(xml, 'approxSaleDate'));
  return [{
    kind: 'notice', level: value >= 5e6 && !planned ? 2 : 1, value: Math.round(value), side: 'sell',
    title: `${who} gave notice to sell ${money(value)}`,
    detail: `${relation} · ${Number(tag(xml, 'noOfUnitsSold')).toLocaleString('en-US')} shares${date ? ` · around ${date}` : ''}${planned ? ' · under a trading plan' : ''}`,
  }];
}

// ---- Schedule 13D / 13G: someone holds more than 5% ----
function schedule13(xml, cik, form) {
  if ((tag(xml, 'issuerCik') || tag(xml, 'issuerCIK')).padStart(10, '0') !== cik) return []; // the company filed it about someone else
  const who = tidy(tag(xml, 'reportingPersonName') || tag(xml, 'filingPersonName') || 'A holder');
  const percent = Math.max(0, ...[...tags(xml, 'classPercent'), ...tags(xml, 'percentOfClass')].map(Number).filter((n) => n >= 0 && n <= 100));
  const activist = form.startsWith('SCHEDULE 13D');
  const amended = form.endsWith('/A');
  const stake = percent > 0 ? `${percent % 1 ? percent.toFixed(1) : percent}%` : percent === 0 ? 'under 5%' : '';
  return [{
    kind: 'stake', level: activist ? (amended ? 2 : 3) : amended ? 1 : 2, value: percent, side: '',
    title: amended ? `${who} updated a stake: ${stake}` : `${who} reports a ${stake} stake`,
    detail: activist ? '13D: a holder that may push for changes' : '13G: a passive holder',
  }];
}

// ---- 8-K: the company reports something that happened ----
// item -> [plain label, level]; 9.01 (exhibits) carries no news
const ITEMS = {
  '1.01': ['Signed a major agreement', 2], '1.02': ['Ended a major agreement', 2], '1.03': ['Bankruptcy or receivership', 3], '1.05': ['Cybersecurity incident', 3],
  '2.01': ['Completed an acquisition or sale', 3], '2.02': ['Earnings results', 2], '2.03': ['Took on new debt', 2], '2.04': ['Debt called early', 3],
  '2.05': ['Restructuring or layoffs', 3], '2.06': ['Asset write-down', 3],
  '3.01': ['Delisting notice', 3], '3.02': ['Sold unregistered shares', 2], '3.03': ['Changed shareholder rights', 2],
  '4.01': ['Changed its auditor', 3], '4.02': ['Past financials can no longer be relied on', 3],
  '5.01': ['Change of control', 3], '5.02': ['Executive or director change', 2], '5.03': ['Changed its bylaws', 1], '5.07': ['Shareholder vote results', 1],
  '7.01': ['Investor disclosure', 1], '8.01': ['Other news', 1],
};
function form8k(items) {
  const known = items.filter((i) => ITEMS[i]).sort((a, b) => ITEMS[b][1] - ITEMS[a][1]);
  if (!known.length) return items.length ? [] : [{ kind: 'event', level: 1, value: 0, side: '', title: 'Current report', detail: '8-K' }];
  return [{
    kind: 'event', level: ITEMS[known[0]][1], value: 0, side: '',
    title: ITEMS[known[0]][0],
    detail: known.slice(1).map((i) => ITEMS[i][0]).concat(`8-K items ${items.join(', ')}`).join(' · '),
  }];
}

const REPORTS = { '10-Q': 'Quarterly report', '10-K': 'Annual report', '6-K': 'Foreign issuer report', '20-F': 'Annual report (foreign issuer)' };

// filing = { form, cik (10 digits, the token's company), acc, items: [], symbol, filed, ts }
// get(url) returns the body text. Returns the entries this filing produces (often none).
export async function readFiling(f, get) {
  const dir = `https://www.sec.gov/Archives/edgar/data/${Number(f.cik)}/${f.acc.replace(/-/g, '')}`;
  const base = f.form.replace('/A', '');
  let found = [];
  if (base === '4') {
    const txt = await get(`${dir}/${f.acc}.txt`);
    const m = txt.match(/<ownershipDocument>[\s\S]*?<\/ownershipDocument>/);
    found = m ? form4(m[0]) : [];
  } else if (base === '144') found = form144(await get(`${dir}/primary_doc.xml`), f.cik);
  else if (base.startsWith('SCHEDULE 13')) found = schedule13(await get(`${dir}/primary_doc.xml`), f.cik, f.form);
  else if (base === '8-K') found = form8k(f.items || []);
  else if (REPORTS[base]) found = [{ kind: 'report', level: 1, value: 0, side: '', title: REPORTS[base], detail: f.form }];
  return found.map((e, i) => ({
    id: `${f.acc}:${f.symbol}${found.length > 1 ? ':' + i : ''}`, symbol: f.symbol, form: f.form,
    ...e, filed: f.filed, ts: f.ts, url: `${dir}/${f.acc}-index.htm`,
  }));
}

// ---- the "latest filings" feed ----
// which side of a filing the token's company must be on
const ROLE = (form) => (/^4/.test(form) ? 'Issuer' : /^(144|SCHEDULE 13)/.test(form) ? 'Subject' : 'Filer');
export function parseAtom(xml) {
  const out = [];
  for (const [entry] of xml.matchAll(/<entry>[\s\S]*?<\/entry>/g)) {
    const m = entry.match(/<title>(.+?) - .* \((\d{10})\) \(([^)]+)\)<\/title>/);
    const acc = entry.match(/accession-number=([\d-]+)/)?.[1];
    if (!m || !acc) continue;
    const form = m[1];
    if (!FORMS.has(form) || m[3] !== ROLE(form)) continue;
    const updated = entry.match(/<updated>([^<]+)<\/updated>/)?.[1];
    out.push({
      form, cik: m[2], acc,
      items: [...entry.matchAll(/Item (\d\.\d\d)/g)].map((x) => x[1]),
      filed: entry.match(/Filed:&lt;\/b&gt;\s*([\d-]+)/)?.[1] || (updated || '').slice(0, 10),
      ts: updated ? Math.floor(Date.parse(updated) / 1000) : Math.floor(Date.now() / 1000),
    });
  }
  return out;
}
export const ATOM_FEEDS = [
  ['4', 'only'], ['8-K', 'include'], ['144', 'include'], ['SCHEDULE 13', 'include'], ['10-Q', 'include'], ['10-K', 'include'], ['6-K', 'include'],
];
export const atomUrl = (type, owner, start = 0) => `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=${encodeURIComponent(type)}&company=&dateb=&owner=${owner}&start=${start}&count=100&output=atom`;

// ---- a company's own filing list (data.sec.gov/submissions), used for backfill and the safety sweep ----
export function parseSubmissions(json, cik, symbol, sinceDate) {
  const r = json.filings.recent, out = [];
  for (let i = 0; i < r.form.length && r.filingDate[i] >= sinceDate; i++) {
    if (!FORMS.has(r.form[i])) continue;
    out.push({
      form: r.form[i], cik, symbol, acc: r.accessionNumber[i],
      items: (r.items[i] || '').split(',').filter(Boolean),
      filed: r.filingDate[i], ts: Math.floor(Date.parse(r.acceptanceDateTime[i]) / 1000) || 0,
    });
  }
  return out;
}

// ---- token list: Robinhood's registry joined with SEC's ticker table ----
export async function loadTokens(get) {
  const { assets } = JSON.parse(await get('https://api.robinhood.com/rhj/assets'));
  const feeds = new Map();
  try {
    for (const f of JSON.parse(await get('https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json'))) {
      const m = f.name.match(/^Robinhood ([A-Z.]+)\s*[-/]\s*USD$/);
      if (m && f.proxyAddress && f.decimals === 8) feeds.set(m[1], f.proxyAddress);
    }
  } catch { /* prices are optional */ }
  const tickers = Object.values(JSON.parse(await get('https://www.sec.gov/files/company_tickers.json')));
  const cikOf = new Map(tickers.map((t) => [t.ticker, String(t.cik_str).padStart(10, '0')]));
  const tokens = [];
  for (const a of assets) {
    if (a.status !== 'ASSET_STATUS_ACTIVE') continue;
    const dep = a.deployments?.find((d) => d.chainId === 4663);
    if (!dep) continue;
    tokens.push({
      symbol: a.tokenSymbol, name: a.tokenName.replace(/\s*•\s*Robinhood Token$/, ''), address: dep.contractAddress,
      feed: feeds.get(a.tokenSymbol) || null, cik: cikOf.get(a.tokenSymbol) || cikOf.get(a.tokenSymbol.replace('.', '-')) || null,
    });
  }
  return tokens.sort((a, b) => a.symbol.localeCompare(b.symbol));
}
