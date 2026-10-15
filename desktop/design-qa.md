# Pink Labs design QA

Review date: 2026-10-15. Independent review of rendered evidence; no UI edits made by this reviewer.

## Findings

- **No open P0/P1/P2 findings.** The earlier 390 px star-label collision is resolved: `qa/browser-narrow-final.jpg` shows the full “Stars, last 30 days” label and “+0 this month” on separate lines, with the chart contained inside its cell.
- The final wide repository comparison, focused comparison, 897 px browser capture, and revised narrow capture preserve the intended hierarchy without an actionable visual mismatch.

## Source and implementation evidence

Primary visual truth:

`/Users/freddster16/.codex/attachments/daecbf5b-0773-4a01-b13a-3c07be2fca4b/image-1.png`

The reference is the dark repository application inside that image. The amber desktop wallpaper is outside the requested app surface. Pink Labs branding, New Chat / Agents / Pull Requests / GitHub / IDE, Projects, Sessions, and provider icons are intentional user-requested sidebar changes.

All implementation evidence is under:

`/Users/freddster16/workspace/github.com/freddyrosa16/PinkLabs/desktop/qa/`

| Evidence | Dimensions and purpose |
| --- | --- |
| `comparison-initial.jpg` | 2720 × 890 comparison board; earlier composition and README problems |
| `comparison-final.jpg` | 2800 × 903 comparison board; source and revised native application together |
| `comparison-details.jpg` | 1900 × 490 focused comparison board; repository title, actions, metadata, statistics, About, and first commit row |
| `desktop-final.png` | Native implementation, 2880 × 1726 source pixels; 1440 × 863 CSS equivalent at 2× density |
| `browser-pinklabs.jpg` | Browser-rendered implementation at 897 × 767 CSS/pixel dimensions |
| `browser-narrow.jpg` | Earlier browser-rendered implementation at 390 × 844 CSS/pixel dimensions; documents the responsive finding |
| `browser-narrow-final.jpg` | Revised, fully loaded browser-rendered implementation at 390 × 844; confirms stacked star labels |
| `packaged-desktop.png` | Packaged ASAR application, 2880 × 1726 pixels; live repository Overview after native launch |
| `packaged-readme.png` | Packaged ASAR application, 2880 × 1726 pixels; separately opened README with rendered image, heading, and formatted text |
| `running-chat.png` | Native 2880 × 1726 capture of a practice conversation with provider icon and running presentation |

The original source is 3200 × 2000 pixels. Its app region is cropped at `(240, 150, 2960, 1850)`, yielding 2720 × 1700 pixels, then normalized to 1360 × 850 CSS-equivalent pixels. Native implementation evidence is normalized from 2880 × 1726 to 1440 × 863. The final board places both normalized captures together; it is not a comparison of separate image views. The native viewport is 80 CSS pixels wider and 13 taller, so proportions and component relationships are evaluated without claiming identical pixel coordinates. Browser screenshots use 1× image density.

The full-view and focused boards were both opened and inspected. The focused board is necessary because commit text, small metadata, action controls, dividers, and topic pills are too small to judge precisely from the full comparison alone.

### State and expected differences

The wide comparison uses the actual live `Remocn/remocn-studio` repository, Overview tab, dark theme. The source is an older snapshot of that same repository. Current stars, forks, timestamps, CI outcomes, contributor identities, and language entries may differ; those are live data, not visual defects. The current account has not starred that repository, so “Star” replaces the source’s “Starred.” The service reads seven CI commits while Overview shows five commit rows, matching the reference’s visible density.

Browser responsive captures use the real `freddyrosa16/PinkLabs` repository, with one commit and no published language/release data. They verify layout resilience and honest empty states; they are not exact-content comparisons to the populated reference. The purple sharing pill and illuminated pointer visible in native captures are macOS/computer-use overlays, not app UI.

## Five required fidelity surfaces

