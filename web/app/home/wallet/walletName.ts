// Web wallet's portfolio name — localStorage persistence.
//
// The browser wallet has no portfolio/user identity (that lives in the phone-app's portfolios.ts),
// so the header title is just an editable label the user picks, stored the same way as the rest of
// the wallet state.

export const WALLET_NAME_KEY = 'ov_wallet_name';

const DEFAULT_NAME = 'My Portfolio';

export function loadWalletName(): string {
  if (typeof window === 'undefined') return DEFAULT_NAME;
  try {
    const raw = window.localStorage.getItem(WALLET_NAME_KEY);
    const name = raw?.trim();
    return name ? name : DEFAULT_NAME;
  } catch {
    return DEFAULT_NAME;
  }
}

export function saveWalletName(name: string): string {
  const next = name.trim() || DEFAULT_NAME;
  try {
    window.localStorage.setItem(WALLET_NAME_KEY, next);
  } catch {
    /* private mode / storage full — keep the in-memory value */
  }
  return next;
}
