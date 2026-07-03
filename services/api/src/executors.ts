import { createHash } from "node:crypto";
import { newId } from "@facility/core";
import type { createDb } from "@facility/db";
import {
  actionTypes,
  kbEntries,
  kbSpaces,
  platformIssues,
  poTasks,
  proposalEvents,
  type proposals,
  registryItems,
  registryVersions,
  repos,
} from "@facility/db";
import { and, desc, eq } from "drizzle-orm";

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

export async function executeApprovedProposal(
  db: Db,
  proposal: typeof proposals.$inferSelect,
  actor: { type: string; id: string },
  github: GitHubIssueClient = mockGitHubIssueClient(),
) {
  if (proposal.state !== "approved") return;
  const actionType = (
    await db.select().from(actionTypes).where(eq(actionTypes.id, proposal.actionTypeId)).limit(1)
  )[0];
  if (!actionType) return;
  try {
    if (actionType.name === "task_creation") {
      await executeTaskCreation(db, proposal, github);
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
    await appendProposalEvent(db, proposal, "executed", actor, { actionType: actionType.name });
  } catch (error) {
    await appendProposalEvent(db, proposal, "execution_failed", actor, {
      actionType: actionType.name,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function executeTaskCreation(
  db: Db,
  proposal: typeof proposals.$inferSelect,
  github: GitHubIssueClient,
) {
  const payload = objectOrEmpty(proposal.payload);
  const taskId = stringField(payload.taskId);
  if (!taskId) throw new Error("task_creation_missing_task_id");
  const task = (await db.select().from(poTasks).where(eq(poTasks.id, taskId)).limit(1))[0];
  if (!task) throw new Error("task_not_found");
  const repo =
    (
      await db
        .select()
        .from(repos)
        .where(and(eq(repos.orgId, proposal.orgId), eq(repos.projectId, task.projectId)))
        .limit(1)
    )[0] ?? repoFromPayload(payload);
  if (!repo) throw new Error("task_creation_missing_repo");
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
    .where(eq(poTasks.id, task.id));
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
  const space = (
    await db
      .select()
      .from(kbSpaces)
      .where(and(eq(kbSpaces.orgId, proposal.orgId), eq(kbSpaces.projectId, proposal.projectId)))
      .limit(1)
  )[0];
  if (!space) throw new Error("kb_space_missing");
  await db.insert(kbEntries).values({
    id: newId("kb"),
    orgId: proposal.orgId,
    spaceId: space.id,
    type: stringField(payload.type) ?? "L",
    number: typeof payload.number === "number" ? payload.number : Date.now() % 1_000_000,
    slug: stringField(payload.slug) ?? `learning-${proposal.id}`,
    frontmatter: objectOrEmpty(payload.frontmatter),
    bodyMd: stringField(payload.bodyMd) ?? proposal.contextMd,
    status: "draft",
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

function repoFromPayload(payload: Record<string, unknown>) {
  const target = objectOrEmpty(payload.target);
  const repo = objectOrEmpty(target.repo);
  const owner = stringField(repo.owner);
  const name = stringField(repo.name);
  return owner && name ? { owner, name } : null;
}

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringField(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}
