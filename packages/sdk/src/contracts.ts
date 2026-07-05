import type {
  apiKeys,
  auditEvents,
  budgets,
  llmRequests,
  orgMembers,
  orgs,
  projects,
  proposalEvents,
  proposals,
  providerCredentials,
  registryItems,
  registryVersions,
  repos,
  roles,
  runEvents,
  runs,
  users,
} from "@facility/db";

export type JsonObject = Record<string, unknown>;
export type QueryValue = string | number | boolean | undefined;
export type QueryParams = Record<string, QueryValue>;
export type RunReceipt = {
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cost_cents?: number;
  };
} & JsonObject;
export type RunGithubArtifacts = {
  issue?: string;
  pr?: string;
} & JsonObject;

type Serialized<T> = T extends Date
  ? string
  : T extends Date | null
    ? string | null
    : T extends Array<infer U>
      ? Serialized<U>[]
      : T extends object
        ? { [K in keyof T]: Serialized<T[K]> }
        : T;

type ProjectRow = typeof projects.$inferSelect;
type ProjectRepoRow = typeof repos.$inferSelect;
type RunRow = typeof runs.$inferSelect;
type RunEventRow = typeof runEvents.$inferSelect;
type ProposalRow = typeof proposals.$inferSelect;
type ProposalDecisionRow = typeof proposalEvents.$inferSelect;
type BudgetRow = typeof budgets.$inferSelect;
type RegistryItemRow = typeof registryItems.$inferSelect;
type RegistryVersionRow = typeof registryVersions.$inferSelect;
type OrgMemberRow = typeof orgMembers.$inferSelect;
type UserRow = typeof users.$inferSelect;
type RoleRow = typeof roles.$inferSelect;
type ApiKeyRow = typeof apiKeys.$inferSelect;
type ProviderRow = typeof providerCredentials.$inferSelect;
type AuditEventRow = typeof auditEvents.$inferSelect;
type LlmRequestRow = typeof llmRequests.$inferSelect;
type OrgRow = typeof orgs.$inferSelect;

export type ProjectStatus = "active" | "archived" | string;
export type RunStatus =
  | "queued"
  | "provisioning"
  | "running"
  | "awaiting_human"
  | "succeeded"
  | "failed"
  | "canceled"
  | string;
export type ProposalState =
  | "draft"
  | "open"
  | "approved"
  | "rejected"
  | "cancelled"
  | "expired"
  | string;

export type Org = Serialized<Omit<OrgRow, "settings">> & { settings: unknown };

export type Project = Serialized<Omit<ProjectRow, "settings" | "status">> & {
  settings: JsonObject;
  status: ProjectStatus;
};

export type ProjectRepo = Serialized<Omit<ProjectRepoRow, "fingerprint" | "renderAnswers">> & {
  fingerprint: unknown | null;
  renderAnswers: unknown | null;
};

export type Run = Serialized<
  Omit<RunRow, "trigger" | "sandbox" | "receipt" | "gh" | "createdBy" | "status">
> & {
  status: RunStatus;
  trigger: JsonObject;
  sandbox: JsonObject;
  receipt: RunReceipt | null;
  gh: RunGithubArtifacts;
  createdBy: unknown;
};

export type RunWithProject = Run & { project: Pick<Project, "id" | "name" | "slug"> };

export type RunEvent = Serialized<Omit<RunEventRow, "data">> & {
  data: JsonObject;
};

export type Proposal = Serialized<Omit<ProposalRow, "payload" | "state">> & {
  payload: JsonObject;
  state: ProposalState;
  actionType?: string;
};

export type ProposalDecision = Serialized<Omit<ProposalDecisionRow, "actor" | "data">> & {
  actor: unknown;
  data: unknown;
};

export type ProposalWithEvents = Proposal & { events: ProposalDecision[] };

export type Budget = Serialized<BudgetRow>;

export type RegistryItem = Serialized<RegistryItemRow>;
export type RegistryVersion = Serialized<RegistryVersionRow>;
export type RegistryItemWithVersions = RegistryItem & { versions: RegistryVersion[] };

export type Member = {
  userId: string;
  email: string;
  name?: string | null;
  roleId: string;
  roleName?: string;
};
export type MemberRow = {
  member: Serialized<OrgMemberRow>;
  user: Serialized<UserRow>;
  role: Role;
};

