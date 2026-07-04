import { createHash } from "node:crypto";
import { newId } from "@facility/core";
import type { createDb } from "@facility/db";
import {
  actionTypes,
  githubInstallations,
  kbEntries,
  kbLinks,
  kbSpaces,
  platformIssues,
  poTasks,
  proposalEvents,
  proposals,
  registryItems,
  registryVersions,
  repos,
} from "@facility/db";
import { artifactIdFor, validate } from "@facility/harness";
import { and, desc, eq } from "drizzle-orm";
import {
  createGithubClientFactory,
  FacilityGithubClient,
  type GithubClientFactory,
} from "./github/client.js";
import {
  ensureActive,
  ensureLinks,
  loadKbGraph,
  normalizeKbDraft,
  toHarnessEntry,
  toHarnessSpace,
} from "./harness.js";
import type { AppConfig } from "./types.js";

type Db = ReturnType<typeof createDb>["db"];

export type GitHubIssueClient = {
  createIssue(input: {
    repo: { owner: string; name: string };
    title: string;
    body: string;
    labels: string[];
  }): Promise<{ number: number; url: string }>;
  addToBoard?(input: { org: string; number: number; issueUrl: string }): Promise<void>;
};

export function mockGitHubIssueClient(): GitHubIssueClient {
  return {
    async createIssue(input) {
      const digest = createHash("sha256")
        .update(`${input.repo.owner}/${input.repo.name}:${input.title}:${input.body}`)
        .digest("hex")
        .slice(0, 6);
      const number = Number.parseInt(digest, 16) % 100_000;
      return {
        number,
        url: `https://github.example/${input.repo.owner}/${input.repo.name}/issues/${number}`,
      };
    },
  };
}

type ExecuteApprovedProposalOptions = {
  config?: AppConfig;
  github?: GitHubIssueClient;
  githubFactory?: GithubClientFactory;
};

