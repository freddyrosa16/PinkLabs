const OWNER = /^[a-z\d][a-z\d-]{0,38}$/i;
const NAME = /^[a-z\d_.-]{1,100}$/i;
const TEMPLATE = /^[a-z\d][a-z\d.+_-]{0,99}$/i;
const LICENSE = /^[a-z\d][a-z\d.-]{0,99}$/;
const PAGE_SIZE = 100;
const MAX_PAGES = 3;
const UNCERTAIN =
  "GitHub did not confirm whether the repository was created. Check for the repository before trying again.";

const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status, creationSafe: true });
const rejected = (error) => ({
  status: "rejected",
  message: error?.creationSafe
    ? error.message
    : "Repository creation could not start. Refresh the options and try again.",
});
const validOwner = (value) => typeof value === "string" && OWNER.test(value);
const same = (left, right) => left.toLowerCase() === right.toLowerCase();
const keyFor = ({ owner, name }) => `${owner}/${name}`.toLowerCase();

function objectInput(value, keys) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw fail("Use the supported repository creation fields.");
}

function identityInput(input) {
  if (!validOwner(input.owner)) throw fail("Choose a valid GitHub owner.");
  if (
    typeof input.name !== "string" ||
    !NAME.test(input.name) ||
    [".", ".."].includes(input.name)
  )
    throw fail(
      "Use a repository name of 1–100 letters, numbers, dots, hyphens, or underscores.",
    );
  return { owner: input.owner, name: input.name };
}

function creationInput(input) {
  objectInput(input, [
    "owner",
    "name",
    "description",
    "visibility",
    "initializeReadme",
    "gitignoreTemplate",
    "licenseTemplate",
  ]);
  const identity = identityInput(input);
  if (
    typeof input.description !== "string" ||
    input.description.length > 350 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input.description)
  )
    throw fail("Use a description of at most 350 characters.");
  if (!["private", "public"].includes(input.visibility))
    throw fail("Choose private or public repository visibility.");
  if (typeof input.initializeReadme !== "boolean")
    throw fail("Choose whether to initialize a README.");
  for (const [field, pattern] of [
    ["gitignoreTemplate", TEMPLATE],
    ["licenseTemplate", LICENSE],
  ]) {
    if (
      typeof input[field] !== "string" ||
      (input[field] && !pattern.test(input[field]))
    )
      throw fail("Choose a supported repository template or leave it empty.");
  }
  return {
    ...identity,
    description: input.description,
    visibility: input.visibility,
    initializeReadme: input.initializeReadme,
    gitignoreTemplate: input.gitignoreTemplate,
    licenseTemplate: input.licenseTemplate,
  };
}

function safeError(error, action = "load repository creation options") {
  if (error?.status === 401)
    return fail(
      "GitHub authentication expired. Sign in again with gh auth login.",
      401,
    );
  if (error?.code === "ENOENT")
    return fail(
      "GitHub CLI is unavailable. Install gh and sign in with gh auth login.",
      503,
    );
  if ([403, 429].includes(error?.status))
    return fail(
      "GitHub access is restricted or its rate limit was reached. Check your account permissions and try again later.",
      error.status,
    );
  return fail(
    `Could not ${action}. Check your connection and gh auth status, then try again.`,
    502,
  );
}

function repositorySummary(raw, expected) {
  if (
    typeof raw?.full_name !== "string" ||
    !same(raw.full_name, `${expected.owner}/${expected.name}`) ||
    typeof raw.name !== "string" ||
    !same(raw.name, expected.name) ||
    !validOwner(raw.owner?.login) ||
    !same(raw.owner.login, expected.owner) ||
    typeof raw.private !== "boolean"
  )
    throw fail(
      "GitHub returned an unexpected repository identity. Check the repository on GitHub before continuing.",
      502,
    );
  return {
    fullName: raw.full_name,
    name: raw.name,
    description: typeof raw.description === "string" ? raw.description : "",
    private: raw.private,
  };
}

