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

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const subject = encodeURIComponent(`OpenView contact — ${name || 'no name'}`);
    const body = encodeURIComponent(`From: ${name} <${email}>\n\n${message}`);
    window.location.href = `mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`;
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
