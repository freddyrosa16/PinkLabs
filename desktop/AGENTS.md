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
- Keep merge/delete confirmations and comment writing, preview, and status messages from shifting the review controls. Preserve the user's position through updates without disabling normal scrolling.
- Use Codex-inspired neutral rounded surfaces, the native system sans font, and a clear bright/secondary/muted text hierarchy. Keep small metadata readable. Selected changed files use a neutral rounded highlight without a colored left stripe; added/removed lines and counts use vibrant, legible green/red.

- Follow-up visual preference: avoid edge-to-edge rectangular grids. Use separated, rounded stat cards, repository sections, PR list, and review panels with breathing room. PR-list selection and changed-file selection both use neutral rounded highlights without a colored left stripe. Use shared positive/negative tokens for all UI statuses, counts, errors, and diff markers; retain brand/language icon colors. Syntax highlighting should remain legible over added/removed backgrounds.
- PR state exception: merged PR icons and the word Merged are purple in both the list and detail header. Open, non-draft PR icons remain green; additions and successful checks also retain the shared green.
- Use a saturated violet for merged states, not pale lavender. Syntax highlighting can have its own cohesive theme inspired by Codex: violet keywords, cool blue names, warm strings/numbers, teal types, and muted comments. Distinguish CSS property names from color values. Keep syntax colors independent from green/red diff status, and preserve the approved rounded layout.
- Diff scrolling should stay within the code/file pane at its edges, with a stable reading area and remembered positions per file. Revalidating the same revision must preserve the selected file and mounted diff; a new revision must not display stale code.
- Clone offers HTTPS, SSH, and GitHub CLI. Copying and cloning use the selected method; SSH must not silently use HTTPS. Explain each method briefly without changing credentials or Git configuration.
- Keep PR navigation concise: Overview, Files changed with its count, commits, and clickable green/red totals share one row. Remove duplicate file-count headings and the separate lower tab bar. Totals open the diff; preserve file position and comment drafts across tabs.
- Refined syntax preference replaces the prior pastel palette: use distinct Codex-inspired pink keywords, green strings, orange numbers, violet functions/types, gold properties, blue tags, and subdued neutral comments. Keep normal code bright and the shared green/red change markers unchanged.
- Add restrained Lucide-style icon gestures on hover and keyboard focus for common controls. Animate once and settle, honor reduced motion, preserve brand logos, and keep automatic refresh quiet.

- Sidebar uses fresh message-plus, bot, terminal, and open-folder icons with animated panel toggles. Its edge is draggable with a bounded width, continuous movement, smooth full collapse/reopen, and a remembered expanded width. Preserve normal sidebar scrolling, keyboard resizing, reduced motion, and mobile drawer behavior.

- Keep the main application pane flush with the top of the window: no inset top gap, outer border, or rounded upper-left corner on any view. Rounded cards inside the pane remain; the sidebar and header use single subtle dividers.

- Projects and Sessions headings use readable 14px medium text. Both have a + action aligned at the right; Sessions + opens a new chat even when the group is collapsed. Keep an empty Sessions section quiet: no placeholder illustration, empty-state paragraph, or separate Start a chat link.

- New Chat follows the supplied Codex, Cursor, and Claude references: a quiet welcome with one clear heading, a separate project/local-context strip, and a provider picker beside Send. Preserve honest local practice labeling until the Python backend is connected. Do not add decorative controls for unsupported voice, attachments, permissions, or model execution.
- Follow-up: combine Codex’s simplicity with Claude’s centered opening layout. Keep the welcome and composer together in the middle for a new chat; once a conversation exists, dock the composer at the bottom. Omit starter chips and the duplicate central brand mark. Keep the input mounted across the first send so keyboard focus remains intact.

- Latest correction: the prior rose accent was an assistant choice, not a user preference. Keep the new-chat UI neutral gray and white: no decorative bar above the heading, tinted background, colored focus ring, or colored Send button. Use a compact single composer that grows with the message. Keep the centered opening, internal project/provider controls, and bottom docking after the first send. Existing PR status/diff and provider-brand colors have their separate established roles.
- The message box must look the same when idle, clicked, or being typed into: no focus-driven border brightening, glow, or background highlight. Keep the text caret and keyboard focus indicators on separate controls.
- Project and model menus open outside the entire composer, below when space permits or above when necessary. They must never cover the draft; scroll long menus within the available space and preserve the draft while selecting or dismissing them.
