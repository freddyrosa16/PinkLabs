# Pink Labs desktop

The first working interface for Pink Labs. The desktop app lives in this folder; your Python agent stays in the repository’s root folder, so you can build it separately.

Think of the interface as the dashboard of a car. It already has buttons, screens, and saved conversations. Your Python agent will become the engine that answers the conversations.

## What works now

- **GitHub:** choose a repository, read its description, topics, README, languages, recent commits, CI results, open pull requests and authors, releases, contributors, and star history. These come from GitHub, using your existing GitHub CLI sign-in.
- **Automatic updates:** returning to the app or reopening its GitHub views requests fresh data. While a GitHub view is visible, focused, and online, it checks quietly two minutes after each completed request. Conversations and inactive windows pause polling. Automatic checks preserve the screen without spinning the refresh button or changing the connection label. Failures retain the last data and retry more slowly; explicit Refresh still shows progress. GitHub checks do not restart running conversations. These are periodic checks; truly instant external updates would require webhook delivery infrastructure.
- **Pull requests:** open **Pull Requests → New pull request**, choose published base and compare branches, add a title and description, and optionally mark it as a draft. Pink Labs checks for new commits and existing PRs, then creates the PR without leaving the app. Your text survives closing the form or changing screens while the same repository stays selected; it is not saved across app restarts. The Pull Requests tab shows All, Open, and Closed / merged views. Selecting a PR opens its description, branches, change counts, and checks in the review area below the list. Switch to **Files changed** to choose a file and read its diff with line numbers and added/removed lines. Choose an allowed merge method, then **Merge pull request → Confirm merge**. The app rechecks the PR and pins the reviewed commit; GitHub enforces its merge rules. Merged PRs remain readable. Use **Delete branch → Confirm branch deletion** to remove an eligible merged remote branch; the PR and merged code remain. Under **Overview → Conversation**, read general comments, submitted reviews, and code comments with file context. Write a general PR comment, check its Markdown preview, then choose **Post comment** to publish through your signed-in GitHub account. Drafts survive refreshes and switching review tabs. Text patches that GitHub cannot supply remain available through clearly labeled GitHub links.
- **Repository actions:** copy the clone URL, download a ZIP, open GitHub, and open its fork page. The desktop window can clone into a folder you choose. Star changes and forks are completed on GitHub.
- **Projects:** add a project, optionally attach a GitHub repository and a local folder, expand its conversations, and remove it from the sidebar. Removing a project keeps its conversations in Sessions and leaves your files alone.
- **Sessions:** create a conversation, select Claude, OpenAI / Codex, or Grok, see that provider’s icon, stop the practice reply, reopen conversations, and delete them from either sidebar location. Use **Undo** in the deletion notification to restore a conversation you just removed.
- **Running indicator:** a gray shimmer moves across a running conversation’s title. Reduced-motion preferences are respected.
- **IDE:** in the desktop window, choose a project folder and open it in an installed editor. On macOS, Cursor is tried before VS Code; otherwise the folder opens using the system default.

**Chat is clearly marked Practice mode.** It saves your message and shows a fixed example reply. It does not call any AI provider, spend model credits, or run your Python code. The Agents screen is a placeholder for the next design step.

## Run locally

For the ready-to-open app on this Mac, double-click **Pink Labs.app** inside `release/Pink Labs-darwin-arm64/`. You can also copy it into your Applications folder. This local build contains the interface and desktop host; your Python code and `.env` stay in the project folder. GitHub still uses the Git and GitHub CLI already installed on your Mac.

To rebuild that app after changing the interface, run `npm run package:desktop`. The package is a local development build, without distribution signing or notarization.

