import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'About us — Openview' };

export default function AboutUsPage() {
  return (
    <div className="ov-container ov-prose">
      <h2 className="ov-h2">About us</h2>
      <p>
        We build tools that make professional-grade market charting free and open to everyone. We
        started Openview because the best charts shouldn&apos;t sit behind a subscription — including
        the synthetic spread and ratio pairs that most platforms lock away.
      </p>
      <p>
        Openview is keyless and client-side by design: your data stays in your browser, there is no
        account to create, and nothing is tracked. It&apos;s the charting experience we wanted for
        ourselves, shared with anyone who wants it.
      </p>
      <p>
        <a href="/index.html">Try the charts →</a>
      </p>
    </div>
  );
}
