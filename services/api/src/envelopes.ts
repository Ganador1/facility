import { createHash, createHmac } from "node:crypto";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";
import { ApiError } from "./errors.js";
import type { AppConfig } from "./types.js";

const gunzipAsync = promisify(gunzip);
const gzipAsync = promisify(gzip);
const EMPTY_SHA256 = sha256Hex("");

type S3Ref = {
  bucket: string;
  key: string;
};

export async function readEnvelopeObject(config: AppConfig, uri: string | null | undefined) {
  if (!uri) throw new ApiError(404, "envelope_not_found", "Envelope not found");
  const ref = parseS3Uri(uri);
  if (!config.s3Bucket || ref.bucket !== config.s3Bucket) {
    throw new ApiError(404, "envelope_not_found", "Envelope not found");
  }
  const response = config.s3Endpoint
    ? await getEndpointObject(config, ref)
    : await getAwsObject(config, ref);
  if (response.status === 404) throw new ApiError(404, "envelope_not_found", "Envelope not found");
  if (!response.ok) {
    throw new ApiError(502, "envelope_read_failed", `Envelope store returned ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const body =
    response.headers.get("content-encoding") === "gzip" || ref.key.endsWith(".gz")
      ? await maybeGunzip(buffer)
      : buffer;
  return JSON.parse(body.toString("utf8")) as unknown;
}

export async function writeEnvelopeObject(input: {
  config: AppConfig;
  orgId: string;
  requestId: string;
  payload: unknown;
  now?: Date;
}) {
  if (!input.config.s3Bucket) {
    throw new ApiError(500, "envelope_store_unconfigured", "S3_BUCKET is required");
  }
  const key = envelopeKey(input.orgId, input.now ?? new Date(), input.requestId);
  const body = await gzipAsync(Buffer.from(JSON.stringify(input.payload)));
  const response = input.config.s3Endpoint
    ? await putEndpointObject(input.config, key, body)
    : await putAwsObject(input.config, key, body);
  if (!response.ok) {
    throw new ApiError(502, "envelope_write_failed", `Envelope store returned ${response.status}`);
  }
  return `s3://${input.config.s3Bucket}/${key}`;
}

export async function verifyEnvelopeRoundTrip(input: {
  config: AppConfig;
  orgId: string;
  requestId: string;
  payload: unknown;
  now?: Date;
}) {
  const uri = await writeEnvelopeObject(input);
  const loaded = await readEnvelopeObject(input.config, uri);
  return { uri, loaded };
}

async function maybeGunzip(buffer: Buffer) {
  try {
    return await gunzipAsync(buffer);
  } catch {
    return buffer;
  }
}

function parseS3Uri(uri: string): S3Ref {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new ApiError(404, "envelope_not_found", "Envelope not found");
  }
  if (parsed.protocol !== "s3:" || !parsed.hostname) {
    throw new ApiError(404, "envelope_not_found", "Envelope not found");
  }
  return { bucket: parsed.hostname, key: parsed.pathname.replace(/^\/+/, "") };
}

async function getEndpointObject(config: AppConfig, ref: S3Ref) {
  const endpoint = config.s3Endpoint?.replace(/\/$/, "");
  const url = `${endpoint}/${ref.bucket}/${encodeS3Path(ref.key)}`;
  const headers: Record<string, string> = {};
  if (config.s3AccessKey && config.s3SecretKey) {
    headers.authorization = `Basic ${Buffer.from(
      `${config.s3AccessKey}:${config.s3SecretKey}`,
    ).toString("base64")}`;
  }
  return fetch(url, { method: "GET", headers });
}

async function putEndpointObject(config: AppConfig, key: string, body: Buffer) {
  const endpoint = config.s3Endpoint?.replace(/\/$/, "");
  const url = `${endpoint}/${config.s3Bucket}/${encodeS3Path(key)}`;
  const headers: Record<string, string> = envelopeHeaders();
  if (config.s3AccessKey && config.s3SecretKey) {
    headers.authorization = `Basic ${Buffer.from(
      `${config.s3AccessKey}:${config.s3SecretKey}`,
    ).toString("base64")}`;
  }
  return fetch(url, { method: "PUT", headers, body });
}

async function getAwsObject(config: AppConfig, ref: S3Ref) {
  const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;
  if (!region) throw new ApiError(500, "envelope_store_unconfigured", "AWS_REGION is required");
  const credentials = await awsCredentials(config);
  const host = `s3.${region}.amazonaws.com`;
  const path = `/${encodeS3Path(`${ref.bucket}/${ref.key}`)}`;
  const headers = signedAwsHeaders({ host, path, region, credentials });
  return fetch(`https://${host}${path}`, { method: "GET", headers });
}

async function putAwsObject(config: AppConfig, key: string, body: Buffer) {
  const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;
  if (!region) throw new ApiError(500, "envelope_store_unconfigured", "AWS_REGION is required");
  const credentials = await awsCredentials(config);
  const host = `s3.${region}.amazonaws.com`;
  const path = `/${encodeS3Path(`${config.s3Bucket}/${key}`)}`;
  const headers = signedAwsHeaders({ method: "PUT", host, path, region, body, credentials });
  return fetch(`https://${host}${path}`, { method: "PUT", headers, body });
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

async function awsCredentials(config: AppConfig): Promise<AwsCredentials> {
  const envAccessKey = config.s3AccessKey ?? process.env.AWS_ACCESS_KEY_ID;
  const envSecretKey = config.s3SecretKey ?? process.env.AWS_SECRET_ACCESS_KEY;
  if (envAccessKey && envSecretKey) {
    return {
      accessKeyId: envAccessKey,
      secretAccessKey: envSecretKey,
      sessionToken: process.env.AWS_SESSION_TOKEN,
    };
  }
  throw new ApiError(500, "envelope_store_unconfigured", "AWS credentials are required");
}

function signedAwsHeaders(input: {
  method?: string;
  host: string;
  path: string;
  region: string;
  body?: Buffer;
  credentials: AwsCredentials;
}) {
  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replaceAll("-", "");
  const amzDate = `${dateStamp}T${now.toISOString().slice(11, 19).replaceAll(":", "")}Z`;
  const payloadHash = input.body ? sha256Hex(input.body) : EMPTY_SHA256;
  const headers: Record<string, string> = {
    ...(input.body ? envelopeHeaders() : {}),
    host: input.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (input.credentials.sessionToken)
    headers["x-amz-security-token"] = input.credentials.sessionToken;
  const signedHeaderNames = Object.keys(headers)
    .map((header) => header.toLowerCase())
    .sort();
  const canonicalHeaders = signedHeaderNames
    .map((header) => `${header}:${headers[header]?.trim()}`)
    .join("\n");
  const signedHeaders = signedHeaderNames.join(";");
  const canonicalRequest = [
    input.method ?? "GET",
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
