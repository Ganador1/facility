import {
  FacilityClient,
  type FacilityRouteBody,
  type FacilityRouteResponse,
  type McpToolProposalRequest,
  type Project,
  type QueryParams,
  type Run,
  type RunEvent,
} from "@facility/sdk";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod/v4";

type Method = "GET" | "POST" | "PATCH" | "DELETE";
type Shape = Record<string, z.ZodType>;
type Args = Record<string, unknown>;
type ApiRequest = {
  method: Method;
  path: string;
  query?: QueryParams;
  body?: unknown;
};
type ApiClient = {
  request<RequestMethod extends Method, Path extends string>(
    method: RequestMethod,
    path: Path,
    options?: {
      query?: QueryParams;
      body?: FacilityRouteBody<RequestMethod, Path>;
    },
  ): Promise<FacilityRouteResponse<RequestMethod, Path>>;
};
type ApiClientLike = {
  request(
    method: string,
    path: string,
    options?: { query?: QueryParams; body?: unknown },
  ): Promise<unknown>;
};

const optionalString = z.string().min(1).optional();
export type FacilityMcpOptions = {
  apiUrl: string;
  apiKey: string;
  confirmationSecret?: string;
  fetch?: typeof fetch;
  client?: ApiClientLike;
  clientId?: string;
};

type ToolDefinition = {
  name: string;
  description: string;
  permission: string;
  inputSchema?: Shape;
  write?: boolean;
  request: (args: Args) => ApiRequest | Promise<ApiRequest>;
  summarize?: (args: Args) => string;
};

