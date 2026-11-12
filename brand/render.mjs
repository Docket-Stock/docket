// DOCKET brand kit: logo.svg, avatar.png, small48.png, x-header.png here, plus logo.png, favicon and
// og-image.png in ../site. node render.mjs
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const sharp = createRequire(import.meta.url)('../../mole/worker/node_modules/sharp');
const file = (name) => fileURLToPath(new URL(name, import.meta.url));
const INK = '#121a14', W = '#f4f7f4', GREEN = '#00C805';
const grad = (id = 'g') => `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${GREEN}"/><stop offset="1" stop-color="${GREEN}"/></linearGradient>`;
// three entries, fading down, and a dot for the new one. Dark lines on the green, light lines on ink.
const glyph = (fill) => `<rect x="128" y="144" width="256" height="48" rx="24" fill="${fill}"/><rect x="128" y="232" width="256" height="48" rx="24" fill="${fill}" opacity=".62"/><rect x="128" y="320" width="156" height="48" rx="24" fill="${fill}" opacity=".4"/><circle cx="360" cy="344" r="24" fill="${fill}"/>`;
const logo = (rx = 0) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs>${grad()}</defs><rect width="512" height="512" rx="${rx}" fill="url(#g)"/>${glyph(INK)}</svg>`;
writeFileSync(file('./logo.svg'), logo(112));
const png = (size, rx = 0) => sharp(Buffer.from(logo(rx))).resize(size, size).png().toBuffer();
writeFileSync(file('./avatar.png'), await png(800));
writeFileSync(file('./small48.png'), await png(48));
writeFileSync(file('../site/logo.png'), await png(256, 112));
writeFileSync(file('../site/favicon.png'), await png(64, 112));

const SANS = 'font-family="Segoe UI, Arial, sans-serif"';
const MONO = 'font-family="Consolas, Courier New, monospace"';
// a card with docket rows: [ticker, text, level colour]
const rows = [['NVDA', 'Executive or director change', '#f59e0b'], ['GME', 'Ryan Cohen bought $46.8M', '#e5484d'], ['CVNA', 'Notice to sell $18.1M', '#f59e0b'], ['TSLA', 'Earnings results', '#f59e0b'], ['JNJ', 'Vanguard updated its stake', '#9aa3b5']];
const card = (x, y, w, n, scale = 1) => {
  const rh = 62 * scale;
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${n * rh + 20 * scale}" rx="${20 * scale}" fill="#fff" opacity=".97"/>`;
  rows.slice(0, n).forEach(([t, text, c], i) => {
    const cy = y + 10 * scale + rh * i + rh / 2;
    s += `<circle cx="${x + 30 * scale}" cy="${cy}" r="${7 * scale}" fill="${c}"/><text x="${x + 52 * scale}" y="${cy + 8 * scale}" ${MONO} font-size="${22 * scale}" font-weight="700" fill="${INK}">${t}</text><text x="${x + 138 * scale}" y="${cy + 8 * scale}" ${SANS} font-size="${22 * scale}" fill="#3b4459">${text}</text>`;
    if (i < n - 1) s += `<rect x="${x + 20 * scale}" y="${y + 10 * scale + rh * (i + 1)}" width="${w - 40 * scale}" height="1" fill="#e3e6ef"/>`;
  });
  return s;
};
const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><defs>${grad()}</defs><rect width="1200" height="630" fill="url(#g)"/>
  <svg x="64" y="60" width="72" height="72" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="${INK}"/>${glyph(W)}</svg>
  <text x="154" y="110" ${SANS} font-size="40" font-weight="700" fill="${INK}" letter-spacing="1">DOCKET</text>
  <g ${SANS} font-weight="700" font-size="66" fill="${INK}" letter-spacing="-1.5"><text x="64" y="270">What was filed</text><text x="64" y="348">about your stocks.</text></g>
  <text x="64" y="420" ${SANS} font-size="28" fill="#14331c">SEC filings for the stock tokens in your wallet.</text>
  <text x="64" y="460" ${SANS} font-size="28" fill="#14331c">Read for you, sent to you. Robinhood Chain.</text>
  ${card(650, 140, 490, 5)}
</svg>`;
await sharp(Buffer.from(og)).png().toFile(file('../site/og-image.png'));
const header = `<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="500"><defs>${grad()}</defs><rect width="1500" height="500" fill="url(#g)"/>
  <g ${SANS} font-weight="700" font-size="60" fill="${INK}" letter-spacing="-1.5"><text x="470" y="200">What was filed</text><text x="470" y="272">about your stocks.</text></g>
  <text x="472" y="330" ${SANS} font-size="26" fill="#14331c">SEC filings for the stock tokens in your wallet.</text>
  ${card(1010, 110, 430, 4, 0.86)}
</svg>`;
await sharp(Buffer.from(header)).png().toFile(file('./x-header.png'));
console.log('wrote logo.svg, avatar.png, small48.png, x-header.png, site/logo.png, site/favicon.png, site/og-image.png');
