type BundledRoleName = "owner" | "admin" | "maintainer" | "engineer" | "viewer" | "agent" | "finance";
type BundledRole = {
    name: BundledRoleName;
    description: string;
    permissions: string[];
};
declare const BUNDLED_ROLES: ({
    name: "owner";
    description: string;
    permissions: string[];
} | {
    name: "admin";
    description: string;
    permissions: string[];
} | {
    name: "maintainer";
    description: string;
    permissions: string[];
} | {
    name: "engineer";
    description: string;
    permissions: string[];
} | {
    name: "viewer";
    description: string;
    permissions: ("org:read" | "kb:read" | "members:read" | "roles:read" | "projects:read" | "repos:read" | "registry:read" | "agents:read" | "sandboxes:read" | "runs:read" | "sessions:read" | "keys:read" | "providers:read" | "budgets:read" | "spend:read" | "hitl:read" | "tasks:read" | "issues:read" | "analytics:read" | "audit:read" | "integrations:read" | "settings:read" | "org:write" | "kb:write" | "members:write" | "roles:write" | "projects:write" | "repos:write" | "registry:write" | "agents:write" | "sandboxes:write" | "runs:write" | "sessions:write" | "keys:write" | "providers:write" | "budgets:write" | "spend:write" | "hitl:write" | "tasks:write" | "issues:write" | "analytics:write" | "audit:write" | "integrations:write" | "settings:write" | "runs:trigger" | "runs:steer" | "hitl:decide" | "keys:issue" | "registry:publish" | "projects:kickstart")[];
} | {
    name: "agent";
    description: string;
    permissions: never[];
} | {
    name: "finance";
    description: string;
    permissions: string[];
})[];

export { BUNDLED_ROLES, type BundledRole, type BundledRoleName };
