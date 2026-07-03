import {
  ALL_PERMISSIONS,
  PERMISSION_RESOURCES
} from "./chunk-EQN3LRUS.js";

// src/roles.ts
var allReads = ALL_PERMISSIONS.filter((permission) => permission.endsWith(":read"));
var BUNDLED_ROLES = [
  {
    name: "owner",
    description: "Full organization control.",
    permissions: ["*"]
  },
  {
    name: "admin",
    description: "Administration across all platform resources.",
    permissions: PERMISSION_RESOURCES.map((resource) => `${resource}:*`)
  },
  {
    name: "maintainer",
    description: "Project maintainer with write access to execution resources.",
    permissions: [
      ...allReads,
      "projects:*",
      "repos:*",
      "registry:*",
      "registry:publish",
      "agents:*",
      "sandboxes:*",
      "runs:*",
      "runs:trigger",
      "runs:steer",
      "sessions:read",
      "keys:issue",
      "budgets:*",
      "hitl:*",
      "hitl:decide",
      "kb:*",
      "tasks:*",
      "issues:*",
      "projects:kickstart"
    ]
  },
  {
    name: "engineer",
    description: "Daily engineering access for runs, HITL, KB, and tasks.",
    permissions: [
      ...allReads,
      "runs:trigger",
      "runs:steer",
      "hitl:decide",
      "kb:write",
      "tasks:write"
    ]
  },
  {
    name: "viewer",
    description: "Read-only access.",
    permissions: allReads
  },
  {
    name: "agent",
    description: "Machine role with no base grants; attach explicit per-agent permissions.",
    permissions: []
  },
  {
    name: "finance",
    description: "Finance and audit visibility.",
    permissions: ["analytics:read", "spend:read", "budgets:read", "audit:read"]
  }
];

export {
  BUNDLED_ROLES
};
