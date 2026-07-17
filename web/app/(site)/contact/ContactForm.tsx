'use client';

import { useState } from 'react';

// No backend: submitting opens the user's mail client via a mailto: link. This keeps the
// site fully static/keyless (no server route, no stored data, no leaked credentials).
// Change CONTACT_EMAIL to your real inbox.
const CONTACT_EMAIL = 'hello@openview.app';

export default function ContactForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  // Firing the mailto: gives no callback, and on a machine with no mail client it silently
  // no-ops — so we always show a confirmation panel with a copyable address as the fallback
  // path, rather than leaving the user unsure whether anything happened.
  const [sent, setSent] = useState(false);
  const [copied, setCopied] = useState(false);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const subject = encodeURIComponent(`Openview contact — ${name || 'no name'}`);
    const body = encodeURIComponent(`From: ${name} <${email}>\n\n${message}`);
    window.location.href = `mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`;
    setSent(true);
  }

  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(CONTACT_EMAIL);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the address is shown in the text regardless */
    }
  }

  if (sent) {
    return (
      <div className="ov-form ov-form-sent" role="status">
        <p>
          Your mail app should have opened with the message ready to send. If nothing opened, email
          us directly at{' '}
          <button type="button" className="ov-link-btn" onClick={copyEmail}>
            {CONTACT_EMAIL}
          </button>
          {copied && <span className="ov-copied"> copied</span>}.
        </p>
        <button
          type="button"
          className="ov-btn"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => setSent(false)}
        >
          Back
        </button>
      </div>
    );
  }

  return (
    <form className="ov-form" onSubmit={onSubmit}>
      <div className="ov-field">
        <label htmlFor="c-name">Name</label>
        <input id="c-name" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="ov-field">
        <label htmlFor="c-email">Email</label>
        <input id="c-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div className="ov-field">
        <label htmlFor="c-msg">Message</label>
        <textarea id="c-msg" value={message} onChange={(e) => setMessage(e.target.value)} required />
      </div>
      <button type="submit" className="ov-btn primary" style={{ alignSelf: 'flex-start' }}>
        Send message
      </button>
    </form>
  );
}
