import { createHash, createHmac } from "node:crypto";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import { ApiError } from "./errors.js";
import type { AppConfig } from "./types.js";

const gunzipAsync = promisify(gunzip);
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

async function getAwsObject(config: AppConfig, ref: S3Ref) {
  const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;
  if (!region) throw new ApiError(500, "envelope_store_unconfigured", "AWS_REGION is required");
  const credentials = await awsCredentials(config);
  const host = `s3.${region}.amazonaws.com`;
  const path = `/${encodeS3Path(`${ref.bucket}/${ref.key}`)}`;
  const headers = signedAwsHeaders({ host, path, region, credentials });
  return fetch(`https://${host}${path}`, { method: "GET", headers });
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
  host: string;
  path: string;
  region: string;
  credentials: AwsCredentials;
}) {
  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replaceAll("-", "");
  const amzDate = `${dateStamp}T${now.toISOString().slice(11, 19).replaceAll(":", "")}Z`;
  const headers: Record<string, string> = {
    host: input.host,
    "x-amz-content-sha256": EMPTY_SHA256,
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
    "GET",
    input.path,
    "",
    `${canonicalHeaders}\n`,
    signedHeaders,
    EMPTY_SHA256,
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
