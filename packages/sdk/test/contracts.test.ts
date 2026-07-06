import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  CreateProjectRequest,
  FacilityRouteBody,
  FacilityRouteResponse,
  InboxResponse,
  Issue,
  JsonObject,
  Me,
  Project,
  QueryParams,
  RunWithProject,
  TriggerRunRequest,
} from "../src/index.js";
import { FacilityClient } from "../src/index.js";

type CapturedRequest = {
  url: string;
  method: string | undefined;
  headers: Headers;
  body: BodyInit | null | undefined;
  credentials: RequestCredentials | undefined;
};

type ClientFixtureOptions = {
  apiKey?: string;
  baseUrl?: string;
  payload?: unknown;
  status?: number;
};

function makeClient(options: ClientFixtureOptions = {}) {
  const requests: CapturedRequest[] = [];
  const payload = options.payload ?? { ok: true };
  const status = options.status ?? 200;
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push({
      url: input instanceof Request ? input.url : String(input),
      method: init?.method,
      headers: new Headers(init?.headers),
      body: init?.body,
      credentials: init?.credentials,
    });
    return Response.json(payload, { status });
  };

  return {
    client: new FacilityClient({
      baseUrl: options.baseUrl ?? "https://api.facility.test",
      apiKey: options.apiKey,
      fetch: fetchImpl,
    }),
    requests,
  };
}

function requestAt(requests: CapturedRequest[], index: number) {
  const request = requests[index];
  if (!request) throw new Error(`Expected request at index ${index}`);
  return request;
}

function requestLine(request: CapturedRequest) {
  const url = new URL(request.url);
  return `${request.method} ${url.pathname}${url.search}`;
}

