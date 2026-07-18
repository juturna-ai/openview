# Web Wallet: multi-portfolio + Edit menu/modal

## Plan
- [ ] portfolios.ts: add `avatar` (emoji) to PortfolioMeta; add `duplicatePortfolio(id)`; accept avatar in create/rename (or a setAvatar).
- [ ] New EditPortfolioModal.tsx: emoji avatar + Change (emoji grid) + name input w/ 24-char counter + Save.
- [ ] WalletViewWeb.tsx:
  - [ ] Replace walletName state with portfolios (ensurePortfolios/load/getActiveId).
  - [ ] Header name button → dropdown menu (switch list) + a pencil that opens an Edit/Duplicate/Remove menu.
  - [ ] "Create Portfolio" button next to Add Transaction.
  - [ ] Wire switch/create/duplicate/delete → reload holdings + snapshots + clear prices.
  - [ ] Edit → open EditPortfolioModal (rename + avatar).
- [ ] globals.css: menu, modal, emoji grid, create button.
- [ ] Typecheck + drive in browser (create, switch, edit name+avatar, duplicate, remove).
- [ ] Update ARCHITECTURE.md (storage keys: ov_portfolios avatar; web wallet portfolio parity).

## Review
- Done: portfolios.ts (avatar field, duplicatePortfolio, updatePortfolio); EditPortfolioModal.tsx (emoji grid + name + counter + Save); WalletViewWeb.tsx (PortfolioNameMenu with switch list + Edit/Duplicate/Remove, Create Portfolio button, reloadActive wiring, Edit modal); CSS for menu/modal/grid.
- Verified in-browser: create/switch/edit(name+avatar)/duplicate/remove all work; holdings follow the active portfolio; no page errors.
- Root ARCHITECTURE.md updated: ov_portfolios schema (+avatar), WalletViewWeb header/filters, new EditPortfolioModal + portfolios.ts file-map rows.
- Note: had to clear a corrupted .next dev cache + restart the 3333 dev server mid-task (chunks were 404ing → no hydration); unrelated to the code.
- Leftover: walletName.ts is now unused (replaced by portfolios.ts) but left in place — not deleting tracked code without approval.