export type Role = Serialized<RoleRow>;

export type ApiKey = Serialized<Omit<ApiKeyRow, "hash">> & {
  secret?: string;
};

export type Provider = Serialized<
  Pick<ProviderRow, "id" | "provider" | "name" | "baseUrl" | "createdAt">
>;

export type AuditActor = { type: string; id: string; name?: string };
export type AuditTarget = { type: string; id: string } | null;
export type AuditEvent = Serialized<Omit<AuditEventRow, "actor" | "target" | "payload">> & {
  actor: AuditActor;
  target: AuditTarget;
  payload: unknown;
};

export type SpendRow = { bucket: string; cost_cents: number };

export type LlmRequest = Serialized<LlmRequestRow>;

export type Principal = {
  type: "user" | "key";
  id: string;
  orgId: string;
  userId?: string;
  email?: string;
  name?: string;
  projectId?: string | null;
  permissions: string[];
};

export type Me = {
  principal: Principal;
  org: Org | null;
  permissions: string[];
};

export type CreateProjectRequest = {
  name: string;
  slug: string;
  description?: string;
  settings?: JsonObject;
};
export type UpdateProjectRequest = Partial<
  Pick<Project, "name" | "description" | "status"> & { settings: JsonObject }
>;
export type ConnectProjectRepoRequest = {
  owner: string;
  name: string;
  defaultBranch?: string;
  mode?: "connect" | "create";
  create?: boolean;
  private?: boolean;
  description?: string;
  autoInit?: boolean;
};

export type TriggerRunRequest = {
  mode?: string;
  engine?: string;
  trigger?: JsonObject;
  agentDefId?: string;
  agent?: string;
};
export type SteerRunRequest = { body: string };

export type CreateProposalRequest = {
  projectId?: string;
  runId?: string;
  actionTypeId: string;
  payload: JsonObject;
  contextMd: string;
  expiresAt?: string;
};
export type DecideProposalRequest = { decision: "approve" | "reject"; note?: string };
export type McpToolProposalRequest = {
  toolName: string;
  permission: string;
  args: JsonObject;
  summary: string;
  projectId?: string;
  runId?: string;
};

export type CreateBudgetRequest = {
  scope: string;
  projectId?: string;
  agentDefId?: string;
  period: string;
  limitCents: number;
  mode: string;
  enabled?: boolean;
};
export type UpdateBudgetRequest = Partial<CreateBudgetRequest>;

export type CreateRegistryItemRequest = {
  scope: string;
  projectId?: string;
  kind: string;
  name: string;
  description?: string;
  content: string;
};
export type CreateRegistryVersionRequest = { content: string; changelog?: string };

export type AddMemberRequest = { email: string; roleId: string };
export type UpdateMemberRequest = { roleId: string };
export type CreateRoleRequest = { name: string; description?: string; permissions: string[] };
export type UpdateRoleRequest = { description?: string; permissions?: string[] };
export type CreateApiKeyRequest = { name: string; roleId: string; projectId?: string };
export type CreateProviderRequest = {
  provider: string;
  name: string;
  baseUrl?: string;
  secret: string;
};

export type InboxResponse = {
  items: Proposal[];
  proposals: Proposal[];
  issues: unknown[];
};
export type AuditTail = { items: AuditEvent[]; nextCursor: number | null };
export type LlmRequestPage = { items: LlmRequest[]; nextCursor: string | null };
export type LlmRequestEnvelope = { llmRequest: LlmRequest; envelope: unknown };

export type FacilityGetRoutes = {
  "/v1/me": Me;
  "/v1/projects": Project[];
  "/v1/runs": RunWithProject[];
  "/v1/inbox": InboxResponse;
  "/v1/audit": AuditTail;
  "/v1/registry/items": RegistryItem[];
  "/v1/spend": SpendRow[];
  "/v1/members": MemberRow[];
  "/v1/roles": Role[];
  "/v1/keys": ApiKey[];
  "/v1/providers": Provider[];
  "/v1/budgets": Budget[];
  "/v1/llm-requests": LlmRequestPage;
};

