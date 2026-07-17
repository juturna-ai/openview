import { NextResponse } from 'next/server';

// Full US-listed stock + ETF directory for the chart engine's Add-symbol search.
//
// Source: NASDAQ Trader's official daily symbol directories — the same files
// market-data vendors ingest. Two pipe-delimited text files cover every listing:
//   nasdaqlisted.txt — all NASDAQ listings (ETF flag included)
//   otherlisted.txt  — NYSE / NYSE American / NYSE Arca / BATS / IEX listings
// Both are public and keyless, but they don't send CORS headers and are plain
// text — so the engine can't read them client-side. This route fetches, parses
// and caches them server-side, serving a compact JSON the engine loads
// same-origin into its search catalog. Symbols become Yahoo legs (YF:<sym>), so
// dot-class shares are rewritten to Yahoo's dash form (BRK.B → BRK-B).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NASDAQ = 'https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt';
const OTHER = 'https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt';
const UPSTREAM_TIMEOUT_MS = 15_000;
// The directories change once per trading day; a long TTL keeps us to ~1 upstream
// fetch a day per server instance.
const CACHE_TTL_MS = 24 * 3600_000;

interface Listing {
  s: string; // symbol, Yahoo-compatible
  n: string; // security name
  t: 'stock' | 'etf';
  x: string; // exchange label
}

const OTHER_EXCH: Record<string, string> = {
  A: 'NYSE American',
  N: 'NYSE',
  P: 'NYSE Arca',
  Z: 'BATS',
  V: 'IEX',
};

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** Rewrite directory symbols to Yahoo's form; null = skip (untradeable on Yahoo). */
function yahooSym(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  // Preferred shares / units / warrants use $ and other suffixes with no stable
  // Yahoo mapping — skip rather than emit symbols that chart nothing.
  if (s.includes('$')) return null;
  return s.replace(/\./g, '-');
}

function parseNasdaq(text: string): Listing[] {
  const out: Listing[] = [];
  for (const line of text.split('\n').slice(1)) {
    if (line.startsWith('File Creation Time')) break;
    const f = line.split('|');
    if (f.length < 7) continue;
    if (f[3] === 'Y') continue; // test issue
    const s = yahooSym(f[0]);
    if (!s) continue;
    out.push({ s, n: f[1].trim(), t: f[6] === 'Y' ? 'etf' : 'stock', x: 'NASDAQ' });
  }
  return out;
}

function parseOther(text: string): Listing[] {
  const out: Listing[] = [];
  for (const line of text.split('\n').slice(1)) {
    if (line.startsWith('File Creation Time')) break;
    const f = line.split('|');
    if (f.length < 7) continue;
    if (f[6] === 'Y') continue; // test issue
    const s = yahooSym(f[0]);
    if (!s) continue;
    out.push({ s, n: f[1].trim(), t: f[4] === 'Y' ? 'etf' : 'stock', x: OTHER_EXCH[f[2]] ?? f[2] });
  }
  return out;
}

let cache: { at: number; payload: { symbols: Listing[] } } | null = null;
// Single-flight, same rationale as api/market/coinlogos: concurrent cold-cache
// requests would each fetch + parse two ~10k-line directory files.
let inflight: Promise<{ symbols: Listing[] }> | null = null;

async function build(): Promise<{ symbols: Listing[] }> {
  const [nas, oth] = await Promise.all([fetchText(NASDAQ), fetchText(OTHER)]);
  const seen = new Set<string>();
  const symbols = [...parseNasdaq(nas), ...parseOther(oth)].filter(
    (l) => !seen.has(l.s) && seen.add(l.s),
  );
  if (!symbols.length) throw new Error('empty directory');
  const payload = { symbols };
  cache = { at: Date.now(), payload };
  return payload;
}

export async function GET() {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return NextResponse.json(cache.payload, {
      headers: { 'Cache-Control': 'public, max-age=3600' },
    });
  }
  try {
    if (!inflight) {
      inflight = build().finally(() => {
        inflight = null;
      });
    }
    const payload = await inflight;
    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'public, max-age=3600' },
    });
  } catch {
    // Serve a stale cache over an error — the directory barely changes day to day.
    if (cache) return NextResponse.json(cache.payload);
    return NextResponse.json({ error: 'symbol directory unavailable' }, { status: 502 });
  }
}
