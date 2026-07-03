import {
  insertAuditEvent,
  verifyAuditChain
} from "./chunk-53YCTJUI.js";
import {
  migrate
} from "./chunk-6T63JJQ3.js";
import {
  actionTypes,
  agentDefs,
  apiKeys,
  auditEvents,
  budgets,
  bundleItems,
  bundles,
  githubInstallations,
  inboundEvents,
  integrations,
  kbEntries,
  kbLinks,
  kbSpaces,
  llmRequests,
  orgMembers,
  orgs,
  outcomes,
  platformIssues,
  poTasks,
  projects,
  proposalEvents,
  proposals,
  providerCredentials,
  registryItems,
  registryVersions,
  repos,
  roles,
  runEvents,
  runs,
  sandboxProfiles,
  schema_exports,
  spendCounters,
  steerMessages,
  users,
  virtualKeys
} from "./chunk-QDVSSDUU.js";
import {
  seed
} from "./chunk-AEY35NAG.js";
import "./chunk-MLKGABMK.js";

// src/index.ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

// src/scoped.ts
import { and, eq, gt, sql } from "drizzle-orm";
function withOrg(db, orgId) {
  return {
    projects: {
      list: (filters = {}) => db.select().from(projects).where(
        filters.status ? and(eq(projects.orgId, orgId), eq(projects.status, filters.status)) : eq(projects.orgId, orgId)
      ),
      byId: async (projectId) => (await db.select().from(projects).where(and(eq(projects.orgId, orgId), eq(projects.id, projectId))).limit(1))[0] ?? null
    },
    repos: {
      listForProject: (projectId) => db.select().from(repos).where(and(eq(repos.orgId, orgId), eq(repos.projectId, projectId))),
      byId: async (repoId) => (await db.select().from(repos).where(and(eq(repos.orgId, orgId), eq(repos.id, repoId))).limit(1))[0] ?? null
    },
    runs: {
      listForProject: (projectId, filters = {}) => db.select().from(runs).where(
        filters.status ? and(
          eq(runs.orgId, orgId),
          eq(runs.projectId, projectId),
          eq(runs.status, filters.status)
        ) : and(eq(runs.orgId, orgId), eq(runs.projectId, projectId))
      ),
      byId: async (runId) => (await db.select().from(runs).where(and(eq(runs.orgId, orgId), eq(runs.id, runId))).limit(1))[0] ?? null
    },
    runEvents: {
      listAfter: (runId, afterSeq = 0, limit = 100) => db.select().from(runEvents).where(
        and(
          eq(runEvents.orgId, orgId),
          eq(runEvents.runId, runId),
          gt(runEvents.seq, afterSeq)
        )
      ).orderBy(runEvents.seq).limit(limit)
    },
    llmRequests: {
      spendByDay: (from, to) => db.execute(sql`
          SELECT date_trunc('day', created_at)::date AS bucket, coalesce(sum(cost_cents), 0)::int AS cost_cents
          FROM llm_requests
          WHERE org_id = ${orgId} AND created_at >= ${from} AND created_at <= ${to}
          GROUP BY 1
          ORDER BY 1
        `)
    },
    auditEvents: {
      list: () => db.select().from(auditEvents).where(eq(auditEvents.orgId, orgId)).orderBy(auditEvents.seq)
    }
  };
}

// src/index.ts
function createDb(connectionString, options = {}) {
  const client = postgres(connectionString, { max: options.max ?? 10 });
  const db = drizzle(client, { schema: schema_exports });
  return { db, client, withOrg: (orgId) => withOrg(db, orgId) };
}
export {
  actionTypes,
  agentDefs,
  apiKeys,
  auditEvents,
  budgets,
  bundleItems,
  bundles,
  createDb,
  githubInstallations,
  inboundEvents,
  insertAuditEvent,
  integrations,
  kbEntries,
  kbLinks,
  kbSpaces,
  llmRequests,
  migrate,
  orgMembers,
  orgs,
  outcomes,
  platformIssues,
  poTasks,
  projects,
  proposalEvents,
  proposals,
  providerCredentials,
  registryItems,
  registryVersions,
  repos,
  roles,
  runEvents,
  runs,
  sandboxProfiles,
  seed,
  spendCounters,
  steerMessages,
  users,
  verifyAuditChain,
  virtualKeys,
  withOrg
};
