import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const compiled = ts.transpileModule(
  await readFile(
    new URL("../src/RepositoryCreator.tsx", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
    reportDiagnostics: true,
  },
);
assert.deepEqual(
  compiled.diagnostics?.filter(
    (item) => item.category === ts.DiagnosticCategory.Error,
  ),
  [],
);

const options = {
  account: "owner",
  owners: [
    { login: "owner", type: "user" },
    { login: "team", type: "organization" },
  ],
  gitignoreTemplates: ["Python", "Node"],
  licenses: [{ key: "mit", name: "MIT License" }],
  warnings: [],
};
const repository = {
  fullName: "Owner/new-repo",
  name: "new-repo",
  description: "A learning project",
  private: true,
};
const unknown = {
  status: "uncertain",
  message: "Check whether GitHub received the request.",
};
const event = () => ({ preventDefault() {} });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const text = (node) => {
  if (node === null || node === undefined || typeof node === "boolean")
    return "";
  if (Array.isArray(node)) return node.map(text).join("");
  if (typeof node !== "object") return String(node);
  return text(node.props?.children);
};
const normalizedText = (node) => text(node).replace(/\s+/g, " ").trim();
function entries(node, disabled = false) {
  if (Array.isArray(node))
    return node.flatMap((child) => entries(child, disabled));
  if (!node || typeof node !== "object") return [];
  const blocked = disabled || Boolean(node.props?.disabled);
  return [
    { node, disabled: blocked },
    ...entries(node.props?.children, blocked),
  ];
}

// Exercise the actual component's handlers and effects without a DOM dependency.
// Hook state survives prop changes; effects clean up and rerun when dependencies
// change. Native validation, focus, and layout remain browser-test responsibilities.
function harness(overrides = {}) {
  const slots = [];
  let cursor = 0;
  let dirty = true;
  let tree;
  let queuedEffects = [];
  let active = true;
  const writes = [];
  const checks = [];
  const opened = [];
  const notices = [];
  let optionReads = 0;
  const api = {
    repositoryCreationOptions: async () => {
      optionReads++;
      return overrides.options
        ? overrides.options(optionReads)
        : structuredClone(options);
    },
    createRepository: async (input) => {
      writes.push(structuredClone(input));
      assert.ok(
        overrides.create,
        "The test must explicitly handle every write",
      );
      return overrides.create(input);
    },
    checkCreatedRepository: async (input) => {
      checks.push(structuredClone(input));
      assert.ok(
        overrides.check,
        "The test must explicitly handle every recovery check",
      );
      return overrides.check(input);
    },
  };
  const react = {
    useState(initial) {
      const at = cursor++;
      if (!(at in slots))
        slots[at] = typeof initial === "function" ? initial() : initial;
      return [
        slots[at],
        (next) => {
          const value = typeof next === "function" ? next(slots[at]) : next;
          if (!Object.is(value, slots[at])) {
            slots[at] = value;
            dirty = true;
          }
        },
      ];
    },
    useRef(initial) {
      const at = cursor++;
      if (!(at in slots)) slots[at] = { current: initial };
      return slots[at];
    },
    useEffect(effect, deps) {
      const at = cursor++;
      const previous = slots[at];
      if (
        !previous ||
        deps.some((value, index) => !Object.is(value, previous.deps[index]))
      ) {
        const next = { deps, cleanup: null };
        slots[at] = next;
        queuedEffects.push(() => {
          previous?.cleanup?.();
          next.cleanup = effect();
        });
      }
    },
  };
  const jsx = (type, props) => ({ type, props });
  const exports = {};
  vm.runInNewContext(compiled.outputText, {
    exports,
    require(name) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime")
        return { jsx, jsxs: jsx, Fragment: "fragment" };
      if (name === "./api") return { api };
      if (name === "@primer/octicons-react")
        return new Proxy({}, { get: () => () => null });
      if (name.endsWith(".css")) return {};
      assert.fail(`Unexpected component import: ${name}`);
    },
  });
  function render() {
    let passes = 0;
    while (dirty) {
      assert.ok(++passes < 20, "Component did not settle after effects");
      dirty = false;
      cursor = 0;
      tree = exports.RepositoryCreator({
        active,
        close() {
          active = false;
          dirty = true;
        },
        openRepository(fullName) {
          opened.push(fullName);
        },
        notify(message) {
          notices.push(message);
        },
      });
      const effects = queuedEffects;
      queuedEffects = [];
      effects.forEach((effect) => effect());
    }
    return tree;
  }
  function findButton(label) {
    return entries(render()).find(
      ({ node }) =>
        node.type === "button" &&
        (node.props["aria-label"] || normalizedText(node)) === label,
    );
  }
  function field(label) {
    const rows = entries(render());
    const directlyNamed = rows.find(
      ({ node }) =>
        ["input", "select"].includes(node.type) &&
        node.props["aria-label"] === label,
    );
    if (directlyNamed) return directlyNamed;
    const wrapper = rows.find(
      ({ node }) =>
        node.type === "label" && normalizedText(node).startsWith(label),
    );
    assert.ok(wrapper, `Missing field label: ${label}`);
    const input = entries(wrapper.node, wrapper.disabled).find(({ node }) =>
      ["input", "select"].includes(node.type),
    );
    assert.ok(input, `Missing labeled control: ${label}`);
    return input;
  }
  const h = {
    writes,
    checks,
    opened,
    notices,
    render,
    field,
    findButton,
    get optionReads() {
      return optionReads;
    },
    async settle() {
      await new Promise((resolve) => setImmediate(resolve));
      render();
    },
    setActive(value) {
      active = value;
      dirty = true;
      render();
    },
    form() {
      return entries(render()).find(({ node }) => node.type === "form").node;
    },
    change(label, value) {
      const control = field(label);
      assert.equal(control.disabled, false, `${label} must be editable`);
      control.node.props.onChange({ target: { value, checked: value } });
      render();
    },
    click(label) {
      const button = findButton(label);
      assert.ok(button, `Missing button: ${label}`);
      assert.equal(button.disabled, false, `${label} must be enabled`);
      const result = button.node.props.onClick();
      render();
      return result;
    },
    async submit() {
      await h.form().props.onSubmit(event());
      await h.settle();
    },
  };
  render();
  return h;
}