// Inject the same structured gh request used by the rest of the GitHub service.
// No creation request is retried, including after transport errors or malformed replies.
export function createRepositoryService({ request }) {
  const creating = new Map();
  const checking = new Map();
  const uncertain = new Map();
  const completed = new Map();

  async function account() {
    let user;
    try {
      user = await request("user");
    } catch (error) {
      throw safeError(error);
    }
    if (!validOwner(user?.login) || user.type !== "User")
      throw fail(
        "GitHub did not return a valid signed-in personal account. Check gh auth status.",
        502,
      );
    return user.login;
  }

  async function pages(endpoint, label) {
    const items = [];
    const warnings = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      let rows;
      try {
        rows = await request(
          `${endpoint}${endpoint.includes("?") ? "&" : "?"}per_page=${PAGE_SIZE}&page=${page}`,
        );
        if (!Array.isArray(rows) || rows.length > PAGE_SIZE)
          throw new Error("Unexpected list");
      } catch {
        warnings.push(
          `${label} could not be fully loaded. Only the available options are shown.`,
        );
        break;
      }
      items.push(...rows);
      if (rows.length < PAGE_SIZE) break;
      if (page === MAX_PAGES)
        warnings.push(
          `${label} are limited to the first ${MAX_PAGES * PAGE_SIZE} entries.`,
        );
    }
    return { items, warnings };
  }

  async function gitignores() {
    try {
      const rows = await request("gitignore/templates");
      if (!Array.isArray(rows)) throw new Error("Unexpected templates");
      const valid = rows
        .slice(0, 1000)
        .filter((row) => typeof row === "string" && TEMPLATE.test(row));
      return {
        items: [...new Set(valid)].sort(),
        warnings:
          valid.length === rows.length
            ? []
            : [
                "Some .gitignore templates are unavailable. Only supported options are shown.",
              ],
      };
    } catch {
      return {
        items: [],
        warnings: [
          ".gitignore templates could not be loaded. Choose none or refresh the options.",
        ],
      };
    }
  }

  async function licenses() {
    const result = await pages("licenses", "License templates");
    const valid = result.items.filter(
      (row) =>
        typeof row?.key === "string" &&
        LICENSE.test(row.key) &&
        typeof row.name === "string" &&
        row.name.length > 0 &&
        row.name.length <= 200,
    );
    if (valid.length !== result.items.length)
      result.warnings.push(
        "Some license templates are unavailable. Only supported options are shown.",
      );
    return {
      items: [
        ...new Map(valid.map(({ key, name }) => [key, { key, name }])).values(),
      ],
      warnings: result.warnings,
    };
  }

  async function getRepositoryCreationOptions() {
    const login = await account();
    const [memberships, ignores, licenseOptions] = await Promise.all([
      pages("user/memberships/orgs?state=active", "Organizations"),
      gitignores(),
      licenses(),
    ]);
    const owners = new Map([[login.toLowerCase(), { login, type: "user" }]]);
    for (const membership of memberships.items) {
      const org = membership?.organization?.login;
      if (
        membership?.state === "active" &&
        validOwner(org) &&
        validOwner(membership.user?.login) &&
        same(membership.user.login, login) &&
        !owners.has(org.toLowerCase())
      )
        owners.set(org.toLowerCase(), { login: org, type: "organization" });
    }
    return {
      account: login,
      owners: [...owners.values()],
      gitignoreTemplates: ignores.items,
      licenses: licenseOptions.items,
      warnings: [
        ...memberships.warnings,
        ...ignores.warnings,
        ...licenseOptions.warnings,
      ],
    };
  }

  async function verifyOwner(owner) {
    const login = await account();
    if (same(owner, login)) return { login, type: "user" };
    let membership;
    try {
      membership = await request(`user/memberships/orgs/${owner}`);
    } catch (error) {
      if (error?.status === 404)
        throw fail(
          "Choose your signed-in account or an organization where you have an active membership.",
          403,
        );
      throw safeError(error, "verify the repository owner");
    }
    if (
      membership?.state !== "active" ||
      !validOwner(membership.organization?.login) ||
      !same(membership.organization.login, owner) ||
      !validOwner(membership.user?.login) ||
      !same(membership.user.login, login)
    )
      throw fail(
        "Choose your signed-in account or an organization where you have an active membership.",
        403,
      );
    return { login, type: "organization" };
  }

  async function lookup(identity) {
    let raw;
    try {
      raw = await request(`repos/${identity.owner}/${identity.name}`);
    } catch (error) {
      if (error?.status === 404) return null;
      throw safeError(error, "check whether the repository exists");
    }
    return repositorySummary(raw, identity);
  }

  function createRepository(value) {
    let input;
    try {
      input = creationInput(value);
    } catch (error) {
      return Promise.resolve(rejected(error));
    }
    const key = keyFor(input);
    const fingerprint = JSON.stringify({
      ...input,
      owner: input.owner.toLowerCase(),
      name: input.name.toLowerCase(),
    });
    const pending = creating.get(key);
    if (pending)
      return pending.fingerprint === fingerprint
        ? pending.promise
        : Promise.resolve(
            rejected(
              fail(
                "Creation is already in progress for that repository. Wait for its result before changing the options.",
                409,
              ),
            ),
          );
    if (uncertain.has(key))
      return Promise.resolve({ status: "uncertain", message: UNCERTAIN });
    if (checking.has(key))
      return Promise.resolve(
        rejected(
          fail(
            "A repository check is in progress. Wait for its result before creating the repository.",
            409,
          ),
        ),
      );
    const promise = (async () => {
      const owner = await verifyOwner(input.owner);
      const record = {
        account: owner.login,
        fingerprint,
        visibility: input.visibility,
      };
      const [ignores, licenseOptions] = await Promise.all([
        input.gitignoreTemplate ? gitignores() : null,
        input.licenseTemplate ? licenses() : null,
      ]);
      if (
        input.gitignoreTemplate &&
        !ignores.items.includes(input.gitignoreTemplate)
      )
        throw fail(
          "The selected .gitignore template could not be verified. Refresh the options or choose none.",
        );
      if (
        input.licenseTemplate &&
        !licenseOptions.items.some(({ key }) => key === input.licenseTemplate)
      )
        throw fail(
          "The selected license could not be verified. Refresh the options or choose none.",
        );
      const existing = await lookup(input);
      if (existing) {
        const prior = completed.get(key);
        if (
          prior?.fingerprint === fingerprint &&
          same(prior.account, owner.login)
        ) {
          if (existing.private === (input.visibility === "private"))
            return { status: "created", repository: existing };
          uncertain.set(key, prior);
          return { status: "uncertain", message: UNCERTAIN };
        }
        throw fail(
          "A repository with that owner and name already exists. Open it or choose a different name.",
          409,
        );
      }
      // A long options fetch must not silently change the personal account targeted by user/repos.
      if (!same(await account(), owner.login))
        throw fail(
          "The signed-in GitHub account changed. Refresh the creation options before continuing.",
          409,
        );
      const body = {
        name: input.name,
        description: input.description,
        private: input.visibility === "private",
        auto_init: input.initializeReadme,
        ...(input.gitignoreTemplate
          ? { gitignore_template: input.gitignoreTemplate }
          : {}),
        ...(input.licenseTemplate
          ? { license_template: input.licenseTemplate }
          : {}),
      };
      let raw;
      try {
        raw = await request(
          owner.type === "user" ? "user/repos" : `orgs/${input.owner}/repos`,
          { method: "POST", body },
        );
      } catch (error) {
        if ([400, 404, 409, 422, 451].includes(error?.status))
          throw fail(
            "GitHub rejected repository creation. The name may already exist, an organization policy may restrict creation, or the selected options may be unavailable. Check the repository and options before trying again.",
            error.status,
          );
        if ([401, 403, 429].includes(error?.status) || error?.code === "ENOENT")
          throw safeError(error, "create the repository");
        uncertain.set(key, record);
        return { status: "uncertain", message: UNCERTAIN };
      }
      let repository;
      try {
        repository = repositorySummary(raw, input);
        if (repository.private !== (input.visibility === "private"))
          throw fail("GitHub returned unexpected repository visibility.", 502);
      } catch {
        uncertain.set(key, record);
        return { status: "uncertain", message: UNCERTAIN };
      }
      completed.set(key, record);
      return { status: "created", repository };
    })()
      .catch((error) => rejected(error))
      .finally(() => creating.delete(key));
    creating.set(key, { fingerprint, promise });
    return promise;
  }

  function checkCreatedRepository(value) {
    let input;
    try {
      objectInput(value, ["owner", "name"]);
      input = identityInput(value);
    } catch (error) {
      return Promise.reject(error);
    }
    const key = keyFor(input);
    if (checking.has(key)) return checking.get(key);
    // A check cannot clear an uncertain write while that write is still running.
    const pending = creating.get(key);
    const promise = (async () => {
      if (pending) await pending.promise.catch(() => {});
      const owner = await verifyOwner(input.owner);
      const previous = uncertain.get(key) ?? completed.get(key);
      if (previous && !same(previous.account, owner.login))
        throw fail(
          "Sign in to the account used for creation before checking its outcome.",
          409,
        );
      const repository = await lookup(input);
      if (
        repository &&
        previous &&
        repository.private !== (previous.visibility === "private")
      ) {
        uncertain.set(key, previous);
        throw fail(
          `The repository is ${repository.private ? "private" : "public"}, but you requested ${previous.visibility}. Review its visibility on GitHub before continuing. Pink Labs has not changed its visibility.`,
          409,
        );
      }
      if (repository && previous) completed.set(key, previous);
      if (!repository) completed.delete(key);
      uncertain.delete(key);
      return repository;
    })().finally(() => checking.delete(key));
    checking.set(key, promise);
    return promise;
  }

  return {
    getRepositoryCreationOptions,
    createRepository,
    checkCreatedRepository,
  };
}
