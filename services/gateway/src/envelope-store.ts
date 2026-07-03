import { promisify } from "node:util";
import { gzip } from "node:zlib";
import type { EnvelopeStore, GatewayConfig } from "./types.js";

const gzipAsync = promisify(gzip);

export class MemoryEnvelopeStore implements EnvelopeStore {
  readonly objects = new Map<string, unknown>();

  async putEnvelope(input: {
    orgId: string;
    requestId: string;
    payload: unknown;
    now: Date;
  }): Promise<string> {
    const uri = envelopeUri("memory", "memory", input.orgId, input.now, input.requestId);
    this.objects.set(uri, input.payload);
    return uri;
  }
}

export function createEnvelopeStore(config: GatewayConfig): EnvelopeStore {
  if (!config.s3Bucket || !config.s3Endpoint) {
    return { putEnvelope: async () => null };
  }
  return {
    putEnvelope: async ({ orgId, requestId, payload, now }) => {
      const key = envelopeKey(orgId, now, requestId);
      const body = await gzipAsync(Buffer.from(JSON.stringify(payload)));
      const endpoint = config.s3Endpoint?.replace(/\/$/, "");
      const url = `${endpoint}/${config.s3Bucket}/${key}`;
      const headers: Record<string, string> = {
        "content-type": "application/json",
        "content-encoding": "gzip",
      };
      if (config.s3AccessKey && config.s3SecretKey) {
        headers.authorization = `Basic ${Buffer.from(
          `${config.s3AccessKey}:${config.s3SecretKey}`,
        ).toString("base64")}`;
      }
      const response = await fetch(url, { method: "PUT", headers, body });
      if (!response.ok) {
        throw new Error(`S3 put failed with ${response.status}`);
      }
      return `s3://${config.s3Bucket}/${key}`;
    },
  };
}

function envelopeKey(orgId: string, now: Date, requestId: string): string {
  const yyyyMm = now.toISOString().slice(0, 7);
  return `envelopes/${orgId}/${yyyyMm}/${requestId}.json.gz`;
}

function envelopeUri(scheme: string, bucket: string, orgId: string, now: Date, requestId: string) {
  return `${scheme}://${bucket}/${envelopeKey(orgId, now, requestId)}`;
}
