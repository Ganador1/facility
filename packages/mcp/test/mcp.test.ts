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
    confirmationSecret: "test-secret",
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
    expect(trigger?.inputSchema.properties).toHaveProperty("confirm_token");
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

  test("write tool without token requires confirmation and performs no API call", async () => {
    const calls: unknown[] = [];
    const { client, server } = await connect({
      request: async (...args) => {
        calls.push(args);
        return { shouldNot: "happen" };
      },
    });
    const result = await client.callTool({
      name: "facility_steer_run",
      arguments: { runId: "run_1", body: "continue after tests pass" },
    });
    const payload = JSON.parse(textPayload(result));
    expect(payload.requires_confirmation).toBe(true);
    expect(payload.summary).toContain("Steer run run_1");
    expect(calls).toEqual([]);
    await client.close();
    await server.close();
  });

  test("write tool rejects a token bound to different arguments", async () => {
    const { client, server } = await connect({
      request: async () => {
        throw new Error("must not execute");
      },
    });
    const first = await client.callTool({
      name: "facility_cancel_run",
      arguments: { runId: "run_1" },
    });
    const token = JSON.parse(textPayload(first)).token;
    const tampered = await client.callTool({
      name: "facility_cancel_run",
      arguments: { runId: "run_2", confirm_token: token },
    });
    expect(tampered.isError).toBe(true);
    expect(textPayload(tampered)).toContain("Confirmation token is invalid");
    await client.close();
    await server.close();
  });

  test("write tool with valid token executes exact API request", async () => {
    const calls: unknown[] = [];
    const { client, server } = await connect({
      request: async (...args) => {
        calls.push(args);
        return { id: "evt_1", body: "ship it" };
      },
    });
    const first = await client.callTool({
      name: "facility_steer_run",
      arguments: { runId: "run_1", body: "ship it" },
    });
    const token = JSON.parse(textPayload(first)).token;
    await client.callTool({
      name: "facility_steer_run",
      arguments: { runId: "run_1", body: "ship it", confirm_token: token },
    });
    expect(calls).toEqual([
      ["POST", "/v1/runs/run_1/steer", { body: { body: "ship it" }, query: undefined }],
    ]);
    await client.close();
    await server.close();
  });

  test("streamable HTTP transport returns 401 without bearer API key", async () => {
    const server = serveHttp({
      apiUrl: "http://facility.test",
      port: 0,
      confirmationSecret: "test-secret",
    });
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", body: "{}" });
    assert.equal(response.status, 401);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
