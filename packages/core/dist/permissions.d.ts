import { z } from 'zod';

declare const PERMISSION_RESOURCES: readonly ["org", "members", "roles", "projects", "repos", "registry", "agents", "sandboxes", "runs", "sessions", "keys", "providers", "budgets", "spend", "hitl", "kb", "tasks", "issues", "analytics", "audit", "integrations", "settings"];
declare const SPECIAL_PERMISSIONS: readonly ["runs:trigger", "runs:steer", "sessions:read", "hitl:decide", "keys:issue", "audit:read", "registry:publish", "projects:kickstart"];
declare const ALL_PERMISSIONS: ("org:read" | "kb:read" | "members:read" | "roles:read" | "projects:read" | "repos:read" | "registry:read" | "agents:read" | "sandboxes:read" | "runs:read" | "sessions:read" | "keys:read" | "providers:read" | "budgets:read" | "spend:read" | "hitl:read" | "tasks:read" | "issues:read" | "analytics:read" | "audit:read" | "integrations:read" | "settings:read" | "org:write" | "kb:write" | "members:write" | "roles:write" | "projects:write" | "repos:write" | "registry:write" | "agents:write" | "sandboxes:write" | "runs:write" | "sessions:write" | "keys:write" | "providers:write" | "budgets:write" | "spend:write" | "hitl:write" | "tasks:write" | "issues:write" | "analytics:write" | "audit:write" | "integrations:write" | "settings:write" | "runs:trigger" | "runs:steer" | "hitl:decide" | "keys:issue" | "registry:publish" | "projects:kickstart")[];
type Permission = (typeof ALL_PERMISSIONS)[number];
declare const PermissionSchema: z.ZodString;
declare function can(grants: readonly string[], needed: string): boolean;

export { ALL_PERMISSIONS, PERMISSION_RESOURCES, type Permission, PermissionSchema, SPECIAL_PERMISSIONS, can };