const readTools: ToolDefinition[] = [
  {
    name: "facility_me",
    permission: "org:read",
    description:
      "Show the authenticated Facility principal, org, and granted permissions. Needs org:read.",
    request: () => ({ method: "GET", path: "/v1/me" }),
  },
  {
    name: "facility_list_projects",
    permission: "projects:read",
    description:
      "List Facility projects visible to the caller, optionally filtered by status. Needs projects:read.",
    inputSchema: {
      status: optionalString.describe("Project status filter, such as active or archived."),
    },
    request: (args) => ({
      method: "GET",
      path: "/v1/projects",
      query: { status: str(args.status) },
    }),
  },
  {
    name: "facility_get_project",
    permission: "projects:read",
    description:
      "Fetch one Facility project by id for configuration, status, and repo context. Needs projects:read.",
    inputSchema: { projectId: z.string().min(1).describe("Facility project id.") },
    request: (args) => ({ method: "GET", path: `/v1/projects/${str(args.projectId)}` }),
  },
  {
    name: "facility_list_runs",
    permission: "runs:read",
    description:
      "List runs for a project, or all visible projects when projectId is omitted. Needs runs:read.",
    inputSchema: {
      projectId: optionalString.describe(
        "Facility project id. Omit to aggregate visible projects.",
      ),
      status: optionalString.describe(
        "Run status filter, such as running, failed, or awaiting_human.",
      ),
    },
    request: (args) =>
      args.projectId
        ? {
            method: "GET",
            path: `/v1/projects/${str(args.projectId)}/runs`,
            query: { status: str(args.status) },
          }
        : { method: "GET", path: "/v1/projects", query: { status: "active" } },
  },
  {
    name: "facility_get_run",
    permission: "runs:read",
    description:
      "Fetch one run and include the last N run events inline, capped at 50. Needs runs:read.",
    inputSchema: {
      runId: z.string().min(1).describe("Facility run id."),
      lastEvents: z
        .number()
        .int()
        .min(0)
        .max(50)
        .default(25)
        .describe("Number of recent events to include, max 50."),
    },
    request: (args) => ({ method: "GET", path: `/v1/runs/${str(args.runId)}` }),
  },
  {
    name: "facility_list_inbox",
    permission: "hitl:read",
    description: "List human-in-the-loop proposals waiting on the caller. Needs hitl:read.",
    inputSchema: {
      state: optionalString.describe(
        "Proposal state filter. Defaults to open in most operator workflows.",
      ),
    },
    request: (args) => ({ method: "GET", path: "/v1/inbox", query: { state: str(args.state) } }),
  },
  {
    name: "facility_get_proposal",
    permission: "hitl:read",
    description: "Fetch one proposal with its decision ledger events. Needs hitl:read.",
    inputSchema: { proposalId: z.string().min(1).describe("Facility proposal id.") },
    request: (args) => ({ method: "GET", path: `/v1/proposals/${str(args.proposalId)}` }),
  },
  {
    name: "facility_spend",
    permission: "spend:read",
    description:
      "Review LLM spend counters, optionally scoped to a project and grouped for analysis. Needs spend:read.",
    inputSchema: {
      projectId: optionalString.describe("Facility project id."),
      groupBy: z.enum(["model", "agent", "day"]).optional().describe("Aggregation bucket."),
    },
    request: (args) => ({
      method: "GET",
      path: "/v1/spend",
      query: { projectId: str(args.projectId), groupBy: str(args.groupBy) },
    }),
  },
  {
    name: "facility_list_registry",
    permission: "registry:read",
    description:
      "List registry items such as skills, guards, contracts, harnesses, and template sets. Needs registry:read.",
    inputSchema: { kind: optionalString.describe("Registry item kind filter.") },
    request: (args) => ({
      method: "GET",
      path: "/v1/registry/items",
      query: { kind: str(args.kind) },
    }),
  },
  {
    name: "facility_get_registry_item",
    permission: "registry:read",
    description:
      "Fetch one registry item with versions so the active content can be inspected. Needs registry:read.",
    inputSchema: { itemId: z.string().min(1).describe("Registry item id.") },
    request: (args) => ({ method: "GET", path: `/v1/registry/items/${str(args.itemId)}` }),
  },
  {
    name: "facility_list_issues",
    permission: "issues:read",
    description:
      "List platform issues such as drift, budget breaches, stuck runs, and integration errors. Needs issues:read.",
    inputSchema: {
      state: optionalString.describe("Issue state filter."),
      kind: optionalString.describe("Issue kind filter."),
    },
    request: (args) => ({
      method: "GET",
      path: "/v1/issues",
      query: { state: str(args.state), kind: str(args.kind) },
    }),
  },
  {
    name: "facility_audit_tail",
    permission: "audit:read",
    description:
      "Read the latest audit events for incident review and change attribution. Needs audit:read.",
    inputSchema: {
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(25)
        .describe("Maximum audit events to return, max 100."),
      actor: optionalString.describe("Actor id or type:id filter."),
      action: optionalString.describe("Audit action filter."),
      cursor: z.number().int().optional().describe("Pagination cursor from the previous page."),
    },
    request: (args) => ({
      method: "GET",
      path: "/v1/audit",
      query: {
        limit: Math.min(Number(args.limit ?? 25), 100),
        actor: str(args.actor),
        action: str(args.action),
        cursor: typeof args.cursor === "number" ? args.cursor : undefined,
      },
    }),
  },
  {
    name: "facility_llm_requests",
    permission: "spend:read",
    description:
      "Fetch raw LLM request rows for data mining, including tokens, cost, latency, status, and envelope URIs. Needs spend:read.",
    inputSchema: {
      projectId: optionalString.describe("Facility project id."),
      from: optionalString.describe("Inclusive ISO timestamp lower bound."),
      to: optionalString.describe("Inclusive ISO timestamp upper bound."),
      limit: z.number().int().min(1).max(100).default(25).describe("Page size, max 100."),
      cursor: optionalString.describe("Pagination cursor from the previous page."),
    },
    request: (args) => ({
      method: "GET",
      path: "/v1/llm-requests",
      query: {
        projectId: str(args.projectId),
        from: str(args.from),
        to: str(args.to),
        limit: Math.min(Number(args.limit ?? 25), 100),
        cursor: str(args.cursor),
      },
    }),
  },
  {
    name: "facility_llm_request_envelope",
    permission: "spend:read",
    description:
      "Fetch the stored request/response envelope for one LLM request id. Needs spend:read or audit:read.",
    inputSchema: {
      requestId: z.string().min(1).describe("llm_requests.id to fetch."),
    },
    request: (args) => ({
      method: "GET",
      path: `/v1/llm-requests/${str(args.requestId)}/envelope`,
    }),
  },
  {
    name: "facility_list_budgets",
    permission: "budgets:read",
    description:
      "List org, project, and agent budget limits used by gateway enforcement. Needs budgets:read.",
    request: () => ({ method: "GET", path: "/v1/budgets" }),
  },
  {
    name: "facility_kickstart_preview",
    permission: "projects:kickstart",
    description:
      "Preview remote kickstart files and conflicts for a project repo before opening a PR. Needs projects:kickstart.",
    inputSchema: {
      projectId: z.string().min(1).describe("Facility project id."),
      repoId: z
        .string()
        .min(1)
        .describe("Facility repo id or owner/name, depending on API configuration."),
    },
    request: (args) => ({
      method: "GET",
      path: `/v1/projects/${str(args.projectId)}/kickstart/preview`,
      query: { repoId: str(args.repoId) },
    }),
  },
];