export async function executeApprovedProposal(
  db: Db,
  proposal: typeof proposals.$inferSelect,
  actor: { type: string; id: string },
  options: ExecuteApprovedProposalOptions | GitHubIssueClient = {},
) {
  const executionOptions = isGitHubIssueClient(options) ? { github: options } : options;
  if (proposal.state !== "approved" && proposal.state !== "execution_failed") return;
  const actionType = (
    await db.select().from(actionTypes).where(eq(actionTypes.id, proposal.actionTypeId)).limit(1)
  )[0];
  if (!actionType) return;
  try {
    validatePayload(actionType.payloadSchema, proposal.payload);
    if (actionType.name === "task_creation") {
      await executeTaskCreation(db, proposal, executionOptions);
    } else if (actionType.name === "skill_proposal" || actionType.name === "rule_proposal") {
      await executeRegistryDraft(
        db,
        proposal,
        actionType.name === "skill_proposal" ? "skill" : "rule",
      );
    } else if (actionType.name === "guard_candidate") {
      await executeGuardCandidate(db, proposal);
    } else if (actionType.name === "kb_amendment") {
      await executeKbAmendment(db, proposal);
    } else {
      return;
    }
    await db
      .update(proposals)
      .set({ state: "executed", updatedAt: new Date() })
      .where(and(eq(proposals.orgId, proposal.orgId), eq(proposals.id, proposal.id)));
    await appendProposalEvent(db, proposal, "executed", actor, { actionType: actionType.name });
  } catch (error) {
    await db
      .update(proposals)
      .set({ state: "execution_failed", updatedAt: new Date() })
      .where(and(eq(proposals.orgId, proposal.orgId), eq(proposals.id, proposal.id)));
    await appendProposalEvent(db, proposal, "execution_failed", actor, {
      actionType: actionType.name,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function executeTaskCreation(
  db: Db,
  proposal: typeof proposals.$inferSelect,
  options: ExecuteApprovedProposalOptions,
) {
  const payload = objectOrEmpty(proposal.payload);
  const taskId = stringField(payload.taskId);
  if (!taskId) throw new Error("task_creation_missing_task_id");
  const task = (
    await db
      .select()
      .from(poTasks)
      .where(
        and(
          eq(poTasks.orgId, proposal.orgId),
          eq(poTasks.projectId, proposal.projectId ?? ""),
          eq(poTasks.id, taskId),
        ),
      )
      .limit(1)
  )[0];
  if (!task) throw new Error("task_not_found");
  if (task.orgId !== proposal.orgId || task.projectId !== proposal.projectId) {
    throw new Error("task_not_in_proposal_project");
  }
  const repo = (
    await db
      .select()
      .from(repos)
      .where(and(eq(repos.orgId, proposal.orgId), eq(repos.projectId, task.projectId)))
      .limit(1)
  )[0];
  if (!repo) throw new Error("task_creation_missing_repo");
  const github = options.github ?? (await githubIssueClientForRepo(db, repo, options));
  const issueBody = `${task.bodyMd.trimEnd()}

## Value

\`\`\`json
${JSON.stringify(task.wsjf, null, 2)}
\`\`\`

## KB trace

- task: ${task.id}${task.kbEntryId ? `\n- kb_entry: ${task.kbEntryId}` : ""}
`;
  const issue = await github.createIssue({
    repo: { owner: repo.owner, name: repo.name },
    title: task.title,
    body: issueBody,
    labels: ["type:task", "priority:wsjf"],
  });
  const board = objectOrEmpty(objectOrEmpty(payload.target).board);
  if (github.addToBoard && stringField(board.org) && typeof board.number === "number") {
    await github.addToBoard({
      org: stringField(board.org) ?? "",
      number: board.number,
      issueUrl: issue.url,
    });
  }
  await db
    .update(poTasks)
    .set({
      status: "created",
      gh: { repo: `${repo.owner}/${repo.name}`, issue_number: issue.number, url: issue.url },
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(poTasks.orgId, proposal.orgId),
        eq(poTasks.projectId, task.projectId),
        eq(poTasks.id, task.id),
      ),
    );
}

async function githubIssueClientForRepo(
  db: Db,
  repo: typeof repos.$inferSelect,
  options: ExecuteApprovedProposalOptions,
): Promise<GitHubIssueClient> {
  const config = options.config;
  if (!repo.installationId) {
    return mockGitHubIssueClient();
  }
  if (!options.githubFactory && (!config?.githubAppId || !config.githubAppPrivateKey)) {
    return mockGitHubIssueClient();
  }
  const installation = (
    await db
      .select()
      .from(githubInstallations)
      .where(eq(githubInstallations.id, repo.installationId))
      .limit(1)
  )[0];
  if (!installation) return mockGitHubIssueClient();

  const factory = options.githubFactory ?? createGithubClientFactory(config as AppConfig);
  const client = new FacilityGithubClient(await factory(installation.installationId), {
    owner: repo.owner,
    repo: repo.name,
    defaultBranch: repo.defaultBranch,
  });
  return {
    createIssue(input) {
      return client.createIssue({
        title: input.title,
        body: input.body,
        labels: input.labels,
      });
    },
  };
}

function isGitHubIssueClient(value: ExecuteApprovedProposalOptions | GitHubIssueClient) {
  return "createIssue" in value;
}

async function executeRegistryDraft(db: Db, proposal: typeof proposals.$inferSelect, kind: string) {
  const payload = objectOrEmpty(proposal.payload);
  const name = stringField(payload.name);
  const content = stringField(payload.content);
  if (!name || !content) throw new Error("registry_draft_payload_invalid");
  const existing = (
    await db
      .select()
      .from(registryItems)
      .where(
        and(
          eq(registryItems.orgId, proposal.orgId),
          eq(registryItems.kind, kind),
          eq(registryItems.name, name),
        ),
      )
      .limit(1)
  )[0];
  const item =
    existing ??
    (
      await db
        .insert(registryItems)
        .values({
          id: newId("item"),
          orgId: proposal.orgId,
          scope: proposal.projectId ? "project" : "org",
          projectId: proposal.projectId,
          kind,
          name,
          description: stringField(payload.description) ?? `Draft from ${proposal.id}`,
        })
        .returning()
    )[0];
  if (!item) throw new Error("registry_item_create_failed");
  const latest = (
    await db
      .select()
      .from(registryVersions)
      .where(eq(registryVersions.itemId, item.id))
      .orderBy(desc(registryVersions.version))
      .limit(1)
  )[0];
  await db.insert(registryVersions).values({
    id: newId("ver"),
    orgId: proposal.orgId,
    itemId: item.id,
    version: (latest?.version ?? 0) + 1,
    content,
    contentHash: createHash("sha256").update(content).digest("hex"),
    changelog: `Drafted from approved proposal ${proposal.id}`,
    status: "draft",
    createdBy: "learning",
  });
}

async function executeGuardCandidate(db: Db, proposal: typeof proposals.$inferSelect) {
  const payload = objectOrEmpty(proposal.payload);
  const title = stringField(payload.title) ?? `Guard candidate ${proposal.id}`;
  await db
    .insert(platformIssues)
    .values({
      id: newId("iss"),
      orgId: proposal.orgId,
      projectId: proposal.projectId,
      kind: "learning",
      severity: "info",
      fingerprint: `learning:guard:${proposal.id}`,
      title,
      bodyMd: stringField(payload.content) ?? proposal.contextMd,
    })
    .onConflictDoNothing();
}

async function executeKbAmendment(db: Db, proposal: typeof proposals.$inferSelect) {
  if (!proposal.projectId) throw new Error("kb_amendment_missing_project");
  const payload = objectOrEmpty(proposal.payload);
  const type = stringField(payload.type);
  const slug = stringField(payload.slug);
  const bodyMd = stringField(payload.bodyMd);
  if (!type || !slug || !bodyMd) throw new Error("kb_amendment_payload_invalid");
  const space = (
    await db
      .select()
      .from(kbSpaces)
      .where(and(eq(kbSpaces.orgId, proposal.orgId), eq(kbSpaces.projectId, proposal.projectId)))
      .limit(1)
  )[0];
  if (!space) throw new Error("kb_space_missing");
  const graph = await loadKbGraph(db, proposal.orgId, proposal.projectId);
  if (!graph) throw new Error("kb_space_missing");
  const max =
    (
      await db
        .select()
        .from(kbEntries)
        .where(
          and(
            eq(kbEntries.orgId, proposal.orgId),
            eq(kbEntries.spaceId, space.id),
            eq(kbEntries.type, type),
          ),
        )
        .orderBy(desc(kbEntries.number))
        .limit(1)
    )[0]?.number ?? 0;
  const links = arrayOfStrings(payload.links);
  const parentEntries = graph.entries.filter((entry) => links.includes(entry.id));
  if (parentEntries.length !== links.length) throw new Error("kb_amendment_link_target_missing");
  const normalized = normalizeKbDraft({
    type,
    number: max + 1,
    slug,
    frontmatter: objectOrEmpty(payload.frontmatter),
    bodyMd,
    parentEntries,
  });
  const draft = {
    id: "__draft__",
    type,
    number: max + 1,
    slug,
    frontmatter: normalized.frontmatter,
    bodyMd: normalized.bodyMd,
    status: "draft",
    supersedes: null,
  };
  const report = validate({
    space: toHarnessSpace(space),
    entries: [...graph.entries, draft],
    links: [
      ...graph.links,
      ...parentEntries.flatMap((parent) => [
        { fromEntry: "__draft__", toEntry: parent.id },
        { fromEntry: parent.id, toEntry: "__draft__" },
      ]),
    ],
    entryId: "__draft__",
    validateSpecials: false,
  });
  if (!report.ok) throw new Error("kb_validation_failed");
  await db.transaction(async (tx) => {
    const inserted = (
      await tx
        .insert(kbEntries)
        .values({
          id: newId("kb"),
          orgId: proposal.orgId,
          spaceId: space.id,
          type,
          number: max + 1,
          slug,
          frontmatter: normalized.frontmatter,
          bodyMd: normalized.bodyMd,
          status: "draft",
        })
        .returning()
    )[0];
    if (!inserted) throw new Error("kb_amendment_insert_failed");
    const childArtifactId = artifactIdFor(toHarnessEntry(inserted));
    for (const link of links) {
      await tx
        .insert(kbLinks)
        .values([
          { orgId: proposal.orgId, spaceId: space.id, fromEntry: inserted.id, toEntry: link },
          { orgId: proposal.orgId, spaceId: space.id, fromEntry: link, toEntry: inserted.id },
        ])
        .onConflictDoNothing();
      const parent = parentEntries.find((candidate) => candidate.id === link);
      if (parent) {
        await tx
          .update(kbEntries)
          .set({ bodyMd: ensureLinks(parent.bodyMd, [childArtifactId]), updatedAt: new Date() })
          .where(and(eq(kbEntries.orgId, proposal.orgId), eq(kbEntries.id, parent.id)));
      }
    }
    await tx
      .update(kbSpaces)
      .set({ activeMd: ensureActive(space.activeMd, [childArtifactId]), updatedAt: new Date() })
      .where(and(eq(kbSpaces.orgId, proposal.orgId), eq(kbSpaces.id, space.id)));
  });
}

async function appendProposalEvent(
  db: Db,
  proposal: typeof proposals.$inferSelect,
  type: string,
  actor: { type: string; id: string },
  data: Record<string, unknown>,
) {
  const current = await db
    .select()
    .from(proposalEvents)
    .where(
      and(eq(proposalEvents.orgId, proposal.orgId), eq(proposalEvents.proposalId, proposal.id)),
    )
    .orderBy(desc(proposalEvents.seq))
    .limit(1);
  await db.insert(proposalEvents).values({
    orgId: proposal.orgId,
    proposalId: proposal.id,
    seq: (current[0]?.seq ?? 0) + 1,
    type,
    actor,
    data,
  });
}

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringField(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function arrayOfStrings(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function validatePayload(schema: unknown, payload: unknown) {
  const required = Array.isArray((schema as { required?: unknown }).required)
    ? (schema as { required: string[] }).required
    : [];
  const objectPayload = objectOrEmpty(payload);
  for (const key of required) {
    if (!(key in objectPayload)) throw new Error(`schema_validation_failed:${key}`);
  }
}
