# DOCKET

What was filed with the SEC about the stocks in your wallet.

DOCKET reads SEC filings for every company that has a stock token on Robinhood Chain (chain 4663), says what each filing is in one line, gives it a level and sends it to the people who hold that token.

- **Brief**: paste a wallet, get the last 30 days for the stock tokens in it, most important first
- **Feed**: every entry, filter by kind, level and ticker
- **Companies**: one page per stock token
- **Alerts**: Telegram bot, RSS, and a free JSON API for agents

The site is free and needs no account, no wallet connection and no token.

## What it reads

| Kind | SEC form | In plain words |
| --- | --- | --- |
| Insider trade | Form 4 | An executive, director or 10% owner bought or sold on the open market |
| Notice to sell | Form 144 | An insider tells the SEC they intend to sell |
| Large holder | Schedule 13D, 13G | Someone holds more than 5%, or changed such a stake |
| Company event | Form 8-K | Earnings, a deal, a departure, new debt, layoffs, an auditor change |
| Report | 10-Q, 10-K, 6-K, 20-F | A scheduled report |

Each entry gets a level: **Major**, **Notable** or **Routine**. The rules are in `worker/src/read.mjs` and on the "How to read it" page. They are the same for every company and they are not a forecast.

## API

```
GET /api/feed?symbols=NVDA,TSLA&kind=trade&level=2&days=30&limit=200
GET /api/tokens
GET /api/brief?address=0x...
GET /api/status
GET /rss?symbols=NVDA,TSLA        (or ?address=0x...)
```

`kind` is one of `trade`, `notice`, `stake`, `event`, `report`. `level` is the lowest level to return (1 to 3).

## Layout

```
worker/src/read.mjs    filing parsers and level rules (shared by the Worker and the backfill)
worker/src/index.js    API, poller (every 5 minutes), Telegram bot, RSS
worker/schema.sql      D1 tables
scripts/backfill.mjs   reads the last 30 days for every company -> data/backfill.sql
build.mjs              writes the six pages into site/
site/                  static site (app.js, styles.css, config.js)
brand/render.mjs       logo, avatar, header, preview image
```

## Run it

```
cd worker
npx wrangler d1 create docket                 # paste the id into wrangler.toml
npx wrangler d1 execute docket --remote --file=schema.sql
node ../scripts/backfill.mjs                  # about 5 minutes
npx wrangler d1 execute docket --remote --file=../data/backfill.sql
node ../build.mjs
npx wrangler deploy
```

Telegram alerts need two secrets (`TG_TOKEN`, `TG_SECRET`), the bot name in `BOT_NAME`, and the webhook set to `/tg/<TG_SECRET>`. Wallet briefs through the API and the bot need a keyed Robinhood Chain RPC in `RH_RPC_URL`; the site reads wallets in the browser and does not need it.

SEC asks every client for a User-Agent with contact details. Set your own in `worker/src/read.mjs`.

## What it is not

DOCKET shows what public filings say. An entry is not a forecast and not investment advice. Stock tokens are issued by Robinhood Assets (Jersey) Limited and are not available to US persons or in several other places. DOCKET is not affiliated with Robinhood, Pons, the SEC, or any company shown.

## Token

$DOCKET is live on Pons, Robinhood Chain (chain 4663).

```
0x3ddd057339d4a93016e5b57f989100c72d43ad3c
```

The same address is on [docketstock.com/token](https://docketstock.com/token.html), in the bio and the launch post on [x.com/docketstock](https://x.com/docketstock), and here. If they do not match, it is not ours. Trade it on [Pons](https://ponsfamily.com/launchpad/0x3ddd057339d4a93016e5b57f989100c72d43ad3c). The site stays free and needs no token.

## License

MIT