You need Node.js/npm, Git, and the [GitHub CLI](https://cli.github.com/). GitHub data uses the account already selected by `gh`; if needed, sign in with `gh auth login`.

From this folder:

```sh
npm install
npm run desktop
```

`npm run desktop` builds and launches Electron. After an existing build, `npm start` launches it again.

For interface development:

```sh
npm run dev
```

Open the local address printed by Vite. GitHub data works in this browser preview too. Native folder selection, cloning, and opening an editor require the Electron window. In the browser, the clone action copies the command instead.

Checks:

```sh
npm test
npm run build
```

## How the pieces fit

```text
You click a button
        ↓
React interface — src/
        ↓
Desktop: narrow Electron bridge — electron/
Browser preview: local API — server/vite-api.mjs
        ↓
GitHub service — server/github.mjs
        ↓
GitHub CLI → GitHub
```

The screen never receives your GitHub credentials. Repository reads and explicit PR creation, comments, merging, and branch cleanup use a small set of validated actions. The browser preview requires a same-origin JSON request for every write. Native operations use named IPC actions, with sender, folder, and argument checks.

`src/types.ts` describes the data exchanged by the interface and desktop bridge. `src/store.ts` manages projects and conversations. `src/App.tsx` contains the practice chat, navigation, and project flows. `src/GitHubView.tsx` renders repository information.

Projects and conversations are saved in this app’s local storage on this device. Browser previews and the desktop app have separate storage; nothing synchronizes between them yet. Folder permissions are stored separately by Electron. Clearing app/browser data can remove saved conversations.

## Data limits

- The service fetches the latest seven commits on the repository’s default branch for CI. The Overview table displays five commit rows; **History** opens the full commit history on GitHub. CI combines commit statuses and check runs; unavailable checks do not become a passing result.
- The open-PR count uses the successfully loaded list, with GitHub search as fallback for unavailable or capped lists. The PR workspace loads up to 100 recently updated PRs for each filter, including closed and merged history, with a notice when more exist.
- File diffs load up to 1,000 files and 2 MiB of patch text, with up to 256 KiB per patch. The viewer renders up to 1,200 rows per file and 2,000 characters per line. Missing or shortened content is identified, with a GitHub link for the full review. Binary files may have no text patch.
- The conversation loads up to 300 records each for general comments, submitted reviews, and code comments. It reports when history is shortened. Comment drafts stay in memory for this app session; they are not saved across restarts. Background refreshes retain the draft and currently displayed comments.
- New comments are general PR discussion comments. Creating inline review threads, submitting approvals/change requests, editing/deleting comments, and resolving threads are not included yet. Posting is never retried automatically; after an uncertain error, refresh the conversation and check whether your comment arrived before posting again.
- Branch cleanup is available only after merging, for the same repository, with the branch still at its reviewed commit. Default, destination, protected, changed, and branches used by another open PR are blocked. GitHub has no atomic expected-SHA option for deletion; the app rechecks immediately before sending the request. Local branches are not deleted.
- PR creation supports two published branches in the selected repository; cross-fork PRs and pushing local branches are not supported yet. The branch picker loads up to 1,000 branches and reports an error if that bound is exceeded. Creation uses the permissions of your current GitHub CLI account.
- The service loads five recent releases, up to 12 contributors, and the first 100 recently updated repositories for the picker. You can enter an `owner/repository` name directly to open another accessible repository.
- Star history uses GitHub’s weekly history endpoint to build daily buckets. It is not estimated when GitHub cannot supply it. “This month” and “last 30 days” are different time windows.
- Missing access, connectivity, or rate limits can make individual sections unavailable. Refresh retries the requests.
- A private repository can be read through `gh` only if its active account has access. Cloning also depends on your Git authentication setup.

## Connect your Python agent next

First, make the Python agent work from the terminal: accept a message, call a model, and return an answer. Then agree on the small message format between Python and this interface: the user’s message, selected provider, conversation identifier, and progress/reply/error events. Replace the practice reply with that connection. Keep API keys and tools on the backend side.

The first complete flow should be: **send one message → show running → receive one real answer → save the conversation**. Add tool activity, cancellation, and the Agents screen after that flow works.

Provider icons and interface icons are attributed in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
