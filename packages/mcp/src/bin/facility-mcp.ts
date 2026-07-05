#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { serveHttp } from "../http.js";
import { createFacilityMcpServer } from "../tools.js";

const [command, ...rest] = process.argv.slice(2);

if (command === "serve") {
  const port = Number(flag(rest, "--port") ?? "4420");
  const apiUrl = process.env.FACILITY_API_URL;
  if (!apiUrl) {
    console.error("FACILITY_API_URL is required.");
    process.exit(2);
  }
  // OAuth 2.1 discovery is advertised only when an authorization server is
  // configured; otherwise the server stays API-key-only. WORKOS_AUTHKIT_DOMAIN
  // is the WorkOS authorization server; MCP_PUBLIC_URL is this resource's URL.
  const authRaw = process.env.MCP_AUTHORIZATION_SERVER ?? process.env.WORKOS_AUTHKIT_DOMAIN;
  const authorizationServer = authRaw
    ? /^https?:\/\//.test(authRaw)
      ? authRaw.replace(/\/+$/, "")
      : `https://${authRaw.replace(/\/+$/, "")}`
    : undefined;
  serveHttp({
    apiUrl,
    port,
    confirmationSecret:
      process.env.FACILITY_MCP_CONFIRMATION_SECRET ?? process.env.MCP_CONFIRMATION_SECRET,
    resourceUrl: process.env.MCP_PUBLIC_URL?.replace(/\/+$/, ""),
    authorizationServer,
  });
  console.error(`facility-mcp listening on http://127.0.0.1:${port}/mcp`);
} else {
  const apiUrl = process.env.FACILITY_API_URL;
  const apiKey = process.env.FACILITY_API_KEY;
  if (!apiUrl || !apiKey) {
    console.error("FACILITY_API_URL and FACILITY_API_KEY are required for stdio transport.");
    process.exit(2);
  }
  const server = createFacilityMcpServer({
    apiUrl,
    apiKey,
    confirmationSecret:
      process.env.FACILITY_MCP_CONFIRMATION_SECRET ?? process.env.MCP_CONFIRMATION_SECRET,
  });
  await server.connect(new StdioServerTransport());
}

function flag(args: string[], name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}
