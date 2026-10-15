import test from "node:test";
import assert from "node:assert/strict";
import { createRepositorySync } from "../src/repository-sync.ts";
import { api } from "../src/api.ts";

const flush = () => new Promise((resolve) => setImmediate(resolve));
const repository = (name = "owner/repo", overrides = {}) => ({
  fullName: name,
  openPrCount: 1,
  warnings: [],
  refreshIncomplete: false,
  ...overrides,
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function controlledClock() {
  let time = 0;
  let sequence = 0;
  const jobs = new Map();
  return {
    now: () => time,
    setTimer(callback, delay) {
      const id = ++sequence;
      jobs.set(id, { at: time + delay, callback });
      return id;
    },
    clearTimer(id) {
      jobs.delete(id);
    },
    get pendingTimers() {
      return jobs.size;
    },
    async advance(milliseconds) {
      const target = time + milliseconds;
      while (true) {
        const next = [...jobs.entries()]
          .filter(([, job]) => job.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [id, job] = next;
        time = job.at;
        jobs.delete(id);
        job.callback();
        await flush();
      }
      time = target;
      await flush();
    },
  };
}

function harness(options = {}) {
  const clock = options.clock || controlledClock();
  const requests = [];
  const states = [];
  const sync = createRepositorySync({
    active: options.active ?? true,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    load: () => {
      const request = deferred();
      requests.push(request);
      return request.promise;
    },
    onChange: (state) => states.push(state),
  });
  return { clock, requests, states, sync, latest: () => states.at(-1) };
}

test("initial load and overlapping refresh triggers share one in-flight request", async (t) => {
  const h = harness();
  t.after(() => h.sync.dispose());
  assert.deepEqual(h.latest(), { repo: null, loading: true, error: null });
  const first = h.sync.refresh();
  assert.strictEqual(h.sync.refresh(false), first);
  assert.strictEqual(h.sync.refresh(), first);
  await flush();
  assert.equal(h.requests.length, 1);
  const data = repository();
  h.requests[0].resolve(data);
  await first;
  assert.deepEqual(h.latest(), { repo: data, loading: false, error: null });
  assert.equal(h.clock.pendingTimers, 1);
});

test("active polling waits 30 seconds after completion and never overlaps a slow request", async (t) => {
  const h = harness();
  t.after(() => h.sync.dispose());
  await flush();
  await h.clock.advance(8_000);
  h.requests[0].resolve(repository());
  await flush();
  await h.clock.advance(29_999);
  assert.equal(h.requests.length, 1);
  await h.clock.advance(1);
  assert.equal(h.requests.length, 2);
  await h.clock.advance(90_000);
  assert.equal(
    h.requests.length,
    2,
    "a slow response must not produce overlapping polls",
  );
  h.requests[1].resolve(repository("owner/repo", { openPrCount: 2 }));
  await flush();
  await h.clock.advance(29_999);
  assert.equal(h.requests.length, 2);
  await h.clock.advance(1);
  assert.equal(h.requests.length, 3);
});

test("hiding the app stops polls and returning refetches without waiting for the old interval", async (t) => {
  const h = harness();
  t.after(() => h.sync.dispose());
  await flush();
  h.requests[0].resolve(repository());
  await flush();
  h.sync.setActive(false);
  assert.equal(h.clock.pendingTimers, 0);
  await h.clock.advance(120_000);
  await h.sync.refresh(false);
  assert.equal(h.requests.length, 1);
  h.sync.setActive(true);
  await flush();
  assert.equal(
    h.requests.length,
    2,
    "returning to the app should immediately fetch newer GitHub data",
  );
  h.sync.setActive(true);
  const repeated = h.sync.refresh(false);
  assert.equal(h.requests.length, 2);
  h.requests[1].resolve(repository());
  await repeated;
});

test("quick focus changes honor a five-second gap and hiding cancels the deferred refresh", async (t) => {
  const h = harness();
  t.after(() => h.sync.dispose());
  await flush();
  h.requests[0].resolve(repository());
  await flush();
  h.sync.setActive(false);
  await h.clock.advance(1_000);
  h.sync.setActive(true);
  await flush();
  assert.equal(h.requests.length, 1);
  await h.clock.advance(3_999);
  assert.equal(h.requests.length, 1);
  h.sync.setActive(false);
  await h.clock.advance(1);
  assert.equal(
    h.requests.length,
    1,
    "the hidden window must not run its deferred focus refresh",
  );
  h.sync.setActive(true);
  await flush();
  assert.equal(h.requests.length, 2);
});

test("background refresh keeps existing data through loading and failure; manual retry can recover immediately", async (t) => {
  const h = harness();
  t.after(() => h.sync.dispose());
  await flush();
  const original = repository();
  h.requests[0].resolve(original);
  await flush();
  await h.clock.advance(30_000);
  assert.strictEqual(h.latest().repo, original);
  assert.equal(h.latest().loading, true);
  h.requests[1].reject(new Error("GitHub temporarily unavailable"));
  await flush();
  assert.deepEqual(h.latest(), {
    repo: original,
    loading: false,
    error: "GitHub temporarily unavailable",
  });
  const manual = h.sync.refresh();
  await flush();
  assert.equal(
    h.requests.length,
    3,
    "manual refresh should bypass the automatic failure backoff",
  );
  assert.strictEqual(h.latest().repo, original);
  const replacement = repository("owner/repo", { openPrCount: 2 });
  h.requests[2].resolve(replacement);
  await manual;
  assert.deepEqual(h.latest(), {
    repo: replacement,
    loading: false,
    error: null,
  });
});

test("manual refresh bypasses the minimum gap and inactive state, while automatic refresh does not", async (t) => {
  const h = harness({ active: false });
  t.after(() => h.sync.dispose());
  await flush();
  assert.equal(
    h.requests.length,
    1,
    "the selected repository loads once even before activity begins",
  );
  h.requests[0].resolve(repository());
  await flush();
  assert.equal(h.clock.pendingTimers, 0);
  await h.sync.refresh(false);
  assert.equal(h.requests.length, 1);
  const manual = h.sync.refresh();
  await flush();
  assert.equal(h.requests.length, 2);
  h.requests[1].resolve(repository());
  await manual;
  assert.equal(h.clock.pendingTimers, 0);
});

test("disposing an old repository lifecycle ignores its late result and removes future work", async (t) => {
  const clock = controlledClock();
  const old = harness({ clock });
  await flush();
  old.sync.dispose();
  const oldStateCount = old.states.length;
  const current = harness({ clock });
  t.after(() => current.sync.dispose());
  await flush();
  const currentData = repository("owner/new-repository");
  current.requests[0].resolve(currentData);
  old.requests[0].resolve(repository("owner/old-repository"));
  await flush();
  assert.equal(old.states.length, oldStateCount);
  assert.strictEqual(current.latest().repo, currentData);
  await old.sync.refresh();
  old.sync.setActive(false);
  old.sync.setActive(true);
  await flush();
  assert.equal(old.requests.length, 1);
  current.sync.dispose();
  assert.equal(clock.pendingTimers, 0);
  await clock.advance(600_000);
  assert.equal(current.requests.length, 1);
});

test("request failures back off from 60 seconds to five minutes, then reset after recovery", async (t) => {
  const h = harness();
  t.after(() => h.sync.dispose());
  await flush();
  for (const delay of [60_000, 120_000, 240_000, 300_000, 300_000]) {
    const count = h.requests.length;
    h.requests.at(-1).reject(new Error("GitHub rate limit reached"));
    await flush();
    h.sync.setActive(false);
    h.sync.setActive(true);
    await h.sync.refresh(false);
    await h.clock.advance(delay - 1);
    assert.equal(
      h.requests.length,
      count,
      "focus must not bypass the retry window",
    );
    await h.clock.advance(1);
    assert.equal(h.requests.length, count + 1);
  }
  h.requests.at(-1).resolve(repository());
  await flush();
  const recoveredCount = h.requests.length;
  await h.clock.advance(29_999);
  assert.equal(h.requests.length, recoveredCount);
  await h.clock.advance(1);
  assert.equal(
    h.requests.length,
    recoveredCount + 1,
    "successful recovery restores the normal poll interval",
  );
});

test("partial endpoint warnings keep usable data visible but trigger slower retries", async (t) => {
  const h = harness();
  t.after(() => h.sync.dispose());
  await flush();
  const partial = repository("owner/repo", {
    refreshIncomplete: true,
    warnings: ["Languages could not be loaded from GitHub."],
  });
  h.requests[0].resolve(partial);
  await flush();
  assert.deepEqual(h.latest(), { repo: partial, loading: false, error: null });
  await h.clock.advance(59_999);
  assert.equal(h.requests.length, 1);
  await h.clock.advance(1);
  assert.equal(h.requests.length, 2);
  h.requests[1].resolve(partial);
  await flush();
  await h.clock.advance(119_999);
  assert.equal(h.requests.length, 2);
  await h.clock.advance(1);
  assert.equal(h.requests.length, 3);
  h.requests[2].resolve(repository());
  await flush();
  await h.clock.advance(30_000);
  assert.equal(h.requests.length, 4);
});

test("informational notices do not slow updates for otherwise complete repositories", async (t) => {
  const h = harness();
  t.after(() => h.sync.dispose());
  await flush();
  h.requests[0].resolve(
    repository("owner/repo", {
      warnings: ["Showing the 100 most recently updated open pull requests."],
      refreshIncomplete: false,
    }),
  );
  await flush();
  await h.clock.advance(29_999);
  assert.equal(h.requests.length, 1);
  await h.clock.advance(1);
  assert.equal(h.requests.length, 2);
});

test("API deduplicates in-flight requests by repository and permits fresh requests after success or failure", async (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const requests = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      pink: {
        repository(name) {
          const request = deferred();
          requests.push({ name, ...request });
          return request.promise;
        },
      },
    },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else delete globalThis.window;
  });
  const first = api.repository("tests/one");
  assert.strictEqual(api.repository("tests/one"), first);
  const other = api.repository("tests/two");
  assert.notStrictEqual(first, other);
  assert.deepEqual(
    requests.map((request) => request.name),
    ["tests/one", "tests/two"],
  );
  requests[0].resolve(repository("tests/one"));
  requests[1].resolve(repository("tests/two"));
  await Promise.all([first, other]);
  const next = api.repository("tests/one");
  assert.notStrictEqual(first, next);
  const failure = assert.rejects(next, /unavailable/);
  requests[2].reject(new Error("unavailable"));
  await failure;
  const retry = api.repository("tests/one");
  assert.equal(requests.length, 4);
  requests[3].resolve(repository("tests/one"));
  await retry;
});
