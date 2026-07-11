## Dev Server — Port 3333 ONLY
- The web app dev server MUST ALWAYS run on port 3333. Never use any other port under any circumstance.
- Run it from `web/` with `npm run dev` (the `dev` script is pinned to `-p 3333`).
- If port 3333 is in use, stop the process occupying it — do NOT fall back to another port.

## Communication style
- Don't narrate what you're about to do. Just do it.
- Don't explain reasoning unless I ask for it or unless a decision is genuinely ambiguous.
- When you finish a task, report only:
  1. What files changed
  2. What specifically changed in each (one line per change)
  3. Anything broken, skipped, or needing my attention
- No preambles ("I'll help you with..."), no postambles ("Let me know if...").
- If a task takes multiple steps, a short status update per step is fine — but one line, not a paragraph.
- Ask before doing anything destructive or irreversible. Otherwise, proceed.

## Before Starting
- Think through the problem first
- Read relevant files in the codebase before answering or making changes
- Never speculate about code you haven't opened
- If the user references a specific file, you MUST read it before answering
- If something is unclear, ask me rather than guessing

## Making Changes
- Keep changes as simple as possible - minimal code impact
- Avoid massive or complex changes
- Before major changes, check in with me to verify the plan
- Explain what you changed at a high level after each step
- Don't delete or refactor working code unless explicitly asked
- Preserve existing functionality when adding new features
- Never modify, overwrite, or delete `.env.local` or any `.env` files

## Security — ALWAYS Enforce

- Before EVERY commit, scan ALL staged files for:
  - API keys, tokens, passwords, secrets
  - .env values or hardcoded credentials
  - Customer, admin, or subscriber email addresses
  - Database connection strings
  - Any private URLs or internal endpoints
- NEVER expose secrets in client-side code — anything visible in browser DevTools (F12) is public:
  - No secrets in frontend components, API responses, console.logs, or HTML meta tags
  - Use server-side API routes to proxy sensitive calls — never call external APIs with keys directly from the browser
  - Ensure error messages don't leak internal paths, stack traces, or credentials
- If found, STOP and move them to environment variables or server-side only
- NEVER push sensitive data to GitHub — no exceptions

## Performance — Always Optimize
- Every change must consider speed: minimize bundle size, reduce re-renders, optimize queries
- Lazy load components, images, and assets wherever possible
- Avoid unnecessary network requests and redundant state updates
- Profile before and after changes when performance-critical

## Workflow Orchestration

### Plan Mode
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately
- Write detailed specs upfront to reduce ambiguity

### Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- One task per subagent for focused execution

### Task Management
1. **Plan First**: Write plan to `tasks/todo.md` with checkable items
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review section to `tasks/todo.md`
6. **Capture Lessons**: Update `tasks/lessons.md` after corrections

## Bug Fixes: Prove It Pattern

When given a bug or error report, the first step is to spawn a subagent to write a test that reproduces the issue. Only proceed once reproduction is confirmed.

**Test level hierarchy** — Reproduce at the lowest level that can capture the bug:

1. **Unit test** — Pure logic bugs, isolated functions (lives next to the code)
2. **Integration test** — Component interactions, API boundaries (lives next to the code)
3. **UX spec test** — Full user flows, browser-dependent behavior (lives in `apps/web/specs/`)

**For every bug fix:**

1. **Reproduce with subagent** — Spawn a subagent to write a test that demonstrates the bug. The test should *fail* before the fix.
2. **Fix** — Implement the fix.
3. **Confirm** — The test now *passes*, proving the fix works.

If the bug is truly environment-specific or transient, document why a test isn't feasible rather than skipping silently.

## Self-Improvement Loop
- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules for yourself that prevent the same mistake
- Review lessons at session start for relevant project

## Verification Before Done
- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

## Documentation
- Maintain `ARCHITECTURE.md` describing how the app works inside and out

### Always Update ARCHITECTURE.md
- After adding new features, sync layers, routes, or data types, ALWAYS update ARCHITECTURE.md
- Specifically update: storage table, key storage files, Supabase service layer, DB schema, route map
- Don't wait to be asked — treat docs as part of the implementation, not an afterthought


### Commit & Push 
- **NEVER git commit, git push, or deploy to Vercel unless I explicitly tell you to** — always wait for my go-ahead

### Never Give Destructive Instructions
- NEVER tell user to delete localStorage, clear storage, or run destructive commands
- If sync issues occur, FIX THE CODE - don't ask user to delete their data
- Always assume user data is precious and irreplaceable

### Audit Your Own Work
- After completing a feature, do a self-review of all changed files
- Check for: hardcoded values that should be dynamic, missing null guards, fields that shouldn't be in upserts
- Ask: "What happens if this data is undefined/empty/missing a field?"

### Update ARCHITECTURE.md Immediately — Not When Asked
- The rule says "always update ARCHITECTURE.md" but I still forgot and had to be reminded
- Make it the LAST step of every feature: code changes → build → ARCHITECTURE.md update → commit
- Include it in the todo list for every multi-step task