| Surface | Observed result |
| --- | --- |
| **Fonts and typography** | The system sans-serif family, medium-weight repository title, small metadata, compact button labels, and monospace hashes preserve the reference hierarchy. The focused board shows readable title/actions and consistent baselines. Commit truncation stays within its column. Minor antialiasing differences are expected across screenshot scaling. The revised narrow capture confirms complete, readable star labels. |
| **Spacing and layout rhythm** | The revised wide view restores the reference’s broad table region, approximately 70.5/29.5 main/About split, horizontal statistics strip, restrained borders, five commit rows, and empty lower canvas. The inline README no longer adds a competing section below commits. Sidebar content is intentionally customized. At 897 px, statistics form two columns and About moves below the table; the 390 px layout retains actions and navigation access. Stacked star labels resolve the final narrow collision. |
| **Colors and visual tokens** | Near-black sidebar, neutral charcoal canvas, subtle separators, off-white primary text, muted metadata, subdued purple links/topics, green/red CI, and warm orange stars visually follow the source. Implemented tokens include canvas `#151619`, sidebar `#0d0e10`, line `#25262b`, text `#d3d5da`, and muted `#898d98`. The evidence does not support a claim of pixel-identical color or a completed numerical contrast audit. |
| **Image quality and asset fidelity** | Repository and contributor images come from real GitHub assets and remain proportionate and sharp at their displayed sizes. The repository mark has a different current background from the old reference, an expected live-asset change. UI icons use Octicons. Provider SVGs are the actual LobeHub assets, previously verified byte-for-byte against the installed package, not approximate drawings. Pink Labs uses a new text wordmark because the user specified the app name rather than supplying a brand image. No source illustration is replaced with a fabricated asset. |
| **Copy and app-specific content** | Navigation follows the requested app structure. Repository labels retain the source’s concise organization. “No result” avoids representing unavailable CI as a pass; neutral unavailable/empty wording and removal of misleading bounded-list totals improve truthfulness. “Practice mode” clearly distinguishes sample replies from a real Python/model integration. Live repository differences are expected, and the sidebar intentionally differs from the reference’s original product. |

## Comparison history

1. **Initial comparison — blocked.** `qa/comparison-initial.jpg` showed an About column that was too narrow, seven visible commit rows instead of five, an extra inline README section that changed the lower composition, visible raw HTML from the repository README, and a daily-count star chart instead of the reference’s cumulative shape.
2. **Wide revision — visually resolved.** The coordinator changed About to 29.5%, limited the Overview commit table to five rows while retaining seven CI inputs, removed the inline README block, added sanitized rendering for the separate README view, and made the chart cumulative across the real daily counts. `qa/comparison-final.jpg` and `qa/comparison-details.jpg` confirm the wide composition and chart fixes. The later `qa/packaged-readme.png` confirms the separate README displays the source image, heading, and formatted text instead of raw HTML.
3. **Responsive comparison — blocked.** `qa/browser-pinklabs.jpg` at 897 × 767 is coherent. `qa/browser-narrow.jpg` at 390 × 844 exposes the star-label collision described above. A revised capture is required after the in-progress CSS fix.
4. **Responsive revision — resolved.** The first replacement capture was taken during repository loading and was rejected as insufficient evidence. After the loaded state was confirmed, a new `qa/browser-narrow-final.jpg` at the same 390 × 844 viewport was independently opened and inspected. The star labels are fully visible on separate lines and the chart stays contained. The packaged Overview and README captures were also opened; they retain the revised design and show working live content.

## Interaction and console evidence

The coordinator reports direct native checks for project creation, expansion/collapse and removal with conversation reparenting; Claude/OpenAI practice chats; save/restart/stop; conversation deletion/undo; the IDE folder picker and a real Cursor launch; and native clone-URL copying after an IPC fix. These are coordinator-run checks, not interaction tests repeated by this visual reviewer. The static `running-chat.png` confirms the visible provider icon and running state but cannot by itself prove animation direction or cancellation.

The coordinator checked the browser console and reported an empty error list. The packaged application was launched through native computer use with its ASAR bundle; GitHub data loaded. The coordinator clicked README and verified image, heading, table, and text nodes in the accessibility tree. This reviewer additionally inspected the rendered README screenshot; no raw HTML appears in the visible region.

The packaged **Clone to your computer** flow completed with a success toast for `/private/tmp/pink-labs-clone-check/PinkLabs`. This reviewer independently inspected the cloned repository with Git: its origin matches `https://github.com/freddyrosa16/PinkLabs.git` and its HEAD is `8a640dd Initial commit`. The coordinator also clicked **Open navigation** at the narrow browser width and verified New Chat, Agents, Pull Requests, GitHub, IDE, Projects, and Sessions in the expanded drawer's accessibility tree.

Keyboard focus traversal and numerical contrast remain outside this independent screenshot review; do not infer those checks from the screenshots.

## Implementation checklist

- [x] Open the original visual target and normalized combined full-view comparison.
- [x] Inspect the focused repository/control comparison.
- [x] Evaluate all five required fidelity surfaces.
- [x] Confirm earlier wide composition fixes from revised rendered evidence.
- [x] Inspect browser-rendered evidence at 897 × 767 and 390 × 844.
- [x] Fix narrow star-label wrapping and inspect a new, fully loaded 390 × 844 screenshot.
- [x] Record the coordinator’s README and clone results, inspect packaged screenshots, and independently verify the cloned repository.

