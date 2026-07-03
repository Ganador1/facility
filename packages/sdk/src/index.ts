import type { paths } from "./schema.js";

type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

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

  request<Path extends keyof paths & string, Body = unknown, Response = unknown>(
    method: HttpMethod,
    path: Path,
    options: { body?: Body; query?: Record<string, string | number | boolean | undefined> } = {},
  ): Promise<Response> {
    return this.send(method, path, options);
  }

  get<Path extends keyof paths & string, Response = unknown>(
    path: Path,
    query?: Record<string, string | number | boolean | undefined>,
  ) {
    return this.send<undefined, Response>("GET", path, { query });
  }

  post<Path extends keyof paths & string, Body = unknown, Response = unknown>(
    path: Path,
    body: Body,
  ) {
    return this.send<Body, Response>("POST", path, { body });
  }

  patch<Path extends keyof paths & string, Body = unknown, Response = unknown>(
    path: Path,
    body: Body,
  ) {
    return this.send<Body, Response>("PATCH", path, { body });
  }

  put<Path extends keyof paths & string, Body = unknown, Response = unknown>(
    path: Path,
    body: Body,
  ) {
    return this.send<Body, Response>("PUT", path, { body });
  }

  delete<Path extends keyof paths & string, Response = unknown>(path: Path) {
    return this.send<undefined, Response>("DELETE", path);
  }

  stream<Path extends keyof paths & string>(
    path: Path,
    onEvent: (event: { event: string; data: unknown }) => void,
    query?: Record<string, string | number | boolean | undefined>,
  ): AbortController {
    const controller = new AbortController();
    void this.openStream(path, onEvent, query, controller.signal);
    return controller;
  }

  private async send<Body, Response>(
    method: HttpMethod,
    path: string,
    options: { body?: Body; query?: Record<string, string | number | boolean | undefined> } = {},
  ): Promise<Response> {
    const response = await this.fetchImpl(this.url(path, options.query), {
      method,
      headers: this.headers(options.body !== undefined),
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: "include",
    });
    const payload = await response.json().catch(() => undefined);
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
    query: Record<string, string | number | boolean | undefined> | undefined,
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

  private url(path: string, query?: Record<string, string | number | boolean | undefined>) {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url;
  }
}