describe("FacilityClient request behaviour", () => {
  it("builds GET URLs with defined query params and sends credentials without a body", async () => {
    const { client, requests } = makeClient({ payload: [{ id: "project-1" }] });

    const result = await client.get("/v1/projects", {
      status: "active",
      limit: 25,
      archived: false,
      omitted: undefined,
    });

    expect(result).toEqual([{ id: "project-1" }]);
    const request = requestAt(requests, 0);
    expect(request.url).toBe(
      "https://api.facility.test/v1/projects?status=active&limit=25&archived=false",
    );
    expect(request.method).toBe("GET");
    expect(request.body).toBeUndefined();
    expect(request.credentials).toBe("include");
    expect(request.headers.get("content-type")).toBeNull();
  });

  it("sets JSON headers and bodies only for POST and PATCH requests", async () => {
    const { client, requests } = makeClient();
    const createBody = {
      name: "Contract Project",
      slug: "contract-project",
      settings: { visibility: "internal" },
    } satisfies CreateProjectRequest;
    const patchBody = { status: "archived" };

    await client.post("/v1/projects", createBody);
    await client.patch("/v1/projects/project-1", patchBody);
    await client.delete("/v1/projects/project-1");
    await client.get("/v1/me");

    const post = requestAt(requests, 0);
    expect(post.method).toBe("POST");
    expect(post.body).toBe(JSON.stringify(createBody));
    expect(post.headers.get("content-type")).toBe("application/json");

    const patch = requestAt(requests, 1);
    expect(patch.method).toBe("PATCH");
    expect(patch.body).toBe(JSON.stringify(patchBody));
    expect(patch.headers.get("content-type")).toBe("application/json");

    const deleteRequest = requestAt(requests, 2);
    expect(deleteRequest.method).toBe("DELETE");
    expect(deleteRequest.body).toBeUndefined();
    expect(deleteRequest.headers.get("content-type")).toBeNull();

    const get = requestAt(requests, 3);
    expect(get.method).toBe("GET");
    expect(get.body).toBeUndefined();
    expect(get.headers.get("content-type")).toBeNull();
  });

  it("adds bearer authorization only when an api key is configured", async () => {
    const withKey = makeClient({ apiKey: "key_test_123" });
    await withKey.client.me();
    expect(requestAt(withKey.requests, 0).headers.get("authorization")).toBe("Bearer key_test_123");

    const withoutKey = makeClient();
    await withoutKey.client.me();
    expect(requestAt(withoutKey.requests, 0).headers.get("authorization")).toBeNull();
  });

  it("trims a trailing slash from baseUrl before appending paths", async () => {
    const { client, requests } = makeClient({ baseUrl: "https://api.facility.test/" });

    await client.me();

    expect(requestAt(requests, 0).url).toBe("https://api.facility.test/v1/me");
  });

  it("rejects non-2xx responses with the response error message and status", async () => {
    const { client } = makeClient({
      payload: { error: { message: "Project access denied" } },
      status: 403,
    });
    let thrown: unknown;

    try {
      await client.project("project-1");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe("Project access denied");
    expect((thrown as { status?: number }).status).toBe(403);
  });

  it("returns parsed 2xx JSON bodies without wrapping bare arrays", async () => {
    const payload = [{ id: "project-1" }, { id: "project-2" }];
    const { client } = makeClient({ payload });

    await expect(client.projects()).resolves.toEqual(payload);
  });

  it("issues expected methods and paths from representative convenience methods", async () => {
    const { client, requests } = makeClient();
    const createBody = { name: "Contract Project", slug: "contract-project" };
    const triggerBody = {
      mode: "manual",
      trigger: { source: "contract-test" },
    } satisfies TriggerRunRequest;
    const llmQuery: QueryParams = { limit: 10, cursor: "after-1", omitted: undefined };

    await client.me();
    await client.projects();
    await client.createProject(createBody);
    await client.project("project-1");
    await client.triggerRun("project-1", triggerBody);
    await client.run("run-1");
    await client.llmRequests(llmQuery);

    expect(requestLine(requestAt(requests, 0))).toBe("GET /v1/me");
    expect(requestLine(requestAt(requests, 1))).toBe("GET /v1/projects");
    expect(requestLine(requestAt(requests, 2))).toBe("POST /v1/projects");
    expect(requestAt(requests, 2).body).toBe(JSON.stringify(createBody));
    expect(requestLine(requestAt(requests, 3))).toBe("GET /v1/projects/project-1");
    expect(requestLine(requestAt(requests, 4))).toBe("POST /v1/projects/project-1/runs");
    expect(requestAt(requests, 4).body).toBe(JSON.stringify(triggerBody));
    expect(requestLine(requestAt(requests, 5))).toBe("GET /v1/runs/run-1");
    expect(requestLine(requestAt(requests, 6))).toBe(
      "GET /v1/llm-requests?limit=10&cursor=after-1",
    );
  });
});

describe("typed route contracts", () => {
  it("maps GET route responses to the exported resource types", () => {
    expectTypeOf<FacilityRouteResponse<"GET", "/v1/me">>().toEqualTypeOf<Me>();
    expectTypeOf<FacilityRouteResponse<"GET", "/v1/projects">>().toEqualTypeOf<Project[]>();
    expectTypeOf<FacilityRouteResponse<"GET", "/v1/runs">>().toEqualTypeOf<RunWithProject[]>();
    expectTypeOf<FacilityRouteResponse<"GET", "/v1/inbox">>().toEqualTypeOf<InboxResponse>();
    expectTypeOf<FacilityRouteResponse<"GET", "/v1/issues">>().toEqualTypeOf<Issue[]>();
    // Non-core surfaces now typed (permissive JsonObject, no cast needed).
    expectTypeOf<FacilityRouteResponse<"GET", "/v1/analytics">>().toEqualTypeOf<JsonObject[]>();
    expectTypeOf<
      FacilityRouteResponse<"POST", "/v1/projects/proj_1/tasks">
    >().toEqualTypeOf<JsonObject>();
    expectTypeOf<
      FacilityRouteResponse<"GET", "/v1/projects/proj_1/health">
    >().toEqualTypeOf<JsonObject>();
  });

  it("resolves a bare :id route but rejects a wrong nested path as never", () => {
    expectTypeOf<FacilityRouteResponse<"GET", "/v1/projects/proj_1">>().toEqualTypeOf<Project>();
    // The broad `/v1/projects/${string}` template admits `a/b`; the id guard
    // makes a wrong nested path resolve to `never` instead of the resource type.
    expectTypeOf<FacilityRouteResponse<"GET", "/v1/projects/proj_1/not-a-route">>().toBeNever();
    expectTypeOf<FacilityRouteResponse<"GET", "/v1/budgets/bud_1/nope">>().toBeNever();
  });

  it("maps route bodies and rejects invalid pairings at compile time", () => {
    expectTypeOf<FacilityRouteBody<"POST", "/v1/projects">>().toEqualTypeOf<CreateProjectRequest>();
    expectTypeOf<FacilityRouteBody<"GET", "/v1/me">>().toEqualTypeOf<never>();

    function acceptsProjectList(_projects: FacilityRouteResponse<"GET", "/v1/projects">) {}

    // @ts-expect-error Me is not assignable to the Project[] response for GET /v1/projects.
    acceptsProjectList({} as Me);
  });
});
