// The commenter's display name, kept in localStorage.
//
// There are no accounts, so this is a label, not an identity — anyone can type anything, including
// someone else's name. The wall says so out loud rather than implying a verification that doesn't
// exist. Server-side the name is length-checked and stored as given; nothing is inferred from it.
//
// Same defensive try/catch as useSidebarResize: storage access throws outright in some private
// browsing modes, and a name field is never worth taking the page down for.

const KEY = 'openview:reports-nickname';

export function getNickname(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

export function setNickname(v: string) {
  try {
    localStorage.setItem(KEY, v.slice(0, 32));
  } catch {
    // Non-fatal: the name just won't survive a reload.
  }
}
