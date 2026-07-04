import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
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
  if (!config.s3Bucket) {
    return { putEnvelope: async () => null };
  }
  return {
    putEnvelope: async ({ orgId, requestId, payload, now }) => {
      const key = envelopeKey(orgId, now, requestId);
      const body = await gzipAsync(Buffer.from(JSON.stringify(payload)));
      const response = config.s3Endpoint
        ? await putEndpointObject(config, key, body)
        : await putAwsObject(config, key, body);
      if (!response.ok) {
        throw new Error(`S3 put failed with ${response.status}`);
      }
      return `s3://${config.s3Bucket}/${key}`;
    },
  };
}

async function putEndpointObject(config: GatewayConfig, key: string, body: Buffer) {
  const endpoint = config.s3Endpoint?.replace(/\/$/, "");
  const url = `${endpoint}/${config.s3Bucket}/${key}`;
  const headers: Record<string, string> = envelopeHeaders();
  if (config.s3AccessKey && config.s3SecretKey) {
    headers.authorization = `Basic ${Buffer.from(
      `${config.s3AccessKey}:${config.s3SecretKey}`,
    ).toString("base64")}`;
  }
  return fetch(url, { method: "PUT", headers, body });
}

async function putAwsObject(config: GatewayConfig, key: string, body: Buffer) {
  const region = config.awsRegion ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;
  if (!region) throw new Error("AWS_REGION is required for S3 envelope storage");
  const credentials = await awsCredentials(config);
  const host = `s3.${region}.amazonaws.com`;
  const path = `/${encodeS3Path(`${config.s3Bucket}/${key}`)}`;
  const url = `https://${host}${path}`;
  const headers = await signedAwsHeaders({
    method: "PUT",
    host,
    path,
    region,
    body,
    credentials,
  });
  return fetch(url, { method: "PUT", headers, body });
}

function envelopeHeaders() {
  return {
    "content-type": "application/json",
    "content-encoding": "gzip",
  };
}

type AwsCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
};

async function awsCredentials(config: GatewayConfig): Promise<AwsCredentials> {
  const envAccessKey = config.s3AccessKey ?? process.env.AWS_ACCESS_KEY_ID;
  const envSecretKey = config.s3SecretKey ?? process.env.AWS_SECRET_ACCESS_KEY;
  if (envAccessKey && envSecretKey) {
    return {
      accessKeyId: envAccessKey,
      secretAccessKey: envSecretKey,
      sessionToken: process.env.AWS_SESSION_TOKEN,
    };
  }
  const relativeUri = process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI;
  const fullUri = process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI;
  const credentialsUrl = fullUri ?? (relativeUri ? `http://169.254.170.2${relativeUri}` : null);
  if (!credentialsUrl) throw new Error("AWS credentials are required for S3 envelope storage");
  const headers: Record<string, string> = {};
  const tokenFile = process.env.AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE;
  if (tokenFile) {
    headers.authorization = (await readFile(tokenFile, "utf8")).trim();
  } else if (process.env.AWS_CONTAINER_AUTHORIZATION_TOKEN) {
    headers.authorization = process.env.AWS_CONTAINER_AUTHORIZATION_TOKEN;
  }
  const response = await fetch(credentialsUrl, { headers });
  if (!response.ok) throw new Error(`AWS credential lookup failed with ${response.status}`);
  const payload = (await response.json()) as {
    AccessKeyId?: string;
    SecretAccessKey?: string;
    Token?: string;
  };
  if (!payload.AccessKeyId || !payload.SecretAccessKey) {
    throw new Error("AWS credential lookup returned incomplete credentials");
  }
  return {
    accessKeyId: payload.AccessKeyId,
    secretAccessKey: payload.SecretAccessKey,
    sessionToken: payload.Token,
  };
}

async function signedAwsHeaders(input: {
  method: string;
  host: string;
  path: string;
  region: string;
  body: Buffer;
  credentials: AwsCredentials;
}) {
  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replaceAll("-", "");
  const amzDate = `${dateStamp}T${now.toISOString().slice(11, 19).replaceAll(":", "")}Z`;
  const payloadHash = sha256Hex(input.body);
  const headers: Record<string, string> = {
    ...envelopeHeaders(),
    host: input.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (input.credentials.sessionToken) {
    headers["x-amz-security-token"] = input.credentials.sessionToken;
  }
  const signedHeaderNames = Object.keys(headers)
    .map((header) => header.toLowerCase())
    .sort();
  const canonicalHeaders = signedHeaderNames
    .map((header) => `${header}:${headers[header]?.trim()}`)
    .join("\n");
  const signedHeaders = signedHeaderNames.join(";");
  const canonicalRequest = [
    input.method,
    input.path,
    "",
    `${canonicalHeaders}\n`,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const credentialScope = `${dateStamp}/${input.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signature = hmacHex(
    signingKey(input.credentials.secretAccessKey, dateStamp, input.region),
    stringToSign,
  );
  headers.authorization = [
    `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(", ");
  return headers;
}

function signingKey(secretAccessKey: string, dateStamp: string, region: string) {
  const dateKey = hmacBuffer(`AWS4${secretAccessKey}`, dateStamp);
  const regionKey = hmacBuffer(dateKey, region);
  const serviceKey = hmacBuffer(regionKey, "s3");
  return hmacBuffer(serviceKey, "aws4_request");
}

function hmacBuffer(key: string | Buffer, value: string) {
  return createHmac("sha256", key).update(value).digest();
}

function hmacHex(key: Buffer, value: string) {
  return createHmac("sha256", key).update(value).digest("hex");
}

function sha256Hex(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function encodeS3Path(path: string) {
  return path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function envelopeKey(orgId: string, now: Date, requestId: string): string {
  const yyyyMm = now.toISOString().slice(0, 7);
  return `envelopes/${orgId}/${yyyyMm}/${requestId}.json.gz`;
}

function envelopeUri(scheme: string, bucket: string, orgId: string, now: Date, requestId: string) {
  return `${scheme}://${bucket}/${envelopeKey(orgId, now, requestId)}`;
}