const writeTools: ToolDefinition[] = [
  {
    name: "facility_trigger_run",
    permission: "runs:trigger",
    description:
      "Trigger a platform-native agent run for a project. Needs runs:trigger and requires confirmation.",
    write: true,
    inputSchema: {
      projectId: z.string().min(1).describe("Facility project id."),
      agentName: z.string().min(1).describe("Agent definition name to run."),
      input: z.unknown().optional().describe("Operator input payload for the run trigger."),
    },
    summarize: (args) => `Trigger agent ${str(args.agentName)} on project ${str(args.projectId)}.`,
    request: (args) => ({
      method: "POST",
      path: `/v1/projects/${str(args.projectId)}/runs`,
      body: {
        mode: "manual",
        engine: "codex",
        trigger: { source: "mcp", agentName: args.agentName, input: args.input },
      },
    }),
  },
  {
    name: "facility_cancel_run",
    permission: "runs:write",
    description: "Cancel a queued or active run. Needs runs:write and requires confirmation.",
    write: true,
    inputSchema: { runId: z.string().min(1).describe("Facility run id.") },
    summarize: (args) => `Cancel run ${str(args.runId)}.`,
    request: (args) => ({ method: "POST", path: `/v1/runs/${str(args.runId)}/cancel` }),
  },
  {
    name: "facility_steer_run",
    permission: "runs:steer",
    description:
      "Send an audited steering message into an active run. Needs runs:steer and requires confirmation.",
    write: true,
    inputSchema: {
      runId: z.string().min(1).describe("Facility run id."),
      body: z.string().min(1).describe("Steering instruction to inject."),
    },
    summarize: (args) => `Steer run ${str(args.runId)} with a human-authored message.`,
    request: (args) => ({
      method: "POST",
      path: `/v1/runs/${str(args.runId)}/steer`,
      body: { body: args.body },
    }),
  },
  {
    name: "facility_decide_proposal",
    permission: "hitl:decide",
    description:
      "Approve or reject a HITL proposal and append the decision ledger. Needs hitl:decide and requires confirmation.",
    write: true,
    inputSchema: {
      proposalId: z.string().min(1).describe("Facility proposal id."),
      decision: z.enum(["approve", "reject"]).describe("Decision to record."),
      note: optionalString.describe("Optional decision note."),
    },
    summarize: (args) => `${str(args.decision)} proposal ${str(args.proposalId)}.`,
    request: (args) => ({
      method: "POST",
      path: `/v1/proposals/${str(args.proposalId)}/decide`,
      body: { decision: args.decision, note: args.note },
    }),
  },
  {
    name: "facility_create_project",
    permission: "projects:write",
    description:
      "Create a Facility project control-plane record. Needs projects:write and requires confirmation.",
    write: true,
    inputSchema: {
      name: z.string().min(1).describe("Project display name."),
      slug: z.string().min(1).describe("Stable project slug."),
      description: optionalString.describe("Optional project description."),
    },
    summarize: (args) => `Create project ${str(args.slug)}.`,
    request: (args) => ({ method: "POST", path: "/v1/projects", body: args }),
  },
  {
    name: "facility_kickstart",
    permission: "projects:kickstart",
    description:
      "Open a governed kickstart PR for a project repo. Needs projects:kickstart and requires confirmation.",
    write: true,
    inputSchema: {
      projectId: z.string().min(1).describe("Facility project id."),
      repoId: z.string().min(1).describe("Facility repo id or owner/name."),
      answers: z
        .record(z.string(), z.unknown())
        .describe("Kickstart answers for rendering the managed assets."),
    },
    summarize: (args) => `Kickstart repo ${str(args.repoId)} for project ${str(args.projectId)}.`,
    request: (args) => ({
      method: "POST",
      path: `/v1/projects/${str(args.projectId)}/kickstart`,
      body: { repoId: args.repoId, answers: args.answers },
    }),
  },
  {
    name: "facility_upgrade_project",
    permission: "projects:write",
    description:
      "Open a governed upgrade PR for a managed project. Needs projects:write and requires confirmation.",
    write: true,
    inputSchema: {
      projectId: z.string().min(1).describe("Facility project id."),
      repoId: z.string().min(1).describe("Facility repo id or owner/name."),
      toVersion: optionalString.describe("Target Facility system/template version."),
    },
    summarize: (args) =>
      `Upgrade project ${str(args.projectId)}${args.toVersion ? ` to ${str(args.toVersion)}` : ""}.`,
    request: (args) => ({
      method: "POST",
      path: `/v1/projects/${str(args.projectId)}/upgrade`,
      body: { repoId: args.repoId, toVersion: args.toVersion },
    }),
  },
  {
    name: "facility_set_budget",
    permission: "budgets:write",
    description:
      "Create or update a spend budget used by gateway enforcement. Needs budgets:write and requires confirmation.",
    write: true,
    inputSchema: {
      budgetId: optionalString.describe("Existing budget id to update; omit to create."),
      scope: z.enum(["org", "project", "agent_def"]).describe("Budget scope."),
      projectId: optionalString.describe("Project id for project or agent budgets."),
      agentDefId: optionalString.describe("Agent definition id for agent budgets."),
      period: z.enum(["daily", "weekly", "monthly"]).describe("Budget period."),
      limitCents: z.number().int().nonnegative().describe("Budget limit in cents."),
      mode: z.enum(["soft", "hard"]).describe("Soft alert or hard block mode."),
      enabled: z.boolean().default(true).describe("Whether the budget is active."),
    },
    summarize: (args) =>
      `Set ${str(args.period)} ${str(args.scope)} budget to ${String(args.limitCents)} cents.`,
    request: (args) =>
      args.budgetId
        ? {
            method: "PATCH",
            path: `/v1/budgets/${str(args.budgetId)}`,
            body: omit(args, ["confirm_token", "budgetId"]),
          }
        : { method: "POST", path: "/v1/budgets", body: omit(args, ["confirm_token", "budgetId"]) },
  },
  {
    name: "facility_publish_registry_version",
    permission: "registry:publish",
    description:
      "Publish a draft registry version as active content. Needs registry:publish and requires confirmation.",
    write: true,
    inputSchema: { versionId: z.string().min(1).describe("Registry version id.") },
    summarize: (args) => `Publish registry version ${str(args.versionId)}.`,
    request: (args) => ({
      method: "POST",
      path: `/v1/registry/versions/${str(args.versionId)}/publish`,
    }),
  },
  {
    name: "facility_create_agent",
    permission: "agents:write",
    description:
      "Create a project agent definition bound to a contract, triggers, and sandbox. Needs agents:write and requires confirmation.",
    write: true,
    inputSchema: {
      projectId: z.string().min(1).describe("Facility project id."),
      name: z.string().min(1).describe("Agent definition name."),
      engine: z.enum(["claude_code", "codex", "byo"]).describe("Execution engine."),
      model: z.unknown().describe("Model policy/configuration accepted by the API."),
      contractItemId: optionalString.describe("Registry contract item id."),
      contractContent: optionalString.describe(
        "Inline contract content when no registry item exists.",
      ),
      triggers: z.array(z.record(z.string(), z.unknown())).describe("Agent trigger definitions."),
      sandboxProfileId: optionalString.describe("Sandbox profile id."),
    },
    summarize: (args) => `Create agent ${str(args.name)} in project ${str(args.projectId)}.`,
    request: (args) => ({
      method: "POST",
      path: `/v1/projects/${str(args.projectId)}/agents`,
      body: omit(args, ["confirm_token", "projectId"]),
    }),
  },
];

