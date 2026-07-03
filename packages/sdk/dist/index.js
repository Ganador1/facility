// src/index.ts
var FacilityClient = class {
  baseUrl;
  apiKey;
  fetchImpl;
  constructor(options) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? fetch;
  }
  request(method, path, options = {}) {
    return this.send(method, path, options);
  }
  get(path, query) {
    return this.send("GET", path, { query });
  }
  post(path, body) {
    return this.send("POST", path, { body });
  }
  patch(path, body) {
    return this.send("PATCH", path, { body });
  }
  put(path, body) {
    return this.send("PUT", path, { body });
  }
  delete(path) {
    return this.send("DELETE", path);
  }
  stream(path, onEvent, query) {
    const controller = new AbortController();
    void this.openStream(path, onEvent, query, controller.signal);
    return controller;
  }
  async send(method, path, options = {}) {
    const response = await this.fetchImpl(this.url(path, options.query), {
      method,
      headers: this.headers(options.body !== void 0),
      body: options.body === void 0 ? void 0 : JSON.stringify(options.body),
      credentials: "include"
    });
    const payload = await response.json().catch(() => void 0);
    if (!response.ok) {
      throw Object.assign(
        new Error(payload?.error?.message ?? `Facility request failed: ${response.status}`),
        {
          status: response.status,
          payload
        }
      );
    }
    return payload;
  }
  async openStream(path, onEvent, query, signal) {
    const response = await this.fetchImpl(this.url(path, query), {
      headers: this.headers(false),
      credentials: "include",
      signal
    });
    if (!response.body) return;
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (; ; ) {
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
  headers(hasBody) {
    return {
      ...hasBody ? { "content-type": "application/json" } : {},
      ...this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}
    };
  }
  url(path, query) {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== void 0) url.searchParams.set(key, String(value));
    }
    return url;
  }
};
export {
  FacilityClient
};
