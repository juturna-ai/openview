'use client';

import React, { useCallback, useEffect, useState } from 'react';
import CoinIcon from '../wallet/CoinIcon';
import { Icon } from '../wallet/icons';
import { getFeed, setFeed } from './dataCache';
import { getNickname, setNickname } from './nickname';

// The Dashboard — the wall.
//
// The cron posts a report card here three times a day (daily, plus weekly on Mondays and monthly on
// the 1st). Anyone can react or comment without an account; writes go through the rate-limited
// server routes, never straight to Supabase (the tables have no public write policy).
//
// Before the database is configured the feed comes back empty and this falls back to showing
// today's live report as a single card — the wall with one post in it, no reactions.

type Period = 'daily' | 'weekly' | 'monthly';

interface FeedReport {
  id?: string;
  period: Period;
  reportDate: string;
  coins: { id: number; symbol: string; name: string; thumb: string; changePct: number }[];
  binancePairs: { symbol: string; changePct: number }[];
  sentiment: { fearGreed?: { value: number; classification: string } | null };
  analysis: { summary: string } | null;
  llmProvider: string | null;
  generatedAt: number;
}

interface Comment {
  id: string;
  nickname: string;
  body: string;
  created_at: string;
}

const PERIOD_LABEL: Record<Period, string> = {
  daily: 'Daily report',
  weekly: 'Weekly report',
  monthly: 'Monthly report',
};

/** Must stay in sync with ALLOWED in app/api/reports/react/route.ts. */
const REACTIONS = ['🚀', '📈', '👀', '🤔'] as const;

const timeAgo = (iso: string): string => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

function ReportCard({ report }: { report: FeedReport }) {
  const persisted = Boolean(report.id);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [mine, setMine] = useState<Set<string>>(new Set());
  const [comments, setComments] = useState<Comment[]>([]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [nick, setNick] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => setNick(getNickname()), []);

  // Wall data lives behind the card's own fetch so the feed paints immediately; a card with no DB
  // row (the live fallback) has nothing to load.
  useEffect(() => {
    if (!report.id) return;
    let dead = false;
    (async () => {
      try {
        const r = await fetch(`/api/reports/${report.id}`);
        if (!r.ok || dead) return;
        const d = await r.json();
        setCounts(
          Object.fromEntries(
            (d.reactions ?? []).map((x: { emoji: string; count: number }) => [x.emoji, x.count]),
          ),
        );
        setComments(d.comments ?? []);
      } catch {
        // The card still reads fine without its wall.
      }
    })();
    return () => {
      dead = true;
    };
  }, [report.id]);

  const react = async (emoji: string) => {
    if (!report.id || mine.has(emoji)) return;
    // Optimistic: the tally moves now, and reconciles to the server's number on reply. One reaction
    // per emoji per session — `mine` is UI courtesy, not enforcement (there's no identity to
    // enforce against; the server's rate limit is the real bound).
    setCounts((c) => ({ ...c, [emoji]: (c[emoji] ?? 0) + 1 }));
    setMine((m) => new Set(m).add(emoji));

    // Undo BOTH halves of the optimistic update. Rolling back only `counts` while leaving `mine`
    // set would leave the button permanently inert — react() early-returns on mine.has(emoji) — so
    // a single offline blip would silently cost the user that reaction for the rest of the session.
    const rollback = () => {
      setCounts((c) => ({ ...c, [emoji]: Math.max(0, (c[emoji] ?? 1) - 1) }));
      setMine((m) => {
        const n = new Set(m);
        n.delete(emoji);
        return n;
      });
    };

    try {
      const res = await fetch('/api/reports/react', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId: report.id, emoji }),
      });
      // A 2xx with an unparseable body is a failure too — don't let it reach the catch and get
      // treated as a network error with a different rollback path.
      const d = (await res.json().catch(() => null)) as { count?: number } | null;
      if (res.ok && typeof d?.count === 'number') setCounts((c) => ({ ...c, [emoji]: d.count as number }));
      else rollback();
    } catch {
      rollback();
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!report.id || busy) return;
    const body = draft.trim();
    const name = nick.trim();
    if (!name) return setErr('Pick a nickname first.');
    if (!body) return;
    setBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/reports/comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId: report.id, nickname: name, body }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(d.error ?? 'Could not post that.');
        return;
      }
      setNickname(name);
      setDraft('');
      // Refetch rather than append locally: it picks up anyone else's comments at the same time,
      // and the server's row (id, timestamp) is authoritative.
      const r = await fetch(`/api/reports/${report.id}`);
      if (r.ok) setComments((await r.json()).comments ?? []);
    } catch {
      setErr('Could not post that.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="rp-card">
      <header className="rp-card-head">
        <span className="rp-card-avatar">
          <Icon name="bar-chart" size={16} />
        </span>
        <div className="rp-card-meta">
          <span className="rp-card-author">Openview</span>
          <span className="rp-card-sub">
            {PERIOD_LABEL[report.period]} · {report.reportDate}
            {report.llmProvider ? ` · analysis by ${report.llmProvider}` : ''}
          </span>
        </div>
      </header>

      {report.analysis ? (
        <p className="rp-card-body">{report.analysis.summary}</p>
      ) : (
        <p className="rp-card-body rp-muted">
          Analysis unavailable for this report — the data below still stands.
        </p>
      )}

      <div className="rp-chips">
        {report.coins.slice(0, 6).map((c) => (
          <span className="rp-chip" key={c.id}>
            <CoinIcon symbol={c.symbol} thumb={c.thumb} size={18} />
            {c.symbol}
            <span className="gl-change-pill positive">+{c.changePct.toFixed(1)}%</span>
          </span>
        ))}
      </div>

      <footer className="rp-card-foot">
        <div className="rp-reaction-bar">
          {REACTIONS.map((e) => (
            <button
              key={e}
              className={'rp-reaction' + (mine.has(e) ? ' active' : '')}
              onClick={() => void react(e)}
              disabled={!persisted}
              aria-pressed={mine.has(e)}
              aria-label={`React ${e}`}
              title={persisted ? undefined : 'Reactions need the reports database'}
            >
              {e}
              {counts[e] ? <span className="rp-reaction-count">{counts[e]}</span> : null}
            </button>
          ))}
        </div>
        {persisted && (
          <button className="rp-inline-btn" onClick={() => setOpen((o) => !o)}>
            {comments.length > 0
              ? `${comments.length} comment${comments.length === 1 ? '' : 's'}`
              : 'Comment'}
          </button>
        )}
      </footer>

      {open && persisted && (
        <div className="rp-comments">
          {comments.map((c) => (
            <div className="rp-comment-row" key={c.id}>
              <span className="rp-comment-nick">{c.nickname}</span>
              <span className="rp-comment-body">{c.body}</span>
              <span className="rp-comment-time">{timeAgo(c.created_at)}</span>
            </div>
          ))}
          <form className="rp-comment-form" onSubmit={submit}>
            <input
              className="rp-comment-nick-input"
              value={nick}
              onChange={(e) => setNick(e.target.value)}
              placeholder="Nickname"
              maxLength={32}
              aria-label="Nickname"
            />
            <input
              className="rp-comment-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Add a comment…"
              maxLength={500}
              aria-label="Comment"
            />
            <button className="rp-inline-btn" type="submit" disabled={busy || !draft.trim()}>
              {busy ? 'Posting…' : 'Post'}
            </button>
          </form>
          {err && <p className="rp-card-note">{err}</p>}
          <p className="rp-card-note">Nicknames aren&apos;t verified — anyone can use any name.</p>
        </div>
      )}
    </article>
  );
}

