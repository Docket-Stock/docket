CREATE TABLE IF NOT EXISTS tokens (symbol TEXT PRIMARY KEY, name TEXT, address TEXT, feed TEXT, cik TEXT);
CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY, symbol TEXT, form TEXT, kind TEXT, level INTEGER, title TEXT, detail TEXT,
  value REAL, side TEXT, filed TEXT, ts INTEGER, url TEXT
);
CREATE INDEX IF NOT EXISTS entries_ts ON entries (ts DESC);
CREATE INDEX IF NOT EXISTS entries_symbol ON entries (symbol, ts DESC);
-- filings already read (also the ones that produced no entry), so they are not fetched twice
CREATE TABLE IF NOT EXISTS seen (acc TEXT PRIMARY KEY, ts INTEGER);
CREATE TABLE IF NOT EXISTS chats (chat_id TEXT PRIMARY KEY, level INTEGER DEFAULT 2, wallet TEXT, created INTEGER);
CREATE TABLE IF NOT EXISTS subs (chat_id TEXT, symbol TEXT, src TEXT, PRIMARY KEY (chat_id, symbol));
CREATE INDEX IF NOT EXISTS subs_symbol ON subs (symbol);
CREATE TABLE IF NOT EXISTS outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT, text TEXT);
CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT);
