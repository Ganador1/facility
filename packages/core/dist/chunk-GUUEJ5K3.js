// src/fingerprints.ts
import { createHash } from "crypto";
function sha256Hex(content) {
  return createHash("sha256").update(content).digest("hex");
}
function manifestFor(files) {
  const manifestFiles = files.map((file) => ({ path: file.path, sha256: sha256Hex(file.content) })).sort((a, b) => a.path.localeCompare(b.path));
  const manifestHash = sha256Hex(JSON.stringify(manifestFiles));
  return { version: 1, files: manifestFiles, manifestHash };
}
function diffManifest(expected, actual, managedPaths = expected.files.map((file) => file.path)) {
  const expectedMap = new Map(expected.files.map((file) => [file.path, file.sha256]));
  const actualMap = new Map(actual.files.map((file) => [file.path, file.sha256]));
  const missing = [];
  const modified = [];
  const managed = new Set(managedPaths);
  for (const [path, hash] of expectedMap) {
    const actualHash = actualMap.get(path);
    if (!actualHash) {
      missing.push(path);
    } else if (actualHash !== hash) {
      modified.push(path);
    }
  }
  const extra = [...actualMap.keys()].filter((path) => !expectedMap.has(path) && managed.has(path));
  return { missing, modified, extra };
}

export {
  sha256Hex,
  manifestFor,
  diffManifest
};