export default function DashboardView({ onOpenPeriod }: { onOpenPeriod: (p: Period) => void }) {
  const [reports, setReports] = useState<FeedReport[]>(() => getFeed<FeedReport>() ?? []);
  const [loading, setLoading] = useState(false);
  const [configured, setConfigured] = useState(true);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const res = await fetch('/api/reports/list?limit=20', { signal });
      const d = res.ok ? await res.json() : null;
      const list = (d?.reports ?? []) as FeedReport[];
      setConfigured(d?.configured !== false);

      if (list.length > 0) {
        setFeed(list);
        setReports(list);
        return;
      }

      // No stored history yet — show today's live report so the wall isn't an empty box.
      const live = await fetch('/api/reports/preview?period=daily', { signal })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      if (live) {
        setFeed([live]);
        setReports([live]);
      }
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (reports.length > 0) return;
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="gl-page">
      <div className="gl-page-header">
        <h1 className="gl-page-title">Dashboard</h1>
        <p className="gl-page-subtitle">
          Reports post here automatically — daily, weekly on Mondays, monthly on the 1st.
        </p>
      </div>

      <div className="rp-toolbar">
        {/* Manual, not a poll: reports change three times a day at most, so a background timer would
            be pure waste. */}
        <button className="gl-refresh-btn" onClick={() => void load()} disabled={loading}>
          <span className={loading ? 'spinning' : undefined}>
            <Icon name="refresh-cw" size={14} />
          </span>
          Refresh
        </button>
        {!configured && (
          <span className="rp-meta">
            Reports database not connected — showing a live report, nothing is saved.
          </span>
        )}
      </div>

      {loading && reports.length === 0 && <p className="gl-page-loading">Loading the feed…</p>}

      <div className="reports-feed">
        {reports.map((r) => (
          <ReportCard key={r.id ?? `${r.period}-${r.reportDate}`} report={r} />
        ))}
      </div>

      {!loading && reports.length === 0 && (
        <p className="gl-page-loading">
          Nothing posted yet.{' '}
          <button className="rp-inline-btn" onClick={() => onOpenPeriod('daily')}>
            Open the daily tab
          </button>{' '}
          to build a report.
        </p>
      )}

      <p className="gl-page-disclaimer">
        Reports are generated by an AI model from public market data for informational purposes only.
        Not investment advice. Cryptocurrency markets are highly volatile; verify all data
        independently before making decisions.
      </p>
    </div>
  );
}
