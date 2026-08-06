import { createHmac } from "node:crypto";

const CACHE_PARTITION_DOMAIN = "facility/codebuild-cache/v1";

// A cache partition is a capability, not an identifier. Derive it with the
// control-plane key so repository code cannot calculate another project's S3
// prefix from public organization/project ids.
export function sandboxCachePartition(secretMasterKey: string, orgId: string, projectId: string) {
  return createHmac("sha256", Buffer.from(secretMasterKey, "base64"))
    .update(CACHE_PARTITION_DOMAIN)
    .update("\0")
    .update(orgId)
    .update("\0")
    .update(projectId)
    .digest("hex");
}
