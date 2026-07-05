import { can, PermissionSchema, validateProviderBaseUrl } from "@facility/core";
import { projects, roles } from "@facility/db";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ApiError, notFound } from "../../errors.js";
import type { AppConfig, Principal } from "../../types.js";

export type V1RouteContext = {
  db: FastifyInstance["facilityDb"];
  config: AppConfig;
};

export const AnyObject = z.record(z.string(), z.unknown());
export const Ok = z.object({ ok: z.boolean() });
export const IdParams = z.object({
  projectId: z.string().optional(),
  runId: z.string().optional(),
  itemId: z.string().optional(),
  versionId: z.string().optional(),
  proposalId: z.string().optional(),
  entryId: z.string().optional(),
  taskId: z.string().optional(),
  issueId: z.string().optional(),
  keyId: z.string().optional(),
  userId: z.string().optional(),
  roleId: z.string().optional(),
});

export function principal(request: { principal?: Principal }) {
  if (!request.principal) throw new ApiError(401, "unauthorized", "Authentication required");
  return request.principal;
}

export function publicRow<T extends Record<string, unknown>>(row: T) {
  const { hash: _hash, sealedSecret: _sealedSecret, sealed_secret: _sealedSecret2, ...rest } = row;
  return rest;
}

export async function validateApiProviderBaseUrl(value: string, allowLocalhostHttp: boolean) {
  try {
    return await validateProviderBaseUrl(value, { allowLocalhostHttp });
  } catch (error) {
    throw new ApiError(
      400,
      "invalid_provider_base_url",
      error instanceof Error ? error.message : "Invalid provider base URL",
    );
  }
}

export function assertProjectScope(p: Principal, projectId: string | null | undefined) {
  if (projectId && p.projectId && p.projectId !== projectId) {
    throw new ApiError(404, "not_found", "Project not found");
  }
}

export async function assertProjectInOrg(
  db: FastifyInstance["facilityDb"],
  p: Principal,
  projectId: string | null | undefined,
  statusCode = 400,
) {
  assertProjectScope(p, projectId);
  if (!projectId) return;
  const project = (
    await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.orgId, p.orgId), eq(projects.id, projectId)))
      .limit(1)
  )[0];
  if (!project) {
    throw new ApiError(
      statusCode,
      statusCode === 404 ? "not_found" : "project_not_in_org",
      "Project not found",
    );
  }
}

export function assertBareRowProjectScope(
  p: Principal,
  projectId: string | null | undefined,
  message: string,
) {
  if (p.projectId && projectId !== p.projectId) {
    throw notFound(message);
  }
}

export async function assertRoleAssignable(
  dbx: FastifyInstance["facilityDb"],
  p: Principal,
  roleId: string,
) {
  const role = (await dbx.select().from(roles).where(eq(roles.id, roleId)).limit(1))[0];
  if (!role) throw new ApiError(400, "invalid_role", "Role does not exist");
  if (role.orgId && role.orgId !== p.orgId) {
    throw new ApiError(403, "role_not_in_org", "Role is not in this organization");
  }
  for (const permission of role.permissions) {
    if (!can(p.permissions, permission)) {
      throw new ApiError(
        403,
        "privilege_escalation",
        "Cannot issue a key more privileged than yourself",
      );
    }
  }
  return role;
}

// A principal may never grant a permission it does not itself hold, nor an
// unknown permission string. This is the same "no privilege escalation" rule
// assertRoleAssignable enforces for roles, applied to raw permission arrays.
export function assertPermissionsGrantable(p: Principal, permissions: string[]) {
  for (const permission of permissions) {
    if (!PermissionSchema.safeParse(permission).success) {
      throw new ApiError(400, "invalid_permission", `Unknown permission: ${permission}`);
    }
    if (!can(p.permissions, permission)) {
      throw new ApiError(
        403,
        "privilege_escalation",
        `Cannot grant a permission you do not hold: ${permission}`,
      );
    }
  }
}

export function definedFields<T extends Record<string, unknown>>(fields: T) {
  return Object.fromEntries(
    Object.entries(fields).filter((entry): entry is [string, unknown] => entry[1] !== undefined),
  );
}

export function bearer(value: string | undefined) {
  if (!value?.startsWith("Bearer ")) return null;
  return value.slice("Bearer ".length);
}

export function objectOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
