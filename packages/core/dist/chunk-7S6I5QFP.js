import {
  newId
} from "./chunk-SDPVVMD4.js";

// src/crypto.ts
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { createRequire } from "module";
import argon2 from "argon2";
import { z } from "zod";
var require2 = createRequire(import.meta.url);
var sodium = require2("libsodium-wrappers-sumo");
var ConfirmationPayloadSchema = z.object({
  userId: z.string(),
  clientId: z.string(),
  toolName: z.string(),
  argsHash: z.string(),
  summary: z.string(),
  exp: z.number().int()
});
async function sodiumReady() {
  await sodium.ready;
  return sodium;
}
function masterKey(masterKeyB64) {
  const key = Buffer.from(masterKeyB64, "base64");
  if (key.length !== sodium.crypto_secretbox_KEYBYTES) {
    throw new Error("SECRET_MASTER_KEY must decode to 32 bytes");
  }
  return key;
}
async function seal(plaintext, masterKeyB64) {
  const s = await sodiumReady();
  const nonce = s.randombytes_buf(s.crypto_secretbox_NONCEBYTES);
  const cipher = s.crypto_secretbox_easy(plaintext, nonce, masterKey(masterKeyB64));
  return Buffer.concat([Buffer.from(nonce), Buffer.from(cipher)]).toString("base64");
}
async function open(sealed, masterKeyB64) {
  const s = await sodiumReady();
  const packed = Buffer.from(sealed, "base64");
  const nonce = packed.subarray(0, s.crypto_secretbox_NONCEBYTES);
  const cipher = packed.subarray(s.crypto_secretbox_NONCEBYTES);
  const plain = s.crypto_secretbox_open_easy(cipher, nonce, masterKey(masterKeyB64));
  return Buffer.from(plain).toString("utf8");
}
function hashKey(secret) {
  return argon2.hash(secret, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1
  });
}
function verifyKey(secret, hash) {
  return argon2.verify(hash, secret);
}
async function generateApiKey(prefix) {
  const secret = `${prefix}_${randomBytes(20).toString("hex")}`;
  return {
    id: newId(prefix === "fvk" ? "vkey" : "key"),
    secret,
    hash: await hashKey(secret),
    last4: secret.slice(-4)
  };
}
function b64url(input) {
  return Buffer.from(input).toString("base64url");
}
function sign(secret, body) {
  return createHmac("sha256", secret).update(body).digest("base64url");
}
function mintConfirmation(input) {
  const { secret, ttlMs = 3e5, ...rest } = input;
  const body = b64url(JSON.stringify({ ...rest, exp: Date.now() + ttlMs }));
  return `${body}.${sign(secret, body)}`;
}
function verifyConfirmation(token, secret) {
  const [body, mac] = token.split(".");
  if (!body || !mac) {
    return null;
  }
  const expected = sign(secret, body);
  const left = Buffer.from(mac);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return null;
  }
  const parsed = ConfirmationPayloadSchema.safeParse(
    JSON.parse(Buffer.from(body, "base64url").toString("utf8"))
  );
  if (!parsed.success || parsed.data.exp < Date.now()) {
    return null;
  }
  return parsed.data;
}

export {
  seal,
  open,
  hashKey,
  verifyKey,
  generateApiKey,
  mintConfirmation,
  verifyConfirmation
};
