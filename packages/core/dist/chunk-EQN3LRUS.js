// src/permissions.ts
import { z } from "zod";
var PERMISSION_RESOURCES = [
  "org",
  "members",
  "roles",
  "projects",
  "repos",
  "registry",
  "agents",
  "sandboxes",
  "runs",
  "sessions",
  "keys",
  "providers",
  "budgets",
  "spend",
  "hitl",
  "kb",
  "tasks",
  "issues",
  "analytics",
  "audit",
  "integrations",
  "settings"
];
var basePermissions = PERMISSION_RESOURCES.flatMap(
  (resource) => [`${resource}:read`, `${resource}:write`]
);
var SPECIAL_PERMISSIONS = [
  "runs:trigger",
  "runs:steer",
  "sessions:read",
  "hitl:decide",
  "keys:issue",
  "audit:read",
  "registry:publish",
  "projects:kickstart"
];
var ALL_PERMISSIONS = [.../* @__PURE__ */ new Set([...basePermissions, ...SPECIAL_PERMISSIONS])].sort();
var PermissionSchema = z.string().refine(
  (value) => ALL_PERMISSIONS.includes(value) || value === "*" || /^[a-z]+:\*$/.test(value),
  "unknown permission"
);
function can(grants, needed) {
  if (grants.includes("*")) {
    return true;
  }
  if (grants.includes(needed)) {
    return true;
  }
  const [resource] = needed.split(":");
  return Boolean(resource && grants.includes(`${resource}:*`));
}

export {
  PERMISSION_RESOURCES,
  SPECIAL_PERMISSIONS,
  ALL_PERMISSIONS,
  PermissionSchema,
  can
};
