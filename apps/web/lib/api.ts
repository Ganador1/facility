import { cookies } from "next/headers";

/**
 * Server-side client for the control plane. Typed against the v1 API
 * (docs/platform/specs/control-plane.md); replaced by @facility/sdk once the
 * generated client lands — keep this surface minimal.
 */

const API_URL = process.env.FACILITY_API_URL ?? "http://localhost:4400";
export const SESSION_COOKIE = "facility_session";

export type Principal = {
  type: "user" | "key";
  userId?: string;
  name?: string;
  email?: string;
  org: { id: string; name: string; slug: string };
  permissions: string[];
};

export type Project = {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  systemVersion?: string | null;
  status: "active" | "archived";
  settings?: Record<string, unknown>;
  createdAt: string;
};

export type Run = {
  id: string;
  projectId: string;
  agentDefId?: string | null;
  mode: string;
  engine: string;
  status:
    | "queued"
    | "provisioning"
    | "running"
    | "awaiting_human"
    | "succeeded"
    | "failed"
    | "canceled";
  trigger?: Record<string, unknown>;
  receipt?: {
    usage?: { input_tokens?: number; output_tokens?: number; cost_cents?: number };
  } | null;
  gh?: { issue?: string; pr?: string } | null;
  error?: string | null;
  queuedAt?: string;
  startedAt?: string | null;
  endedAt?: string | null;
};

export type RunEvent = {
  runId: string;
  seq: number;
  ts: string;
  type: string;
  data: Record<string, unknown>;
};

export type Proposal = {
  id: string;
  projectId?: string | null;
  runId?: string | null;
  actionType: string;
  payload: Record<string, unknown>;
  contextMd: string;
  state: "draft" | "open" | "approved" | "rejected" | "cancelled" | "expired";
  expiresAt?: string | null;
  createdAt: string;
};

export type AuditEvent = {
  seq: number;
  actor: { type: string; id: string; name?: string };
  action: string;
  target?: { type: string; id: string } | null;
  createdAt: string;
};

export type RegistryItem = {
  id: string;
  scope: "bundled" | "org" | "project";
  kind: string;
  name: string;
  description?: string | null;
  latestVersion: number;
};

export type Member = {
  userId: string;
  email: string;
  name?: string | null;
  roleId: string;
  roleName?: string;
};

export type Role = {
  id: string;
  orgId?: string | null;
  name: string;
  description?: string | null;
  permissions: string[];
};

export type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  last4: string;
  scopeType: "org" | "project";
  projectId?: string | null;
  createdAt: string;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
};

export type Provider = {
  id: string;
  provider: "anthropic" | "openai" | "byo";
  name: string;
  baseUrl?: string | null;
  createdAt: string;
};

export type Budget = {
  id: string;
  scope: "org" | "project" | "agent_def";
  projectId?: string | null;
  agentDefId?: string | null;
  period: "daily" | "weekly" | "monthly";
  limitCents: number;
  mode: "soft" | "hard";
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

export type SpendRow = { bucket: string; cost_cents: number };

// The control plane returns bare arrays for list endpoints (and {bucket,
// cost_cents} rows for spend). This client mirrors those shapes exactly.
export const api = {
  me: () => apiFetch<Principal>("/v1/me"),
  projects: () => apiFetch<Project[]>("/v1/projects"),
  project: (id: string) => apiFetch<Project>(`/v1/projects/${id}`),
  runs: (projectId: string, params = "") =>
    apiFetch<Run[]>(`/v1/projects/${projectId}/runs${params}`),
  run: (id: string) => apiFetch<Run>(`/v1/runs/${id}`),
  runEvents: (id: string, afterSeq = 0) =>
    apiFetch<RunEvent[]>(`/v1/runs/${id}/events?afterSeq=${afterSeq}`),
  inbox: () => apiFetch<Proposal[]>("/v1/inbox?state=open"),
  proposal: (id: string) => apiFetch<Proposal & { events?: unknown[] }>(`/v1/proposals/${id}`),
  audit: (params = "") => apiFetch<AuditEvent[]>(`/v1/audit${params}`),
  registry: (params = "") => apiFetch<RegistryItem[]>(`/v1/registry/items${params}`),
  spend: (params = "") => apiFetch<SpendRow[]>(`/v1/spend${params}`),
  members: () => apiFetch<Member[]>("/v1/members"),
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
