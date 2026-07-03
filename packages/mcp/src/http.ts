import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createFacilityMcpServer } from "./tools.js";

export type HttpServerOptions = {
  apiUrl: string;
  port: number;
  confirmationSecret?: string;
  fetch?: typeof fetch;
};

export function serveHttp(options: HttpServerOptions) {
  const server = createServer(async (request, response) => {
    if (!isAuthorized(request)) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "missing bearer API key" }));
      return;
    }
    if (request.method !== "POST" || !["/mcp", "/"].includes(request.url?.split("?")[0] ?? "")) {
      response.writeHead(405, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "method not allowed" }));
      return;
    }

    const apiKey = request.headers.authorization?.slice("Bearer ".length) ?? "";
    const mcp = createFacilityMcpServer({
      apiUrl: options.apiUrl,
      apiKey,
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

function isAuthorized(request: IncomingMessage): boolean {
  const header = request.headers.authorization;
  return typeof header === "string" && /^Bearer fak_[A-Za-z0-9]+/.test(header);
}

function writeError(response: ServerResponse, error: unknown) {
  if (response.headersSent) return;
  response.writeHead(500, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32603,
        message: error instanceof Error ? error.message : "Internal server error",
      },
      id: null,
    }),
  );
}
