import { describe, expect, it } from "vitest";
import { sandboxCachePartition } from "../src/sandbox/cache.js";

const firstKey = Buffer.alloc(32, 1).toString("base64");
const secondKey = Buffer.alloc(32, 2).toString("base64");

describe("sandbox cache partition", () => {
  it("is stable only inside one master-key, organization, and project boundary", () => {
    const partition = sandboxCachePartition(firstKey, "org_alpha", "proj_one");

    expect(partition).toMatch(/^[a-f0-9]{64}$/);
    expect(sandboxCachePartition(firstKey, "org_alpha", "proj_one")).toBe(partition);
    expect(sandboxCachePartition(firstKey, "org_beta", "proj_one")).not.toBe(partition);
    expect(sandboxCachePartition(firstKey, "org_alpha", "proj_two")).not.toBe(partition);
    expect(sandboxCachePartition(secondKey, "org_alpha", "proj_one")).not.toBe(partition);
  });

  it("uses unambiguous domain-separated input without exposing tenant ids", () => {
    const left = sandboxCachePartition(firstKey, "a", "bc");
    const right = sandboxCachePartition(firstKey, "ab", "c");
    const orgId = "org_PUBLIC-TENANT-ALPHA";
    const projectId = "proj_PUBLIC-PROJECT-ONE";
    const opaque = sandboxCachePartition(firstKey, orgId, projectId);

    expect(left).not.toBe(right);
    expect(opaque).not.toContain(orgId);
    expect(opaque).not.toContain(projectId);
  });
});