test("known rejection keeps the draft editable and permits a corrected submission", async () => {
  let attempt = 0;
  const h = harness({
    create: async () =>
      ++attempt === 1
        ? { status: "rejected", message: "Choose a different repository name." }
        : { status: "created", repository },
  });
  await h.settle();
  h.change("Repository name", "taken-name");
  h.change("Description", "A learning project");
  h.change("Gitignore template", "Python");
  h.change("License template", "mit");
  await h.submit();
  assert.equal(h.field("Repository name").disabled, false);
  assert.equal(h.field("Repository name").node.props.value, "taken-name");
  assert.equal(h.field("Description").node.props.value, "A learning project");
  assert.equal(h.field("Gitignore template").node.props.value, "Python");
  assert.equal(h.field("License template").node.props.value, "mit");
  assert.equal(h.findButton("Check on GitHub"), undefined);
  assert.equal(h.findButton("Refresh options").disabled, false);
  assert.match(
    normalizedText(h.render()),
    /Choose a different repository name/,
  );
  h.change("Repository name", "new-repo");
  await h.submit();
  assert.equal(h.writes.length, 2);
  assert.equal(h.writes[1].name, "new-repo");
  assert.equal(h.writes[1].gitignoreTemplate, "Python");
  assert.deepEqual(h.opened, ["Owner/new-repo"]);
  assert.equal(h.checks.length, 0);
});

for (const mode of ["uncertain result", "lost transport response"]) {
  test(`${mode} blocks another write until a recovery check confirms absence`, async () => {
    let checkCount = 0;
    const h = harness({
      create: async () => {
        if (mode === "lost transport response")
          throw new Error("Connection closed before the result arrived.");
        return unknown;
      },
      check: async () => {
        if (++checkCount === 1) throw new Error("Could not check GitHub yet.");
        return null;
      },
    });
    await h.settle();
    h.change("Repository name", "new-repo");
    h.change("Description", "Keep this draft");
    await h.submit();
    assert.equal(h.field("Repository name").disabled, true);
    assert.equal(h.findButton("Create repository").disabled, true);
    assert.equal(h.findButton("Refresh options").disabled, true);
    await h.submit();
    assert.equal(
      h.writes.length,
      1,
      "Unknown writes must not be automatically or manually repeated",
    );
    h.click("Check on GitHub");
    await h.settle();
    assert.equal(
      h.field("Repository name").disabled,
      true,
      "An unsuccessful check cannot authorize retry",
    );
    assert.equal(h.field("Description").node.props.value, "Keep this draft");
    assert.match(normalizedText(h.render()), /Could not check GitHub yet/);
    h.click("Check on GitHub");
    await h.settle();
    assert.equal(h.field("Repository name").disabled, false);
    assert.equal(h.field("Repository name").node.props.value, "new-repo");
    assert.equal(h.findButton("Create repository").disabled, false);
    assert.deepEqual(h.checks, [
      { owner: "owner", name: "new-repo" },
      { owner: "owner", name: "new-repo" },
    ]);
    await h.submit();
    assert.equal(h.writes.length, 2);
    assert.deepEqual(h.writes[1], h.writes[0]);
  });
}

