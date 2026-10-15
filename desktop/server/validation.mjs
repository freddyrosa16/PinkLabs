import path from "node:path";

export function desktopPath(value, platform = process.platform) {
  if (platform !== "darwin") return value;
  const entries = (value || "/usr/bin:/bin:/usr/sbin:/sbin")
    .split(":")
    .filter(Boolean);
  const missing = ["/opt/homebrew/bin", "/usr/local/bin"].filter(
    (entry) => !entries.includes(entry),
  );
  return [...missing, ...entries].join(":");
}

export function validateClipboardText(value) {
  if (typeof value !== "string" || value.length > 10_000) {
    throw new Error("Clipboard text must contain at most 10,000 characters.");
  }
  return value;
}

export function validateRepositoryName(value) {
  if (
    typeof value !== "string" ||
    value.length > 150 ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/.test(value)
  ) {
    throw new Error("Choose a GitHub repository in owner/repository format.");
  }
  const name = value.split("/")[1];
  if (name === "." || name === "..")
    throw new Error("Invalid repository name.");
  return value;
}

function inputError(message) {
  return Object.assign(new Error(message), { status: 400 });
}

export function validateBranchName(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 255 ||
    value === "@" ||
    value.startsWith("-") ||
    value.endsWith(".") ||
    /[\u0000-\u0020\u007f~^:?*\[\\]/.test(value) ||
    value.includes("..") ||
    value.includes("@{") ||
    value
      .split("/")
      .some((part) => !part || part.startsWith(".") || part.endsWith(".lock"))
  )
    throw inputError(
      "Choose a valid branch from this repository (up to 255 characters).",
    );
  return value;
}

function inputObject(value, keys) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  ) {
    throw inputError("Invalid pull request fields.");
  }
  return value;
}

export function validateComparisonInput(value) {
  const input = inputObject(value, ["base", "head"]);
  return {
    base: validateBranchName(input.base),
    head: validateBranchName(input.head),
  };
}

export function validatePullRequestInput(value) {
  const input = inputObject(value, ["base", "head", "title", "body", "draft"]);
  const { base, head } = validateComparisonInput({
    base: input.base,
    head: input.head,
  });
  if (base === head)
    throw inputError("Choose different base and head branches.");
  if (
    typeof input.title !== "string" ||
    !input.title.trim() ||
    input.title.length > 256 ||
    /[\u0000-\u001f\u007f]/.test(input.title)
  ) {
    throw inputError(
      "Add a pull request title of 1–256 characters on one line.",
    );
  }
  if (
    typeof input.body !== "string" ||
    input.body.length > 60_000 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input.body)
  ) {
    throw inputError(
      "The description must be text with at most 60,000 characters.",
    );
  }
  if (typeof input.draft !== "boolean")
    throw inputError("Choose whether this is a draft pull request.");
  return {
    base,
    head,
    title: input.title.trim(),
    body: input.body,
    draft: input.draft,
  };
}

export function validatePullRequestNumber(value) {
  if (!Number.isSafeInteger(value) || value < 1)
    throw inputError("Choose a valid pull request number.");
  return value;
}

export function validateMergeInput(value) {
  const input = inputObject(value, ["sha", "base", "method"]);
  if (typeof input.sha !== "string" || !/^[a-f\d]{40}$/i.test(input.sha))
    throw inputError("Refresh this pull request to get its latest commit.");
  if (!["merge", "squash", "rebase"].includes(input.method))
    throw inputError("Choose merge, squash, or rebase.");
  return {
    sha: input.sha.toLowerCase(),
    base: validateBranchName(input.base),
    method: input.method,
  };
}

export function validateExternalURL(value) {
  if (
    typeof value !== "string" ||
    value.length > 4096 ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new Error("Invalid web address.");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid web address.");
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password
  ) {
    throw new Error("Only http and https web links can be opened.");
  }
  return url.href;
}

export function validateDevURL(value) {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("PINK_DEV_URL must be a loopback HTTP origin.");
  }
  return url.origin;
}

export function isTrustedRendererURL(value, devOrigin = null) {
  try {
    const url = new URL(value);
    const trustedOrigin = devOrigin
      ? url.origin === devOrigin
      : url.protocol === "pink:" && url.host === "app";
    return (
      trustedOrigin &&
      !url.username &&
      !url.password &&
      ["/", "/index.html"].includes(url.pathname)
    );
  } catch {
    return false;
  }
}

export function assertTrustedSender(event, owner, devOrigin = null) {
  if (
    !owner ||
    owner.isDestroyed() ||
    event.sender !== owner ||
    !event.senderFrame ||
    event.senderFrame !== owner.mainFrame ||
    !isTrustedRendererURL(event.senderFrame.url, devOrigin)
  ) {
    throw new Error("This request did not come from the Pink Labs window.");
  }
}

export function containedPath(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

export function resolveAppAsset(value, root) {
  const url = new URL(value);
  if (
    url.protocol !== "pink:" ||
    url.host !== "app" ||
    url.username ||
    url.password
  )
    throw new Error("Unknown app origin.");
  const pathname = decodeURIComponent(url.pathname);
  if (/[\u0000-\u001f\\]/.test(pathname) || pathname.split("/").includes(".."))
    throw new Error("Invalid app path.");
  const candidate = path.resolve(
    root,
    `.${pathname === "/" ? "/index.html" : pathname}`,
  );
  if (!containedPath(root, candidate)) throw new Error("Invalid app path.");
  return candidate;
}

export function isAllowedAPIRequest(request) {
  const host = request.headers.host;
  const port = request.socket.localPort;
  if (
    !port ||
    !new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]).has(
      host,
    )
  )
    return false;
  const origin = request.headers.origin;
  if (origin && origin !== `http://${host}`) return false;
  const site = request.headers["sec-fetch-site"];
  return !site || site === "same-origin" || site === "none";
}