export const toolDefinitions = [...readTools, ...writeTools];

export function createFacilityMcpServer(options: FacilityMcpOptions): McpServer {
  const server = new McpServer({ name: "@facility/mcp", version: "0.3.0" });
  const client =
    options.client ??
    new FacilityClient({ baseUrl: options.apiUrl, apiKey: options.apiKey, fetch: options.fetch });
  const api = client as ApiClient;

  for (const tool of toolDefinitions) {
    const inputSchema = tool.inputSchema;
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema,
        annotations: tool.write
          ? { destructiveHint: true, readOnlyHint: false }
          : { readOnlyHint: true },
      },
      async (args) => {
        const recordArgs = (args ?? {}) as Args;
        if (tool.write) {
          return jsonResult(await proposeWrite(tool, recordArgs, api));
        }
        return jsonResult(await dispatchTool(tool, recordArgs, api));
      },
    );
  }

  server.registerResource(
    "facility-me",
    "facility://me",
    { mimeType: "application/json", description: "Current Facility principal and org." },
    async () => ({
      contents: [
        {
          uri: "facility://me",
          mimeType: "application/json",
          text: JSON.stringify(await api.request("GET", "/v1/me"), null, 2),
        },
      ],
    }),
  );
  server.registerResource(
    "facility-project",
    new ResourceTemplate("facility://projects/{id}", { list: undefined }),
    { mimeType: "application/json", description: "Facility project by id." },
    async (uri, variables) => ({
      contents: [
        {
          uri: uri.toString(),
          mimeType: "application/json",
          text: JSON.stringify(await api.request("GET", `/v1/projects/${variables.id}`), null, 2),
        },
      ],
    }),
  );
  server.registerResource(
    "facility-run",
    new ResourceTemplate("facility://runs/{id}", { list: undefined }),
    { mimeType: "application/json", description: "Facility run transcript window by id." },
    async (uri, variables) => {
      const run = await api.request("GET", `/v1/runs/${variables.id}`);
      const events = await api.request("GET", `/v1/runs/${variables.id}/events`, {
        query: { afterSeq: 0 },
      });
      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: "application/json",
            text: JSON.stringify({ run, events }, null, 2),
          },
        ],
      };
    },
  );

  server.registerPrompt(
    "facility-status",
    {
      description:
        "Build an org-wide Facility status brief from projects, inbox, issues, budgets, and spend.",
    },
    async () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: "Summarize Facility org health: live runs, open HITL items, issues, budgets, and spend. Use facility_* read tools and cite concerning changes first.",
          },
        },
      ],
    }),
  );
  server.registerPrompt(
    "facility-run-triage",
    { description: "Walk through diagnosis for a stuck or failing Facility run." },
    async () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: "Triage a Facility run: fetch the run, inspect recent events, check related inbox proposals and issues, then recommend the next safe operator action.",
          },
        },
      ],
    }),
  );
  server.registerPrompt(
    "facility-cost-review",
    { description: "Review Facility spend and budget pressure for operators." },
    async () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: "Review Facility spend by project/model/agent, compare against budgets, and call out hard-stop risk or abnormal cost movement.",
          },
        },
      ],
    }),
  );

  return server;
}