export type FacilityPostRoutes = {
  "/v1/projects": { body: CreateProjectRequest; response: Project };
  [path: `/v1/projects/${string}/repos`]: {
    body: ConnectProjectRepoRequest;
    response: ProjectRepo;
  };
  [path: `/v1/projects/${string}/runs`]: { body: TriggerRunRequest; response: Run };
  [path: `/v1/runs/${string}/cancel`]: { body: undefined; response: Run };
  [path: `/v1/runs/${string}/steer`]: { body: SteerRunRequest; response: unknown };
  "/v1/proposals": { body: CreateProposalRequest; response: Proposal };
  "/v1/mcp/tool-proposals": { body: McpToolProposalRequest; response: Proposal };
  [path: `/v1/proposals/${string}/decide`]: {
    body: DecideProposalRequest;
    response: Proposal;
  };
  "/v1/budgets": { body: CreateBudgetRequest; response: Budget };
  "/v1/registry/items": { body: CreateRegistryItemRequest; response: RegistryItemWithVersions };
  [path: `/v1/registry/items/${string}/versions`]: {
    body: CreateRegistryVersionRequest;
    response: RegistryVersion;
  };
  [path: `/v1/registry/versions/${string}/publish`]: { body: undefined; response: RegistryVersion };
  [path: `/v1/registry/versions/${string}/deprecate`]: {
    body: undefined;
    response: RegistryVersion;
  };
  "/v1/members": { body: AddMemberRequest; response: Serialized<OrgMemberRow> };
  "/v1/roles": { body: CreateRoleRequest; response: Role };
  "/v1/keys": { body: CreateApiKeyRequest; response: ApiKey };
  "/v1/providers": { body: CreateProviderRequest; response: Provider | null };
};

export type FacilityPatchRoutes = {
  [path: `/v1/projects/${string}`]: { body: UpdateProjectRequest; response: Project };
  [path: `/v1/budgets/${string}`]: { body: UpdateBudgetRequest; response: Budget };
  [path: `/v1/members/${string}`]: {
    body: UpdateMemberRequest;
    response: Serialized<OrgMemberRow>;
  };
  [path: `/v1/roles/${string}`]: { body: UpdateRoleRequest; response: Role };
};

export type FacilityDeleteRoutes = {
  [path: `/v1/projects/${string}`]: { ok: boolean };
  [path: `/v1/budgets/${string}`]: { ok: boolean };
  [path: `/v1/members/${string}`]: { ok: boolean };
  [path: `/v1/roles/${string}`]: { ok: boolean };
  [path: `/v1/keys/${string}`]: { ok: boolean };
  [path: `/v1/providers/${string}`]: { ok: boolean };
};

export type FacilityGetRouteResponse<Path extends string> = Path extends keyof FacilityGetRoutes
  ? FacilityGetRoutes[Path]
  : Path extends `/v1/projects/${string}/repos`
    ? ProjectRepo[]
    : Path extends `/v1/projects/${string}/runs`
      ? Run[]
      : Path extends `/v1/projects/${string}`
        ? Project
        : Path extends `/v1/runs/${string}/events`
          ? RunEvent[]
          : Path extends `/v1/runs/${string}`
            ? Run
            : Path extends `/v1/proposals/${string}`
              ? ProposalWithEvents
              : Path extends `/v1/registry/items/${string}`
                ? RegistryItemWithVersions
                : Path extends `/v1/budgets/${string}`
                  ? Budget
                  : Path extends `/v1/llm-requests/${string}/envelope`
                    ? LlmRequestEnvelope
                    : unknown;

export type FacilityRouteResponse<Method extends string, Path extends string> = Method extends "GET"
  ? FacilityGetRouteResponse<Path>
  : Method extends "POST"
    ? Path extends keyof FacilityPostRoutes
      ? FacilityPostRoutes[Path]["response"]
      : unknown
    : Method extends "PATCH"
      ? Path extends keyof FacilityPatchRoutes
        ? FacilityPatchRoutes[Path]["response"]
        : unknown
      : Method extends "DELETE"
        ? Path extends keyof FacilityDeleteRoutes
          ? FacilityDeleteRoutes[Path]
          : unknown
        : unknown;

export type FacilityRouteBody<Method extends string, Path extends string> = Method extends "POST"
  ? Path extends keyof FacilityPostRoutes
    ? FacilityPostRoutes[Path]["body"]
    : unknown
  : Method extends "PATCH"
    ? Path extends keyof FacilityPatchRoutes
      ? FacilityPatchRoutes[Path]["body"]
      : unknown
    : unknown;
