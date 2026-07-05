import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createFacilityMcpServer } from "./tools.js";

export type HttpServerOptions = {
  apiUrl: string;
  port: number;
  confirmationSecret?: string;
  fetch?: typeof fetch;
  // OAuth 2.1 resource-server discovery (RFC 9728). When set, the server
  // advertises the WorkOS authorization server so interactive MCP clients
  // (Claude, Cursor, ChatGPT) can run the OAuth 2.1 / PKCE flow. `fak_` API
  // keys continue to work unchanged for non-interactive service use.
  resourceUrl?: string;
  authorizationServer?: string;
};

const PROTECTED_RESOURCE_PATH = "/.well-known/oauth-protected-resource";

export function serveHttp(options: HttpServerOptions) {
  const server = createServer(async (request, response) => {
    const path = request.url?.split("?")[0] ?? "";

    // Public OAuth discovery document — served without auth so an interactive
    // client can bootstrap the flow before it holds a token.
    if (request.method === "GET" && path === PROTECTED_RESOURCE_PATH) {
      if (!options.authorizationServer) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "oauth_not_configured" }));
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          resource: options.resourceUrl ?? "",
          authorization_servers: [options.authorizationServer],
          bearer_methods_supported: ["header"],
        }),
      );
      return;
    }

    if (!isAuthorized(request)) {
      response.writeHead(401, {
        "content-type": "application/json",
        "www-authenticate": wwwAuthenticate(options),
      });
      response.end(JSON.stringify({ error: "missing or invalid bearer token" }));
      return;
    }
    if (request.method !== "POST" || !["/mcp", "/"].includes(path)) {
      response.writeHead(405, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "method not allowed" }));
      return;
    }

    const bearer = request.headers.authorization?.slice("Bearer ".length).trim() ?? "";
    const mcp = createFacilityMcpServer({
      apiUrl: options.apiUrl,
      apiKey: bearer,
      confirmationSecret: options.confirmationSecret,
      fetch: options.fetch,
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    try {
      await mcp.connect(transport);
      await transport.handleRequest(request, response);
      response.on("close", () => {
        void transport.close();
        void mcp.close();
      });
    } catch (error) {
      writeError(response, error);
    }
  });
  server.listen(options.port);
  return server;
}

// Accept any non-empty Bearer credential — a `fak_` API key OR a WorkOS OAuth
// 2.1 access token (JWT). The control plane validates which kind it is and
// rejects invalid ones; the MCP server only forwards the credential.
function isAuthorized(request: IncomingMessage): boolean {
  const header = request.headers.authorization;
  return typeof header === "string" && /^Bearer\s+\S+/.test(header);
}

function wwwAuthenticate(options: HttpServerOptions): string {
  if (options.authorizationServer && options.resourceUrl) {
    return `Bearer resource_metadata="${options.resourceUrl}${PROTECTED_RESOURCE_PATH}"`;
  }
  return "Bearer";
}

function writeError(response: ServerResponse, error: unknown) {
  if (response.headersSent) return;
  // Log server-side; return a generic JSON-RPC error so upstream/config detail
  // is never leaked to the client.
  console.error("mcp http error", error);
  response.writeHead(500, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32603, message: "Internal server error" },
      id: null,
    }),
  );
}