## Follow-up polish

No additional P3 refinement is required for this visual target. The exact historical font rasterization and GitHub data snapshot cannot be reproduced from a screenshot and are not acceptance blockers.

final result: passed

---

# New Chat design QA

Source visual truth: `/var/folders/zj/jz 7f 4hk 9543_s 2lpwft 8vmvh 0000gn/T/codex-clipboard-ba 5f 3ccb-ccfe-47a 6-9451-1bc 300c 7ebd 9.png`.
Implementation: `/Users/freddster 16/.codex/visualizations/2026/10/15/01a 14034-48d 8-79b 1-9e 00-4f 73730e 3737/chat-composer-desktop.png`.
Native proof: `/Users/freddster 16/.codex/visualizations/2026/10/15/01a 14034-48d 8-79b 1-9e 00-4f 73730e 3737/chat-composer-native.png`.
Short-window proof: `/Users/freddster 16/.codex/visualizations/2026/10/15/01a 14034-48d 8-79b 1-9e 00-4f 73730e 3737/chat-composer-short.png`.

## Target and comparison

Refine the existing Pink Labs New Chat using Codex's composition and the user's Cursor/Claude references as inspiration, retaining Pink Labs identity and actual practice capabilities. This is not a pixel-exact clone. The existing sidebar, Projects/Sessions controls, and GitHub surfaces stay consistent.

Full-view comparison opened source and implementation together in one image-tool input. Source is 2896×1608 pixels at inferred 2× density (1448×804 CSS equivalent). Browser implementation is 1448×804 at 1×; compare proportions at that equivalent CSS size. Both show a dark, empty new chat with Pink Labs selected. Native proof is 2880×1726 (1440×863 at 2×), with Claude selected instead of the browser test's OpenAI. These provider/window differences are intentional.

Composer text, controls, borders, and typography are legible in the full-view native capture; a separate crop is unnecessary. The provider popup was also visually inspected at 375×640. Narrow/short-window layout and long drafts were checked at 375×480.

## Findings and fixes

- [Resolved P 2] Short-window welcome clipping. At 375×480 with a 20-line draft, the old 120px minimum welcome height pushed the heading below the 58px chat viewport. Removed its minimum height and hid the decorative mark at short heights. Post-fix DOM bounds confirm heading y 64–90 within chat area y 48–106; Send remains inside the viewport and the document width remains 375px. The short-window screenshot records this state.
- [Resolved P 2] Repeated provider descriptions made the popup needlessly tall and repetitive on mobile. Removed duplicate descriptions; the persistent practice disclosure remains below the composer.
- No remaining actionable P 0/P 1/P 2 findings.

## Required visual surfaces

- Typography: native system sans retained, restrained 30px maximum welcome heading, readable 15px input, 13px picker, muted compact supporting text. Long project names wrap in the heading and truncate in the trigger.
- Spacing/layout: centered welcome, compact starter chips near a bottom composer, inset context strip and rounded input. The composer grows to a bounded height and the input scrolls. Wider editor and starter chips differ intentionally from Codex to fit the current beginner practice workflow.
- Colors/tokens: existing charcoal canvas, neutral raised surfaces and semantic palette retained. Bright input text with restrained secondary controls; selected menu options use neutral highlights.
- Assets: existing Pink Labs mark and provider SVG assets retained. Octicons supply functional project/device/prompt/send icons. No fabricated voice/access/attachment controls.
- Copy: project-aware heading, concise starter labels, and explicit local practice/no-model disclosure. No claim of live model execution.

## Interaction evidence

Verified project mouse selection, provider keyboard selection, native Electron project End/Enter, Escape focus return, Tab dismissal into the textarea, starter fill/focus, Shift+Enter newline, Enter send, Stop cancellation, completed practice reply, session reopening after reload, disabled choices for existing sessions, and bounded 20-line input at 375×480. Independent code review found no behavioral/accessibility blocker. TypeScript, 151 existing tests, production build and macOS packaging passed. Console review found only temporary Vite missing-module reload errors during parallel file creation; no new warnings/errors appeared after the final clean reload.

## Final result

final result: passed

Residual limits: the Python agent is not connected, so all conversation replies remain local practice. VoiceOver and real mobile software-keyboard behavior were not tested. Existing Vite bundle-size warning remains.