async function dispatchTool(tool: ToolDefinition, args: Args, api: ApiClient): Promise<unknown> {
  if (tool.name === "facility_list_runs" && !args.projectId) {
    const projects = await api.request("GET", "/v1/projects", { query: { status: "active" } });
    const runs = await Promise.all(
      projects.map(async (project: Project) => {
        const id = project.id;
        return id
          ? api.request("GET", `/v1/projects/${id}/runs`, { query: { status: str(args.status) } })
          : [];
      }),
    );
    return runs.flat();
  }
  if (tool.name === "facility_get_run") {
    const runId = str(args.runId) ?? "";
    const run: Run = await api.request("GET", `/v1/runs/${runId}`);
    const allEvents: RunEvent[] = await api.request("GET", `/v1/runs/${runId}/events`, {
      query: { afterSeq: 0 },
    });
    const max = Math.min(Number(args.lastEvents ?? 25), 50);
    return { ...run, events: allEvents.slice(-max) };
  }
  if (tool.name === "facility_audit_tail") {
    const request = await tool.request(args);
    return api.request(request.method, request.path, { query: request.query, body: request.body });
  }
  const request = await tool.request(args);
  return api.request(request.method, request.path, { query: request.query, body: request.body });
}

async function proposeWrite(tool: ToolDefinition, args: Args, api: ApiClient): Promise<unknown> {
  const cleanArgs = omit(args, ["confirm_token"]);
  const summary = tool.summarize?.(cleanArgs) ?? `Run ${tool.name}.`;
  const proposal = await api.request("POST", "/v1/mcp/tool-proposals", {
    body: {
      toolName: tool.name,
      permission: tool.permission,
      args: cleanArgs,
      summary,
      projectId: str(cleanArgs.projectId),
      runId: str(cleanArgs.runId),
    } satisfies McpToolProposalRequest,
  });
  return {
    pending_human_approval: true,
    proposal_id: proposal.id,
    inbox: proposal.id ? `/v1/proposals/${String(proposal.id)}` : "/v1/inbox",
    summary,
    message:
      "Pending human approval. A different principal with hitl:decide must approve this proposal from the HITL inbox; the MCP caller cannot complete it alone.",
  };
}

function jsonResult(value: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent:
      value && typeof value === "object" ? (value as Record<string, unknown>) : { value },
  };
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function omit(record: Args, keys: string[]): Args {
  const blocked = new Set(keys);
  return Object.fromEntries(Object.entries(record).filter(([key]) => !blocked.has(key)));
}
