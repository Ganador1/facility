import type {
  ApiKey,
  AuditEvent,
  AuditTail,
  Budget,
  ConnectProjectRepoRequest,
  CreateProjectRequest,
  InboxResponse,
  Me,
  MemberRow,
  Project,
  ProjectRepo,
  Proposal,
  Provider,
  RegistryItem,
  Role,
  Run,
  RunEvent,
  SpendRow,
} from "@facility/sdk";
import { cookies } from "next/headers";

export type {
  ApiKey,
  AuditEvent,
  Budget,
  ConnectProjectRepoRequest,
  CreateProjectRequest,
  Me,
  Member,
  MemberRow,
  Project,
  ProjectRepo,
  Proposal,
  Provider,
  RegistryItem,
  Role,
  Run,
  RunEvent,
  SpendRow,
} from "@facility/sdk";

/**
 * Server-side client for the control plane. The fetch wrapper stays here so
 * Next can forward the session cookie; domain contracts live in @facility/sdk.
 */

const API_URL = process.env.FACILITY_API_URL ?? "http://localhost:4400";
export const SESSION_COOKIE = "facility_session";

export type KickstartAnswers = {
  defaultBranch?: string;
  provisionCmd?: string;
  checkCmds?: string[];
  modules?: string[];
  modelTier?: string;
  board?: { org: string; project: string | number } | null;
  execution_lane?: Record<string, "repo" | "platform">;
};

export type KickstartPreview = {
  detection?: {
    defaultBranch?: string;
    packageManager?: "pnpm" | "yarn" | "npm" | "none";
    checks?: string[];
    provision?: string;
    org?: string;
    workflowNames?: string[];
    suggestedModules?: string[];
    existing?: {
      agentsMd?: boolean;
      claudeMd?: boolean;
      claudeSettings?: boolean;
      standard?: boolean;
    };
  };
  files: Array<{
    path: string;
    size: number;
    sha256: string;
    mode?: string;
    action?: "create" | "update" | string;
  }>;
  skipped?: string[];
};

export type KickstartResult = {
  branch?: string;
  commitSha?: string;
  pr?: { number?: number; url?: string; html_url?: string; title?: string };
  files?: Array<{ path: string; content?: string; mode?: string }>;
  manifest?: Record<string, unknown>;
};

export type AgentDef = {
  id: string;
  projectId: string;
  name: string;
  engine: string;
  enabled: boolean;
};

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; offline: boolean; message: string };

async function apiFetch<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  const jar = await cookies();
  const session = jar.get(SESSION_COOKIE);
  try {
    const res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(session ? { cookie: `${SESSION_COOKIE}=${session.value}` } : {}),
        ...init?.headers,
      },
      cache: "no-store",
    });
    if (!res.ok) {
      let message = res.statusText;
      try {
        const body = (await res.json()) as { error?: { message?: string } };
        message = body.error?.message ?? message;
      } catch {
        // non-JSON error body — keep statusText
      }
      return { ok: false, status: res.status, offline: false, message };
    }
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, status: 0, offline: true, message: "control plane unreachable" };
  }
}

// The control plane returns bare arrays for list endpoints (and {bucket,
// cost_cents} rows for spend). This client mirrors those shapes exactly.
export const api = {
  me: () => apiFetch<Me>("/v1/me"),
  projects: () => apiFetch<Project[]>("/v1/projects"),
  createProject: (body: CreateProjectRequest) =>
    apiFetch<Project>("/v1/projects", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  project: (id: string) => apiFetch<Project>(`/v1/projects/${id}`),
  projectRepos: (projectId: string) => apiFetch<ProjectRepo[]>(`/v1/projects/${projectId}/repos`),
  connectProjectRepo: (projectId: string, body: ConnectProjectRepoRequest) =>
    apiFetch<ProjectRepo>(`/v1/projects/${projectId}/repos`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  kickstartPreview: (projectId: string, repoId: string) =>
    apiFetch<KickstartPreview>(
      `/v1/projects/${projectId}/kickstart/preview?repoId=${encodeURIComponent(repoId)}`,
    ),
  kickstart: (projectId: string, body: { repoId: string; answers: KickstartAnswers; mode: "pr" }) =>
    apiFetch<KickstartResult>(`/v1/projects/${projectId}/kickstart`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  projectAgents: (projectId: string) => apiFetch<AgentDef[]>(`/v1/projects/${projectId}/agents`),
  runs: (projectId: string, params = "") =>
    apiFetch<Run[]>(`/v1/projects/${projectId}/runs${params}`),
  allRuns: (params = "") =>
    apiFetch<(Run & { project: Pick<Project, "id" | "name" | "slug"> })[]>(`/v1/runs${params}`),
  run: (id: string) => apiFetch<Run>(`/v1/runs/${id}`),
  runEvents: (id: string, afterSeq = 0) =>
    apiFetch<RunEvent[]>(`/v1/runs/${id}/events?afterSeq=${afterSeq}`),
  // GET /v1/inbox returns { items, proposals, issues } — unwrap to the
  // proposals array both consumers expect (guarded so a bare array also works).
  inbox: async (): Promise<ApiResult<Proposal[]>> => {
    const res = await apiFetch<Proposal[] | InboxResponse>("/v1/inbox?state=open");
    if (!res.ok) return res;
    const d = res.data;
    return { ok: true, data: Array.isArray(d) ? d : (d.proposals ?? d.items ?? []) };
  },
  proposal: (id: string) => apiFetch<Proposal & { events?: unknown[] }>(`/v1/proposals/${id}`),
  audit: async (params = ""): Promise<ApiResult<AuditEvent[]>> => {
    const res = await apiFetch<AuditEvent[] | AuditTail>(`/v1/audit${params}`);
    if (!res.ok) return res;
    return { ok: true, data: Array.isArray(res.data) ? res.data : res.data.items };
  },
  registry: (params = "") => apiFetch<RegistryItem[]>(`/v1/registry/items${params}`),
  spend: (params = "") => apiFetch<SpendRow[]>(`/v1/spend${params}`),
  members: () => apiFetch<MemberRow[]>("/v1/members"),
  roles: () => apiFetch<Role[]>("/v1/roles"),
  keys: () => apiFetch<ApiKey[]>("/v1/keys"),
  providers: () => apiFetch<Provider[]>("/v1/providers"),
  budgets: () => apiFetch<Budget[]>("/v1/budgets"),
};

/** Sum + descending groups from the spend endpoint's raw rows. */
export function summarizeSpend(rows: SpendRow[]): {
  totalCents: number;
  groups: Array<{ key: string; cents: number }>;
} {
  const groups = rows
    .map((r) => ({ key: r.bucket, cents: r.cost_cents }))
    .sort((a, b) => b.cents - a.cents);
  return { totalCents: groups.reduce((sum, g) => sum + g.cents, 0), groups };
}
