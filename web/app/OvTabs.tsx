import Link from 'next/link';

// Dark folder-tab bar (browser-tab style) shared by the site pages. Two tabs: Home ↔
// OpenView (the chart). Mirrors the tab bar injected into the chart engine (index.html
// #ovTabs) so the two surfaces look identical. `active` marks the current tab.
//
// Not rendered inside the chart engine or the phone app — the engine carries its own copy
// (hidden on embed), so the mobile WebView never shows tabs.
export default function OvTabs({ active }: { active: 'home' | 'openview' }) {
  return (
    <div className="ov-tabs">
      <Link href="/home" className={'ov-tab' + (active === 'home' ? ' active' : '')}>Home</Link>
      {/* Plain anchor to `/index.html` (the raw chart engine). We target index.html — NOT `/` —
          because a bare `/` redirects to /home for browsers (see next.config.js); /index.html
          serves the engine directly with no redirect. */}
      <a href="/index.html" className={'ov-tab' + (active === 'openview' ? ' active' : '')}>OpenView</a>
    </div>
  );
}
