import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Privacy — OpenView' };

export default function PrivacyPage() {
  return (
    <div className="ov-container ov-prose">
      <h2 className="ov-h2">Privacy</h2>
      <p>
        OpenView is keyless and client-side by design. Your charts, watchlists, and settings stay in
        your browser — there is no account to create and nothing is sent to us.
      </p>
      <p>
        We don&apos;t track you, sell data, or share anything with third parties. Because your data
        never leaves your device, there is nothing for us to store, breach, or hand over.
      </p>
      <p>
        <a href="/index.html">Try the charts →</a>
      </p>
    </div>
  );
}
