import type {
  AuditTail,
  Budget,
  ConnectProjectRepoRequest,
  CreateBudgetRequest,
  CreateProjectRequest,
  CreateRegistryItemRequest,
  DecideProposalRequest,
  FacilityRouteBody,
  FacilityRouteMethod,
  FacilityRoutePath,
  FacilityRouteResponse,
  InboxResponse,
  LlmRequestPage,
  Me,
  Project,
  ProjectRepo,
  Proposal,
  ProposalWithEvents,
  QueryParams,
  RegistryItem,
  RegistryItemWithVersions,
  Run,
  RunEvent,
  RunWithProject,
  SpendRow,
  SteerRunRequest,
  TriggerRunRequest,
  UpdateBudgetRequest,
  UpdateProjectRequest,
} from "./contracts.js";

export type * from "./contracts.js";

type RouteOptions<Method extends FacilityRouteMethod, Path extends FacilityRoutePath<Method>> = {
  body?: FacilityRouteBody<Method, Path>;
  query?: QueryParams;
};

export type FacilityClientOptions = {
  baseUrl: string;
  apiKey?: string;
  fetch?: typeof fetch;
};

export class FacilityClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: FacilityClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? fetch;
  }

  request<Method extends FacilityRouteMethod, Path extends FacilityRoutePath<Method>>(
    method: Method,
    path: Path,
    options: RouteOptions<Method, Path> = {},
  ): Promise<FacilityRouteResponse<Method, Path>> {
    return this.send(method, path, options);
  }

  get<Path extends FacilityRoutePath<"GET">>(path: Path, query?: QueryParams) {
    return this.send<undefined, FacilityRouteResponse<"GET", Path>>("GET", path, { query });
  }

  post<Path extends FacilityRoutePath<"POST">>(path: Path, body?: FacilityRouteBody<"POST", Path>) {
    return this.send<FacilityRouteBody<"POST", Path>, FacilityRouteResponse<"POST", Path>>(
      "POST",
      path,
      { body },
    );
  }

  patch<Path extends FacilityRoutePath<"PATCH">>(
    path: Path,
    body: FacilityRouteBody<"PATCH", Path>,
  ) {
    return this.send<FacilityRouteBody<"PATCH", Path>, FacilityRouteResponse<"PATCH", Path>>(
      "PATCH",
      path,
      { body },
    );
  }

  delete<Path extends FacilityRoutePath<"DELETE">>(path: Path) {
    return this.send<undefined, FacilityRouteResponse<"DELETE", Path>>("DELETE", path);
  }

  stream<Path extends string>(
    path: Path,
    onEvent: (event: { event: string; data: unknown }) => void,
    query?: QueryParams,
  ): AbortController {
    const controller = new AbortController();
    void this.openStream(path, onEvent, query, controller.signal);
    return controller;
  }

  me(): Promise<Me> {
    return this.get("/v1/me");
  }

  projects(query?: { status?: string }): Promise<Project[]> {
    return this.get("/v1/projects", query);
  }

  createProject(body: CreateProjectRequest): Promise<Project> {
    return this.post("/v1/projects", body);
  }

  project(projectId: string): Promise<Project> {
    return this.get(`/v1/projects/${projectId}`);
  }

  updateProject(projectId: string, body: UpdateProjectRequest): Promise<Project> {
    return this.patch(`/v1/projects/${projectId}`, body);
  }

  projectRepos(projectId: string): Promise<ProjectRepo[]> {
    return this.get(`/v1/projects/${projectId}/repos`);
  }

  connectProjectRepo(projectId: string, body: ConnectProjectRepoRequest): Promise<ProjectRepo> {
    return this.post(`/v1/projects/${projectId}/repos`, body);
  }

  runs(
    projectId: string,
    query?: { status?: string; limit?: number; offset?: number },
  ): Promise<Run[]> {
    return this.get(`/v1/projects/${projectId}/runs`, query);
  }

  allRuns(query?: { status?: string; limit?: number; offset?: number }): Promise<RunWithProject[]> {
    return this.get("/v1/runs", query);
  }

  triggerRun(projectId: string, body: TriggerRunRequest): Promise<Run> {
    return this.post(`/v1/projects/${projectId}/runs`, body);
  }

  run(runId: string): Promise<Run> {
    return this.get(`/v1/runs/${runId}`);
  }

  runEvents(runId: string, query?: { afterSeq?: number }): Promise<RunEvent[]> {
    return this.get(`/v1/runs/${runId}/events`, query);
  }

  cancelRun(runId: string): Promise<Run> {
    return this.post(`/v1/runs/${runId}/cancel`);
  }

  steerRun(runId: string, body: SteerRunRequest): Promise<unknown> {
    return this.post(`/v1/runs/${runId}/steer`, body);
  }

  inbox(query?: { state?: string }): Promise<InboxResponse> {
    return this.get("/v1/inbox", query);
  }

  proposal(proposalId: string): Promise<ProposalWithEvents> {
    return this.get(`/v1/proposals/${proposalId}`);
  }

  decideProposal(proposalId: string, body: DecideProposalRequest): Promise<Proposal> {
    return this.post(`/v1/proposals/${proposalId}/decide`, body);
  }

  audit(query?: QueryParams): Promise<AuditTail> {
    return this.get("/v1/audit", query);
  }

  registryItems(query?: {
    kind?: string;
    scope?: string;
    projectId?: string;
  }): Promise<RegistryItem[]> {
    return this.get("/v1/registry/items", query);
  }

  registryItem(itemId: string): Promise<RegistryItemWithVersions> {
    return this.get(`/v1/registry/items/${itemId}`);
  }

  createRegistryItem(body: CreateRegistryItemRequest): Promise<RegistryItemWithVersions> {
    return this.post("/v1/registry/items", body);
  }

  spend(query?: QueryParams): Promise<SpendRow[]> {
    return this.get("/v1/spend", query);
  }

  budgets(): Promise<Budget[]> {
    return this.get("/v1/budgets");
  }

  createBudget(body: CreateBudgetRequest): Promise<Budget> {
    return this.post("/v1/budgets", body);
  }

  updateBudget(budgetId: string, body: UpdateBudgetRequest): Promise<Budget> {
    return this.patch(`/v1/budgets/${budgetId}`, body);
  }

  llmRequests(query?: QueryParams): Promise<LlmRequestPage> {
    return this.get("/v1/llm-requests", query);
  }

  private async send<Body, Response>(
    method: FacilityRouteMethod,
    path: string,
    options: { body?: Body; query?: QueryParams } = {},
  ): Promise<Response> {
    const response = await this.fetchImpl(this.url(path, options.query), {
      method,
      headers: this.headers(options.body !== undefined),
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: "include",
    });
    const payload = (await response.json().catch(() => undefined)) as
      | { error?: { message?: string } }
      | undefined;
    if (!response.ok) {
      throw Object.assign(
        new Error(payload?.error?.message ?? `Facility request failed: ${response.status}`),
        {
          status: response.status,
          payload,
        },
      );
    }
    return payload as Response;
  }

  private async openStream(
    path: string,
    onEvent: (event: { event: string; data: unknown }) => void,
    query: QueryParams | undefined,
    signal: AbortSignal,
  ) {
    const response = await this.fetchImpl(this.url(path, query), {
      headers: this.headers(false),
      credentials: "include",
      signal,
    });
    if (!response.body) return;
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";
      for (const chunk of chunks) {
        const event = chunk.match(/^event: (.+)$/m)?.[1] ?? "message";
        const dataText = chunk.match(/^data: (.+)$/m)?.[1] ?? "null";
        onEvent({ event, data: JSON.parse(dataText) });
      }
    }
  }

  private headers(hasBody: boolean) {
    return {
      ...(hasBody ? { "content-type": "application/json" } : {}),
      ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
    };
  }

  private url(path: string, query?: QueryParams) {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url;
  }
}
