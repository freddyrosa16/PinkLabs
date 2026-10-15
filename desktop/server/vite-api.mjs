import {
  getRepository,
  listRepositories,
  listBranches,
  compareBranches,
  createPullRequest,
} from "./github.mjs";
import {
  isAllowedAPIRequest,
  validateRepositoryName,
  validateComparisonInput,
  validatePullRequestInput,
} from "./validation.mjs";

const MAX_JSON_BYTES = 256 * 1024;
const badRequest = (message, status = 400) =>
  Object.assign(new Error(message), { status });

function readJSON(request) {
  // Rejected/aborted uploads can emit another stream error while being drained.
  request.on("error", () => {});
  if (
    request.headers["content-type"]?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  ) {
    return Promise.reject(
      badRequest("Send pull request details as application/json.", 415),
    );
  }
  if (Number(request.headers["content-length"]) > MAX_JSON_BYTES) {
    request.resume();
    return Promise.reject(
      badRequest("The pull request description is too large.", 413),
    );
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    const cleanup = () => {
      clearTimeout(timer);
      request.removeListener("data", onData);
      request.removeListener("end", onEnd);
      request.removeListener("error", onError);
      request.removeListener("aborted", onAborted);
    };
    const fail = (error) => {
      cleanup();
      request.resume();
      reject(error);
    };
    const onData = (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_JSON_BYTES)
        return fail(
          badRequest("The pull request description is too large.", 413),
        );
      chunks.push(chunk);
    };
    const onEnd = () => {
      cleanup();
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(badRequest("The pull request details are not valid JSON."));
      }
    };
    const onError = () =>
      fail(badRequest("Could not read the pull request details."));
    const onAborted = () =>
      fail(badRequest("The pull request upload was interrupted."));
    const timer = setTimeout(
      () => fail(badRequest("The pull request upload took too long.", 408)),
      10_000,
    );
    request.on("data", onData);
    request.once("end", onEnd);
    request.once("error", onError);
    request.once("aborted", onAborted);
  });
}

export function createApiMiddleware(
  services = {
    getRepository,
    listRepositories,
    listBranches,
    compareBranches,
    createPullRequest,
  },
) {
  return async function pinkApi(request, response, next) {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (!url.pathname.startsWith("/api/")) return next();
    const send = (status, payload) => {
      response.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy": "same-origin",
      });
      response.end(JSON.stringify(payload));
    };
    if (!isAllowedAPIRequest(request))
      return send(403, {
        error: "GitHub data is only available to the local Pink Labs preview.",
      });
    const creatingPull =
      url.pathname === "/api/pulls" && request.method === "POST";
    if (request.method !== "GET" && !creatingPull)
      return send(405, { error: "This action is not supported." });
    if (
      creatingPull &&
      request.headers.origin !== `http://${request.headers.host}`
    ) {
      return send(403, {
        error:
          "Pull requests can only be created from the local Pink Labs preview.",
      });
    }
    try {
      if (creatingPull) {
        const raw = await readJSON(request);
        if (!raw || typeof raw !== "object" || Array.isArray(raw))
          throw badRequest("Invalid pull request details.");
        const { repo, ...fields } = raw;
        let fullName;
        try {
          fullName = validateRepositoryName(repo);
        } catch (error) {
          throw badRequest(error.message);
        }
        const input = validatePullRequestInput(fields);
        return send(200, await services.createPullRequest(fullName, input));
      }
      if (url.pathname === "/api/repository") {
        let repo;
        try {
          repo = validateRepositoryName(url.searchParams.get("repo"));
        } catch (error) {
          return send(400, { error: error.message });
        }
        return send(200, await services.getRepository(repo));
      }
      if (url.pathname === "/api/repositories")
        return send(200, await services.listRepositories());
      if (["/api/branches", "/api/compare"].includes(url.pathname)) {
        let repo;
        try {
          repo = validateRepositoryName(url.searchParams.get("repo"));
        } catch (error) {
          throw badRequest(error.message);
        }
        if (url.pathname === "/api/branches")
          return send(200, await services.listBranches(repo));
        const input = validateComparisonInput({
          base: url.searchParams.get("base"),
          head: url.searchParams.get("head"),
        });
        return send(200, await services.compareBranches(repo, input));
      }
      return send(404, { error: "Unknown Pink Labs API endpoint." });
    } catch (error) {
      // The GitHub service returns user-safe errors, never raw gh authentication output.
      return send(
        [400, 401, 403, 404, 408, 409, 413, 415, 422, 429].includes(
          error.status,
        )
          ? error.status
          : 502,
        {
          error:
            error instanceof Error
              ? error.message
              : "GitHub is unavailable. Try again.",
        },
      );
    }
  };
}

export function pinkApiPlugin() {
  return {
    name: "pink-labs-local-github",
    configureServer(server) {
      server.middlewares.use(createApiMiddleware());
    },
    configurePreviewServer(server) {
      server.middlewares.use(createApiMiddleware());
    },
  };
}

export default pinkApiPlugin;