test("finding an uncertain repository opens the recovered result without another create", async () => {
  const h = harness({
    create: async () => unknown,
    check: async () => repository,
  });
  await h.settle();
  h.change("Repository name", "new-repo");
  await h.submit();
  h.click("Check on GitHub");
  await h.settle();
  assert.deepEqual(h.opened, ["Owner/new-repo"]);
  assert.match(h.notices[0], /^Found Owner\/new-repo/);
  await h.submit();
  assert.equal(h.writes.length, 1);
  assert.ok(h.findButton("Open repository"));
});

test("recovery preserves the draft and blocks mismatched visibility even after service state is lost", async () => {
  let reads = 0;
  const h = harness({
    create: async () => {
      throw new Error("Connection interrupted");
    },
    check: async () => ({ ...repository, private: ++reads > 1 }),
  });
  await h.settle();
  h.change("Repository name", "new-repo");
  await h.submit();
  h.click("Check on GitHub");
  await h.settle();
  assert.deepEqual(h.opened, []);
  assert.equal(h.findButton("Create repository").disabled, true);
  assert.match(normalizedText(h.render()), /public instead of private/);
  await h.submit();
  assert.equal(h.writes.length, 1);
  h.click("Check on GitHub");
  await h.settle();
  assert.deepEqual(h.opened, ["Owner/new-repo"]);
  assert.equal(h.writes.length, 1);
});

test("same-turn double submission and navigation cannot duplicate a pending write or steal the active view", async () => {
  const pending = deferred();
  const h = harness({ create: () => pending.promise });
  await h.settle();
  h.change("Repository name", "new-repo");
  h.change("Description", "A learning project");
  h.change("Public", "public");
  h.change("Add a README", false);
  h.change("Gitignore template", "Python");
  h.setActive(false);
  h.setActive(true);
  assert.equal(h.field("Repository name").node.props.value, "new-repo");
  assert.equal(h.field("Gitignore template").node.props.value, "Python");
  const submit = h.form().props.onSubmit;
  const first = submit(event());
  const second = submit(event());
  assert.equal(
    h.writes.length,
    1,
    "The guard must work before React renders disabled controls",
  );
  assert.equal(h.field("Repository name").disabled, true);
  assert.equal(h.findButton("Refresh options").disabled, true);
  h.setActive(false);
  assert.equal(h.render().props.hidden, true);
  pending.resolve({ status: "created", repository });
  await Promise.all([first, second]);
  await h.settle();
  assert.deepEqual(
    h.opened,
    [],
    "Background completion must not navigate away from another view",
  );
  assert.equal(h.notices.length, 1);
  h.setActive(true);
  assert.match(normalizedText(h.render()), /Owner\/new-repo/);
  assert.equal(
    h.optionReads,
    1,
    "Navigation must preserve the mounted creation state",
  );
  await h.submit();
  assert.equal(h.writes.length, 1);
  h.click("Open repository");
  assert.deepEqual(h.opened, ["Owner/new-repo"]);
  h.click("Create another");
  assert.equal(h.field("Repository name").node.props.value, "");
  assert.equal(h.field("Description").node.props.value, "");
  assert.equal(h.field("Private").node.props.checked, true);
  assert.equal(h.field("Add a README").node.props.checked, true);
  assert.equal(h.field("Gitignore template").node.props.value, "");
  assert.equal(h.writes.length, 1);
});

test("refreshing partial options preserves the draft and replaces unavailable owner and templates", async () => {
  const h = harness({
    options: async (read) =>
      read === 1
        ? {
            ...structuredClone(options),
            warnings: ["Some options could not be loaded."],
          }
        : {
            account: "new-account",
            owners: [{ login: "new-account", type: "user" }],
            gitignoreTemplates: ["Node"],
            licenses: [],
            warnings: [],
          },
  });
  await h.settle();
  h.change("Repository owner", "team");
  h.change("Repository name", "keep-this-name");
  h.change("Description", "Keep this description");
  h.change("Public", "public");
  h.change("Add a README", false);
  h.change("Gitignore template", "Python");
  h.change("License template", "mit");
  h.click("Refresh options");
  await h.settle();
  assert.equal(h.optionReads, 2);
  assert.equal(h.field("Repository owner").node.props.value, "new-account");
  assert.equal(h.field("Gitignore template").node.props.value, "");
  assert.equal(h.field("License template").node.props.value, "");
  assert.equal(h.field("Repository name").node.props.value, "keep-this-name");
  assert.equal(
    h.field("Description").node.props.value,
    "Keep this description",
  );
  assert.equal(h.field("Public").node.props.checked, true);
  assert.equal(h.field("Add a README").node.props.checked, false);
  assert.doesNotMatch(
    normalizedText(h.render()),
    /Some options could not be loaded/,
  );
  assert.equal(h.writes.length, 0);
});
