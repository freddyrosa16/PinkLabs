import { getRepository, listRepositories } from "./github.mjs";
import { isAllowedAPIRequest, validateRepositoryName } from "./validation.mjs";

export function createApiMiddleware(
  services = { getRepository, listRepositories },
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
    if (request.method !== "GET")
      return send(405, { error: "This preview API is read-only." });
    try {
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
      return send(404, { error: "Unknown Pink Labs API endpoint." });
    } catch (error) {
      // The GitHub service returns user-safe errors, never raw gh authentication output.
      return send(502, {
        error:
          error instanceof Error
            ? error.message
            : "GitHub is unavailable. Try again.",
      });
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
