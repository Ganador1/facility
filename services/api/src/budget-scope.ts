import { ApiError } from "./errors.js";

export const BUDGET_SCOPES = ["org", "project", "agent_def"] as const;
export type BudgetScope = (typeof BUDGET_SCOPES)[number];

export type ResolvedBudgetScope = {
  scope: BudgetScope;
  projectId: string | null;
  agentDefId: string | null;
};

/**
 * The single source of truth for a budget's scope coherence + authorization,
 * applied by every write path (HTTP POST/PATCH and the HITL/MCP executor) so an
 * overbroad or unenforceable budget row can never be persisted:
 *
 *  - a project-scoped principal can never create/modify an ORG-wide budget (403);
 *  - `org` budgets are org-wide, so their projectId/agentDefId are nulled (this is
 *    also why widening to org strips the old project — otherwise a project owner
 *    could keep row-ownership of an org-wide budget);
 *  - `project` and `agent_def` budgets must name a project;
 *  - `agent_def` budgets must name an agent def (else the gateway silently ignores
 *    the row while it looks "configured").
 *
 * `principalProjectId` is the authorizing scope: null for an org-scoped principal
 * (may manage any scope) or a project id for a project-scoped principal / a
 * project-scoped HITL proposal (may only manage budgets within that project).
 */
export function resolveBudgetScope(input: {
  scope: string;
  projectId?: string | null;
  agentDefId?: string | null;
  principalProjectId: string | null;
}): ResolvedBudgetScope {
  if (!(BUDGET_SCOPES as readonly string[]).includes(input.scope)) {
    throw new ApiError(
      400,
      "invalid_budget_scope",
      `scope must be one of ${BUDGET_SCOPES.join(", ")}`,
    );
  }
  const scope = input.scope as BudgetScope;
  if (input.principalProjectId && scope === "org") {
    throw new ApiError(
      403,
      "forbidden_budget_scope",
      "A project-scoped principal cannot create or modify an org-wide budget",
    );
  }
  if (scope === "org") {
    return { scope, projectId: null, agentDefId: null };
  }
  const projectId = input.principalProjectId ?? input.projectId ?? null;
  if (!projectId) {
    throw new ApiError(
      400,
      "budget_project_required",
      "A project- or agent-scoped budget requires a projectId",
    );
  }
  if (scope === "agent_def" && !input.agentDefId) {
    throw new ApiError(
      400,
      "budget_agent_required",
      "An agent-scoped budget requires an agentDefId",
    );
  }
  return {
    scope,
    projectId,
    agentDefId: scope === "agent_def" ? (input.agentDefId ?? null) : null,
  };
}
