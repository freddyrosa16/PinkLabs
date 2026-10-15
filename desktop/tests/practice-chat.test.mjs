import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import * as store from "../src/store.ts";

const compiled = ts.transpileModule(
  await readFile(
    new URL("../src/practice-chat-state.ts", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const exports = {};
vm.runInNewContext(compiled, {
  exports,
  Error,
  require(name) {
    assert.equal(name, "./store");
    return store;
  },
});
const { createPracticeChat, PRACTICE_REPLY, PRACTICE_REPLY_DELAY } = exports;
const session = (id, overrides = {}) => ({
  id,
  title: `Conversation ${id}`,
  provider: "claude",
  projectId: null,
  messages: [],
  updated: 100,
  ...overrides,
});

function harness(sessions = []) {
  let workspace = { ...store.newWorkspace(), sessions };
  let sequence = 0;
  let timerSequence = 0;
  let time = 1000;
  const timers = new Map();
  const notifications = [];
  const chat = createPracticeChat({
    getWorkspace: () => workspace,
    setWorkspace: (update) => {
      const first = update(workspace);
      const replay = update(workspace);
      assert.deepEqual(
        first,
        replay,
        "React replay must not generate different IDs or side effects",
      );
      workspace = first;
    },
    notify: (message) => notifications.push(message),
    createId: () => `generated-${++sequence}`,
    now: () => time,
    schedule: (callback, delay) => {
      const id = ++timerSequence;
      timers.set(id, { callback, delay });
      return id;
    },
    cancel: (id) => timers.delete(id),
  });
  return {
    chat,
    timers,
    notifications,
    get workspace() {
      return workspace;
    },
    replaceWorkspace(next) {
      workspace = next;
      chat.reconcileWorkspace();
    },
    complete() {
      const [id, timer] = timers.entries().next().value;
      timers.delete(id);
      time += timer.delay;
      timer.callback();
    },
  };
}

test("a first send saves the selected context and exactly one delayed practice reply", () => {
  const h = harness();
  h.chat.setProvider("grok");
  h.chat.setProjectId("pink-labs");
  h.chat.setDraft("  Help me learn Python.  ");
  h.chat.submit();
  const created = h.workspace.sessions[0];
  assert.equal(created.provider, "grok");
  assert.equal(created.projectId, "pink-labs");
  assert.equal(created.title, "Help me learn Python.");
  assert.equal(created.messages[0].text, "Help me learn Python.");
  assert.equal(created.messages.length, 1);
  assert.equal(h.chat.getSnapshot().activeSession, created.id);
  assert.equal(h.chat.getSnapshot().running, created.id);
  assert.equal(h.chat.getSnapshot().draft, "");
  assert.equal(h.timers.size, 1);
  assert.equal([...h.timers.values()][0].delay, 4200);
  assert.equal(PRACTICE_REPLY_DELAY, 4200);
  h.chat.setDraft("My next unsent message");
  h.chat.submit();
  assert.equal(
    h.timers.size,
    1,
    "duplicate submission must not create another timer",
  );
  h.complete();
  assert.equal(h.workspace.sessions[0].messages.length, 2);
  assert.equal(h.workspace.sessions[0].messages[1].text, PRACTICE_REPLY);
  assert.equal(h.chat.getSnapshot().running, null);
  assert.equal(h.chat.getSnapshot().draft, "My next unsent message");
});

test("switching conversations and reopening the same row preserves each unsent draft", () => {
  const a = session("a");
  const b = session("b", { provider: "openai" });
  const h = harness([a, b]);
  h.chat.setProvider("grok");
  h.chat.setProjectId("pink-labs");
  h.chat.setDraft("New conversation draft");
  h.chat.openSession(a);
  h.chat.setDraft("A's draft");
  h.chat.openSession(a);
  assert.equal(h.chat.getSnapshot().draft, "A's draft");
  h.chat.openSession(b);
  h.chat.setDraft("B's draft");
  h.chat.openSession(a);
  assert.equal(h.chat.getSnapshot().draft, "A's draft");
  h.chat.newChat();
  assert.equal(h.chat.getSnapshot().draft, "New conversation draft");
  assert.equal(h.chat.getSnapshot().provider, "grok");
  assert.equal(h.chat.getSnapshot().projectId, "pink-labs");
  h.chat.openSession(b);
  assert.equal(h.chat.getSnapshot().draft, "B's draft");
  assert.equal(h.workspace.sessions.length, 2);
});

test("a pending reply stays with its original session across navigation", () => {
  const a = session("a");
  const b = session("b");
  const h = harness([a, b]);
  h.chat.openSession(a);
  h.chat.setDraft("Message for A");
  h.chat.submit();
  h.chat.openSession(b);
  h.chat.setDraft("Unsent message for B");
  h.chat.stop();
  assert.equal(h.timers.size, 1, "B's stop action cannot cancel A's reply");
  h.chat.submit();
  assert.match(h.notifications.at(-1), /another conversation/);
  assert.equal(h.chat.getSnapshot().draft, "Unsent message for B");
  h.complete();
  assert.equal(h.workspace.sessions[0].messages.length, 2);
  assert.equal(h.workspace.sessions[1].messages.length, 0);
  assert.equal(h.chat.getSnapshot().activeSession, "b");
  assert.equal(h.chat.getSnapshot().draft, "Unsent message for B");
});

test("stop and cleanup invalidate callbacks even if an old timer fires late", () => {
  const h = harness();
  h.chat.setDraft("First message");
  h.chat.submit();
  const oldCallback = [...h.timers.values()][0].callback;
  h.chat.stop();
  assert.equal(h.timers.size, 0);
  assert.equal(h.chat.getSnapshot().running, null);
  h.chat.setDraft("Second message");
  h.chat.submit();
  oldCallback();
  assert.equal(h.workspace.sessions[0].messages.length, 2);
  assert.equal(h.timers.size, 1);
  const unmountedCallback = [...h.timers.values()][0].callback;
  h.chat.cancelPending();
  unmountedCallback();
  assert.equal(h.workspace.sessions[0].messages.length, 2);
  assert.equal(h.timers.size, 0);
});

test("deletion cancels a background reply and cannot resurrect its conversation", () => {
  const a = session("a");
  const b = session("b");
  const h = harness([a, b]);
  h.chat.openSession(a);
  h.chat.setDraft("Delete this test conversation while pending");
  h.chat.submit();
  const oldCallback = [...h.timers.values()][0].callback;
  h.chat.openSession(b);
  h.chat.setDraft("B's draft remains");
  h.chat.sessionDeleted("a");
  h.replaceWorkspace({
    ...h.workspace,
    sessions: h.workspace.sessions.filter((item) => item.id !== "a"),
  });
  oldCallback();
  assert.equal(h.timers.size, 0);
  assert.equal(h.workspace.sessions.length, 1);
  assert.equal(h.chat.getSnapshot().activeSession, "b");
  assert.equal(h.chat.getSnapshot().draft, "B's draft remains");
});

test("oversized drafts and full conversations reject sends without changing the draft", () => {
  const h = harness();
  const oversized = "x".repeat(store.WORKSPACE_LIMITS.messageCharacters + 1);
  h.chat.setDraft(oversized);
  h.chat.submit();
  assert.equal(h.workspace.sessions.length, 0);
  assert.equal(h.chat.getSnapshot().draft, oversized);
  assert.match(h.notifications.at(-1), /draft has not been changed/);
  assert.equal(h.timers.size, 0);

  const full = session("full", {
    messages: Array.from({ length: 999 }, (_, index) => ({
      id: `m-${index}`,
      role: "user",
      text: "hi",
    })),
  });
  const limited = harness([full]);
  limited.chat.openSession(full);
  limited.chat.setDraft("Reserve space for a user message and reply");
  limited.chat.submit();
  assert.equal(limited.workspace.sessions[0].messages.length, 999);
  assert.equal(
    limited.chat.getSnapshot().draft,
    "Reserve space for a user message and reply",
  );
  assert.equal(limited.timers.size, 0);
});

test("project removal and session disappearance clear stale selection without losing other drafts", () => {
  const a = session("a", { projectId: "pink-labs" });
  const h = harness([a]);
  h.chat.setDraft("Unsent new chat");
  h.chat.openSession(a);
  h.replaceWorkspace({
    ...h.workspace,
    projects: [],
    sessions: [{ ...a, projectId: null }],
  });
  assert.equal(h.chat.getSnapshot().projectId, "");
  h.replaceWorkspace({ ...h.workspace, sessions: [] });
  assert.equal(h.chat.getSnapshot().activeSession, null);
  assert.equal(h.chat.getSnapshot().draft, "Unsent new chat");
  h.chat.openSession(a);
  assert.equal(h.chat.getSnapshot().activeSession, null);
  assert.match(h.notifications.at(-1), /no longer available/);
});
