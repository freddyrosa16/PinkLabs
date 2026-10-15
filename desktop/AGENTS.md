# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Pink Labs design decisions — 2026-10-15

- Follow the supplied Remocn Studio screenshot for the GitHub main area: neutral charcoal canvas, near-black sidebar, compact rows, subtle dividers, recent commits, CI, PR authors, languages, About/README, and repository actions. Use real GitHub data and honest empty states.
- Sidebar: Pink Labs, New Chat, Agents, Pull Requests, GitHub, IDE, collapsible Projects and Sessions. Support removing projects and deleting conversations from either list.
- Show the selected Claude, OpenAI/Codex, or Grok provider icon beside conversations. Running titles use a gray shimmer moving left to right, with reduced-motion support.
- Freddy is building the Python agent through Boot.dev. Keep practice chat clearly labeled until a real backend is connected; do not replace his learning work with an unsolicited agent implementation. Agents details are intentionally deferred.
- GitHub should update automatically when returning to the app and while actively using it. Preserve the displayed repository during refreshes, coalesce repeated triggers, and pause or back off polling when inactive or unavailable.
- The owner name in the top breadcrumb is informational text. Only the repository name opens the picker. The bottom-left area is reserved for future account controls.
- Automatic GitHub checks should be quiet, without recurring spinners or status-label changes, and pause while viewing conversations. Explicit refresh can show progress.
- Show actual programming-language logos beside language names, with a colored-dot fallback for unsupported languages.
- Create pull requests inside Pink Labs with branch comparison, title, description, and draft status. Preserve the form while viewing the same repository; external links must clearly say they open GitHub.
- Open pull request details inside Pink Labs and allow merging after an explicit confirmation that names the PR, destination branch, and merge method. Show GitHub checks and blocking reasons; refresh after a successful merge.
- The Pull Requests tab is a persistent workspace: a compact selectable PR list above an inline review area, with Overview and Files changed tabs, readable code diffs, merge controls, and guarded deletion of merged remote branches. Keep merged/closed PRs accessible after the open count reaches zero. Do not put PR review in a modal or send normal diff review to a browser.
- Keep the PR conversation inside that workspace. Show discussion and review comments, and allow writing, previewing, and posting a general PR comment without leaving the app. Preserve drafts while switching review tabs and refreshing.
