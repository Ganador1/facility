import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, test } from "vitest";
import { serveHttp } from "../src/http.js";
import { createFacilityMcpServer, toolDefinitions } from "../src/tools.js";

class MemoryTransport implements Transport {
  peer?: MemoryTransport;
  onmessage?: (message: JSONRPCMessage) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;

  async start() {}

  async send(message: JSONRPCMessage) {
    queueMicrotask(() => this.peer?.onmessage?.(message));
  }

  async close() {
    this.onclose?.();
  }
}

function linkedTransports() {
  const client = new MemoryTransport();
  const server = new MemoryTransport();
  client.peer = server;
  server.peer = client;
  return { client, server };
}

function textPayload(result: unknown) {
  const content =
    result && typeof result === "object" && "content" in result ? result.content : undefined;
  if (!Array.isArray(content)) return "{}";
  const first = content[0] as { type?: string; text?: string } | undefined;
  return first?.type === "text" ? (first.text ?? "{}") : "{}";
}

async function connect(stub: {
  request: (method: string, path: string, options?: unknown) => Promise<unknown>;
}) {
  const pair = linkedTransports();
  const server = createFacilityMcpServer({
    apiUrl: "http://facility.test",
    apiKey: "fak_test",
    client: stub,
  });
  const client = new Client({ name: "mcp-test", version: "1.0.0" });
  await server.connect(pair.server);
  await client.connect(pair.client);
  return { client, server };
}

describe("@facility/mcp", () => {
  test("tools/list exposes the spec tool names and schemas", async () => {
    const { client, server } = await connect({ request: async () => ({ ok: true }) });
    const result = await client.listTools();
    expect(result.tools.map((tool) => tool.name)).toEqual(toolDefinitions.map((tool) => tool.name));
    const trigger = result.tools.find((tool) => tool.name === "facility_trigger_run");
    expect(trigger?.description).toContain("Needs runs:trigger");
    expect(trigger?.inputSchema.properties).not.toHaveProperty("confirm_token");
    expect(trigger?.inputSchema.properties).toHaveProperty("projectId");
    await client.close();
    await server.close();
  });

  test("read tool dispatches through the SDK HTTP client layer", async () => {
    const calls: unknown[] = [];
    const { client, server } = await connect({
      request: async (...args) => {
        calls.push(args);
        return { principal: { type: "key" }, org: { slug: "tam" }, permissions: ["org:read"] };
      },
    });
    const result = await client.callTool({ name: "facility_me", arguments: {} });
    expect(JSON.parse(textPayload(result))).toMatchObject({
      org: { slug: "tam" },
    });
    expect(calls).toEqual([["GET", "/v1/me", { body: undefined, query: undefined }]]);
    await client.close();
    await server.close();
  });

  test("write tool creates a HITL proposal instead of executing directly", async () => {
    const calls: unknown[] = [];
    const { client, server } = await connect({
      request: async (...args) => {
        calls.push(args);
        return { id: "prop_1", state: "open" };
      },
    });
    const result = await client.callTool({
      name: "facility_steer_run",
      arguments: { runId: "run_1", body: "continue after tests pass" },
    });
    const payload = JSON.parse(textPayload(result));
    expect(payload.pending_human_approval).toBe(true);
    expect(payload.proposal_id).toBe("prop_1");
    expect(payload.summary).toContain("Steer run run_1");
    expect(calls).toEqual([
      [
        "POST",
        "/v1/mcp/tool-proposals",
        {
          body: {
            toolName: "facility_steer_run",
            permission: "runs:steer",
            args: { runId: "run_1", body: "continue after tests pass" },
            summary: "Steer run run_1 with a human-authored message.",
            projectId: undefined,
            runId: "run_1",
          },
          query: undefined,
        },
      ],
    ]);
    await client.close();
    await server.close();
  });

  test("audit and llm request read tools pass pagination filters", async () => {
    const calls: unknown[] = [];
    const { client, server } = await connect({
      request: async (...args) => {
        calls.push(args);
        return { items: [], nextCursor: null };
      },
    });
    await client.callTool({
      name: "facility_audit_tail",
      arguments: { limit: 10, actor: "key:auditor", action: "mcp.tool.executed", cursor: 12 },
    });
    await client.callTool({
      name: "facility_llm_requests",
      arguments: { projectId: "proj_1", limit: 5, cursor: "2026-07-05T00:00:00.000Z" },
    });
    await client.callTool({
      name: "facility_llm_request_envelope",
      arguments: { requestId: "evt_1" },
    });
    expect(calls).toEqual([
      [
        "GET",
        "/v1/audit",
        {
          body: undefined,
          query: {
            limit: 10,
            actor: "key:auditor",
            action: "mcp.tool.executed",
            cursor: 12,
          },
        },
      ],
      [
        "GET",
        "/v1/llm-requests",
        {
          body: undefined,
          query: {
            projectId: "proj_1",
            from: undefined,
            to: undefined,
            limit: 5,
            cursor: "2026-07-05T00:00:00.000Z",
          },
        },
      ],
      ["GET", "/v1/llm-requests/evt_1/envelope", { body: undefined, query: undefined }],
    ]);
    await client.close();
    await server.close();
  });

  test("same MCP caller cannot self-replay a write into direct execution", async () => {
    const calls: unknown[] = [];
    const { client, server } = await connect({
      request: async (...args) => {
        calls.push(args);
        return { id: `prop_${calls.length}`, state: "open" };
      },
    });
    await client.callTool({
      name: "facility_steer_run",
      arguments: { runId: "run_1", body: "ship it" },
    });
    await client.callTool({
      name: "facility_steer_run",
      arguments: { runId: "run_1", body: "ship it", confirm_token: "old-self-replay-token" },
    });
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => (call as unknown[])[1] === "/v1/mcp/tool-proposals")).toBe(true);
    await client.close();
    await server.close();
  });

  test("streamable HTTP transport returns 401 without bearer API key", async () => {
    const server = serveHttp({
      apiUrl: "http://facility.test",
      port: 0,
    });
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", body: "{}" });
    assert.equal(response.status, 401);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
