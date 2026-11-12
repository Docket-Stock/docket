// Writes the six site pages into site/ from one shared frame (side rail, head tags, footer).
// Run: node build.mjs   (set SITE_URL once the domain is known)
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SITE = (process.env.SITE_URL || 'https://docketstock.com').replace(/\/$/, '');
const V = 3; // bump to refresh cached css, js and the preview image
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'site');

const NAV = [
  ['index', 'Brief', 'M4 6h16M4 12h16M4 18h10'],
  ['feed', 'Feed', 'M4 5h16v4H4zM4 11h16v4H4zM4 17h16v2H4z'],
  ['companies', 'Companies', 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z'],
  ['alerts', 'Alerts', 'M12 3a6 6 0 0 0-6 6v4l-2 3h16l-2-3V9a6 6 0 0 0-6-6zM10 19a2 2 0 0 0 4 0'],
  ['how', 'How to read it', 'M12 17v-1c0-2 3-2.5 3-5a3 3 0 0 0-6 0M12 20h.01'],
  ['token', '$DOCKET', 'M12 3v18M7 7h7a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h8'],
];
const href = (id) => (id === 'index' ? './' : `${id}.html`);

const pages = {
  index: {
    title: 'DOCKET: what was filed about the stocks in your wallet',
    desc: 'Paste a Robinhood Chain wallet and read every SEC filing about the stock tokens in it: insider trades, notices to sell, large holders, company events. Then get them as alerts.',
    body: `
    <section class="hero">
      <p class="eyebrow">SEC filings &rarr; stock tokens on Robinhood Chain</p>
      <h1>What was filed about <span class="grad">your stocks</span>.</h1>
      <p class="lede">Paste a wallet. DOCKET finds the stock tokens in it and lists what their companies and insiders filed with the SEC in the last 30 days, most important first.</p>
      <form id="brief-form" class="ask">
        <input id="address" autocomplete="off" spellcheck="false" placeholder="0x… Robinhood Chain address" aria-label="Wallet address">
        <button class="btn primary" type="submit">Read my wallet</button>
        <button class="btn" type="button" id="connect">Use my wallet</button>
      </form>
      <p class="fine">Read-only. Nothing to sign, no account. The address is only used to read token balances.</p>
    </section>

    <section id="brief" hidden></section>

    <section id="today">
      <div class="head"><h2>On the docket now</h2><a href="feed.html">Whole feed &rarr;</a></div>
      <div class="tiles" id="tiles"></div>
      <div class="list" id="top-list"><p class="muted">Reading…</p></div>
    </section>`,
  },
  feed: {
    title: 'Feed: every SEC filing about stock tokens | DOCKET',
    desc: 'Insider trades, notices to sell, large holders, company events and reports for every company with a stock token on Robinhood Chain. Last 30 days, filter by type, level and ticker.',
    body: `
    <section>
      <p class="eyebrow">Last 30 days, all stock tokens</p>
      <h1 class="title">Feed</h1>
      <div class="filters">
        <input id="feed-search" class="search" placeholder="Ticker, e.g. NVDA" autocomplete="off" spellcheck="false" aria-label="Filter by ticker">
        <div class="chips" id="feed-levels"></div>
        <div class="chips" id="feed-kinds"></div>
      </div>
      <p class="muted" id="feed-count"></p>
      <div class="list" id="feed-list"><p class="muted">Reading…</p></div>
    </section>`,
  },
  companies: {
    title: 'Companies with a stock token | DOCKET',
    desc: 'Every company that has a stock token on Robinhood Chain, with the number of SEC filings read about it in the last 30 days.',
    body: `
    <section>
      <p class="eyebrow">One card per stock token</p>
      <h1 class="title">Companies</h1>
      <div class="filters">
        <input id="co-search" class="search" placeholder="Ticker or name" autocomplete="off" spellcheck="false" aria-label="Find a company">
        <div class="chips" id="co-filters"></div>
      </div>
      <div id="co-detail" hidden></div>
      <div class="grid" id="co-grid"><p class="muted">Reading…</p></div>
    </section>`,
  },
  alerts: {
    title: 'Alerts: get a message when something is filed | DOCKET',
    desc: 'Follow a wallet or a list of tickers. DOCKET reads new SEC filings every five minutes and sends them to Telegram, RSS or your own agent through a free API.',
    body: `
    <section>
      <p class="eyebrow">New filings are read every 5 minutes</p>
      <h1 class="title">Alerts</h1>
      <p class="lede">Follow a wallet or pick tickers. When something is filed about them, you get one short message with what happened and a link to the filing.</p>
      <div class="builder">
        <label for="al-input">Wallet address or tickers</label>
        <input id="al-input" class="search wide" placeholder="0x… or NVDA, TSLA, GME" autocomplete="off" spellcheck="false">
        <p class="fine" id="al-note">Type a wallet address to follow everything in it, or tickers separated by commas.</p>
      </div>
      <div class="ways">
        <article class="way">
          <h3>Telegram</h3>
          <p>A bot message for every filing at your level. Change the level with <code>/level</code>, see your list with <code>/list</code>.</p>
          <div id="way-tg"><p class="muted">Checking…</p></div>
        </article>
        <article class="way">
          <h3>RSS</h3>
          <p>A feed for any reader app. Works now, no account.</p>
          <div class="copy"><code id="rss-url"></code><button class="btn small" data-copy="rss-url">Copy</button></div>
        </article>
        <article class="way">
          <h3>API for agents</h3>
          <p>Plain JSON, free, no key. Ask for a wallet's brief or a feed by ticker.</p>
          <div class="copy"><code id="api-url"></code><button class="btn small" data-copy="api-url">Copy</button></div>
        </article>
      </div>
      <h2>What a message looks like</h2>
      <pre class="sample" id="sample"></pre>
    </section>`,
  },
  how: {
    title: 'How to read the docket | DOCKET',
    desc: 'What each kind of SEC filing means in plain words, how DOCKET sets the level of an entry, where the data comes from and what it leaves out.',
    body: `
    <section>
      <p class="eyebrow">Plain words, no forecasts</p>
      <h1 class="title">How to read it</h1>
      <p class="lede">Every entry is one SEC filing about a company that has a stock token on Robinhood Chain. DOCKET reads the filing, says what it is in one line and gives it a level.</p>

      <h2>Five kinds of entry</h2>
      <div class="table">
        <div class="tr th"><span>Kind</span><span>SEC form</span><span>What it tells you</span></div>
        <div class="tr"><span><b>Insider trade</b></span><span>Form 4</span><span>An executive, director or 10% owner bought or sold shares on the open market. Grants, option exercises, tax withholding and gifts are left out, and so are trades under $10K.</span></div>
        <div class="tr"><span><b>Notice to sell</b></span><span>Form 144</span><span>An insider tells the SEC they intend to sell. It comes before the sale itself, so it is the earliest sign.</span></div>
        <div class="tr"><span><b>Large holder</b></span><span>Schedule 13D, 13G</span><span>Someone holds more than 5% of the company, or changed such a stake. 13D holders may push for changes, 13G holders are passive.</span></div>
        <div class="tr"><span><b>Company event</b></span><span>Form 8-K</span><span>The company reports something that happened: earnings, a deal, a departure, new debt, layoffs, an auditor change.</span></div>
        <div class="tr"><span><b>Report</b></span><span>10-Q, 10-K, 6-K, 20-F</span><span>A scheduled quarterly or annual report, or a foreign issuer's report.</span></div>
      </div>

      <h2>Three levels</h2>
      <div class="table levels">
        <div class="tr"><span><i class="dot l3"></i><b>Major</b></span><span>An insider buy of $1M or more, or a buy of $100K or more by the CEO, CFO, president or chair. An unplanned sale of $5M or more. A new 13D holder. Events such as bankruptcy, a completed acquisition, layoffs, a write-down, an auditor change, a delisting notice, a cybersecurity incident.</span></div>
        <div class="tr"><span><i class="dot l2"></i><b>Notable</b></span><span>Other insider buys. Sales of $500K or more. A notice to sell $5M or more outside a trading plan. A new 13G holder. Earnings, a major agreement, an executive or director change, new debt.</span></div>
        <div class="tr"><span><i class="dot l1"></i><b>Routine</b></span><span>Small sales, planned sales, updates of passive stakes, scheduled reports, investor presentations, vote results.</span></div>
      </div>
      <p class="fine">A sale under a 10b5-1 trading plan was scheduled months earlier, so it is moved one level down. The level is a sorting rule written in code, the same for every company. It is not a forecast.</p>

      <h2>Where the data comes from</h2>
      <div class="table">
        <div class="tr"><span><b>Filings</b></span><span>SEC EDGAR</span><span>The public "latest filings" feed, read every five minutes, plus each company's own filing list as a second pass.</span></div>
        <div class="tr"><span><b>Tokens</b></span><span>Robinhood</span><span>The stock token registry on Robinhood Chain (chain 4663). A company without a token is not read.</span></div>
        <div class="tr"><span><b>Wallets</b></span><span>Robinhood Chain</span><span>Balances are read live when you ask for a brief. Prices come from on-chain Chainlink feeds.</span></div>
      </div>
      <p class="fine">DOCKET keeps 45 days of entries. A filing usually shows up within five to ten minutes of the SEC accepting it.</p>
    </section>`,
  },
  token: {
    title: '$DOCKET token | DOCKET',
    desc: 'The $DOCKET token on Robinhood Chain: contract address, where it trades and what it is for. The brief, the feed and the alerts stay free.',
    body: `
    <section>
      <p class="eyebrow">Robinhood Chain</p>
      <h1 class="title">$DOCKET</h1>
      <p class="lede" id="token-note"></p>
      <div class="ca-box" id="ca-box"></div>
      <div class="links" id="token-links"></div>
      <h2>Token facts</h2>
      <div class="table" id="tokenomics"></div>
      <p class="fine">The brief, the feed, RSS and the API are free and need no token. Nothing on this site is investment advice.</p>
    </section>`,
  },
};

const icon = (d) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
const frame = (id, p) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${p.title}</title>
<meta name="description" content="${p.desc}">
<link rel="canonical" href="${SITE}/${id === 'index' ? '' : id + '.html'}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="DOCKET">
<meta property="og:title" content="${p.title}">
<meta property="og:description" content="${p.desc}">
<meta property="og:url" content="${SITE}/${id === 'index' ? '' : id + '.html'}">
<meta property="og:image" content="${SITE}/og-image.png?v=${V}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${p.title}">
<meta name="twitter:description" content="${p.desc}">
<meta name="twitter:image" content="${SITE}/og-image.png?v=${V}">
<link rel="icon" type="image/png" href="favicon.png?v=${V}">
<link rel="alternate" type="application/rss+xml" title="DOCKET: notable filings" href="/rss">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="styles.css?v=${V}">
</head>
<body data-page="${id}">
<aside class="rail">
  <a class="brand" href="./"><img src="logo.png?v=${V}" alt="" width="34" height="34"><span>DOCKET</span></a>
  <nav>
${NAV.map(([n, label, d]) => `    <a href="${href(n)}"${n === id ? ' class="on" aria-current="page"' : ''}>${icon(d)}<span>${label}</span></a>`).join('\n')}
  </nav>
  <div class="rail-foot">
    <p class="status" id="status"><i></i><span>Connecting…</span></p>
    <div id="rail-ca"></div>
  </div>
</aside>
<main class="main">${p.body}
    <footer>
      <div class="foot-links" id="foot-links"></div>
      <p>DOCKET is not affiliated with Robinhood, Pons, the SEC, or any company shown. Data: SEC EDGAR, the Robinhood stock token registry and Robinhood Chain. Stock tokens are not available to US persons. Nothing here is investment advice.</p>
    </footer>
</main>
<script src="config.js?v=${V}"></script>
<script src="app.js?v=${V}"></script>
</body>
</html>
`;

for (const [id, p] of Object.entries(pages)) await writeFile(path.join(out, `${id}.html`), frame(id, p));
console.log(`wrote ${Object.keys(pages).length} pages for ${SITE}`);
