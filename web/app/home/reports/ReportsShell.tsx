'use client';

import React from 'react';
import Sidebar from './Sidebar';

// Sidebar + content, mirroring WalletShell. The Reports tab currently has no views of its own —
// the sidebar carries only its brand header and clock, and the content area is an empty canvas.

export default function ReportsShell() {
  return (
    <div className="journal-shell">
      <Sidebar />
      <div className="journal-content" />
    </div>
  );
}
