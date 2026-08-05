import { newId } from "@facility/core";
import {
  type FacilityDb,
  ghPullRequests,
  githubInstallations,
  repos,
  schedulerWatermarks,
} from "@facility/db";
import { and, eq, sql } from "drizzle-orm";
import {
  FacilityGithubClient,
  type GithubClientFactory,
  type GithubPullRequestSnapshot,
} from "./client.js";

const BODY_LIMIT = 64 * 1024;
const PR_WATERMARK_PREFIX = "github.pull_requests";
const MAX_PAGES_PER_CONNECTION = 10;
const SYNC_OVERLAP_MS = 2 * 60 * 1000;
const INITIAL_WATERMARK = new Date(0);

export type GithubPullRequestWebhookPayload = {
  action?: string;
  pull_request?: {
    number?: number;
    title?: string;
    state?: string;
    draft?: boolean;
    user?: { login?: string | null } | null;
    html_url?: string;
    body?: string | null;
    merged?: boolean;
    base?: { ref?: string };
    head?: { ref?: string; sha?: string };
    created_at?: string | null;
    updated_at?: string | null;
    closed_at?: string | null;
    merged_at?: string | null;
  };
  repository?: {
    name?: string;
    owner?: { login?: string };
  };
};

/** Mirror the webhook immediately; GraphQL refresh fills linkage and CI below. */
export async function upsertGhPullRequestFromWebhook(
  db: FacilityDb,
  orgId: string,
  payload: GithubPullRequestWebhookPayload,
) {
  const owner = payload.repository?.owner?.login;
  const name = payload.repository?.name;
  const pull = payload.pull_request;
  if (!owner || !name || !pull) return null;
  const repo = await resolveRepo(db, orgId, owner, name);
  if (!repo) return null;
  const values = webhookValues(repo, pull);
  if (!values) return null;
  const [row] = await db
    .insert(ghPullRequests)
    .values(values)
    .onConflictDoUpdate({
      target: [ghPullRequests.repoId, ghPullRequests.number],
      set: {
        orgId: values.orgId,
        projectId: values.projectId,
        title: values.title,
        state: values.state,
        draft: values.draft,
        author: values.author,
        headRef: values.headRef,
        headSha: values.headSha,
        baseRef: values.baseRef,
        htmlUrl: values.htmlUrl,
        bodyMd: values.bodyMd,
        ghCreatedAt: values.ghCreatedAt,
        ghUpdatedAt: values.ghUpdatedAt,
        closedAt: values.closedAt,
        mergedAt: values.mergedAt,
        ciState: sql`case when ${ghPullRequests.headSha} = ${values.headSha} then ${ghPullRequests.ciState} else null end`,
        ciHeadSha: sql`case when ${ghPullRequests.headSha} = ${values.headSha} then ${ghPullRequests.ciHeadSha} else null end`,
        ciUpdatedAt: sql`case when ${ghPullRequests.headSha} = ${values.headSha} then ${ghPullRequests.ciUpdatedAt} else null end`,
        syncedAt: values.syncedAt,
        updatedAt: values.updatedAt,
      },
    })
    .returning();
  return row ?? null;
}

export async function syncRepoPullRequests(
  db: FacilityDb,
  clientFactory: GithubClientFactory,
  repo: typeof repos.$inferSelect,
) {
  const client = await clientForRepo(db, clientFactory, repo);
  if (!client) return { synced: 0 };
  if (!client.supportsPullRequestSnapshots()) return { synced: 0 };
  // Each connection is chunked and resumable. Its high-water mark advances
  // only after the descending walk catches the previous completed scan (or
  // reaches the end), so a rate-limit or worker restart cannot strand the tail.
  const syncConnection = async (
    states: Array<"OPEN" | "CLOSED" | "MERGED">,
    kind: "open" | "terminal",
  ) => {
    const watermarkName = `${PR_WATERMARK_PREFIX}.${kind}:${repo.id}`;
    const watermark = await pullRequestWatermark(db, watermarkName);
    let cursor = watermark?.cursor ?? undefined;
    const previousCompletedAt = watermark?.lastTick ?? INITIAL_WATERMARK;
    const scanStartedAt = watermark?.scanStartedAt ?? new Date();
    const catchUpBefore = previousCompletedAt.getTime() - SYNC_OVERLAP_MS;
    let count = 0;
    for (let pages = 0; pages < MAX_PAGES_PER_CONNECTION; pages += 1) {
      const page = await client.listPullRequestSnapshots({ cursor, perPage: 100, states });
      for (const pull of page.pullRequests) {
        await upsertPullRequestSnapshot(db, repo, pull);
        count += 1;
      }
      const caughtUp =
        kind === "terminal" &&
        Boolean(watermark) &&
        page.pullRequests.some((pull) => {
          const updatedAt = pull.updatedAt ? Date.parse(pull.updatedAt) : Number.NaN;
          return Number.isFinite(updatedAt) && updatedAt <= catchUpBefore;
        });
      if (!page.hasNextPage || caughtUp) {
        await completePullRequestScan(db, watermarkName, scanStartedAt);
        return { count, incomplete: false };
      }
      if (!page.endCursor) throw new Error("GitHub PR pagination returned no end cursor");
      cursor = page.endCursor;
      await savePullRequestScanProgress(db, {
        name: watermarkName,
        previousCompletedAt,
        cursor,
        scanStartedAt,
      });
    }
    return { count, incomplete: true };
  };
  const open = await syncConnection(["OPEN"], "open");
  const terminal = await syncConnection(["CLOSED", "MERGED"], "terminal");
  return {
    synced: open.count + terminal.count,
    incomplete: open.incomplete || terminal.incomplete,
  };
}

export async function refreshGhPullRequest(
  db: FacilityDb,
  clientFactory: GithubClientFactory,
  repo: typeof repos.$inferSelect,
  number: number,
) {
  const client = await clientForRepo(db, clientFactory, repo);
  if (!client) return null;
  if (!client.supportsPullRequestSnapshots()) return null;
  const snapshot = await client.getPullRequestSnapshot(number);
  return snapshot ? upsertPullRequestSnapshot(db, repo, snapshot) : null;
}

export async function refreshPullRequestsForSignal(
  db: FacilityDb,
  clientFactory: GithubClientFactory,
  repo: typeof repos.$inferSelect,
  input: { headSha?: string | null; numbers?: number[] },
) {
  const numbers = new Set((input.numbers ?? []).filter((number) => number > 0));
  if (input.headSha) {
    const rows = await db
      .select({ number: ghPullRequests.number })
      .from(ghPullRequests)
      .where(
        and(
          eq(ghPullRequests.repoId, repo.id),
          eq(ghPullRequests.state, "open"),
          eq(ghPullRequests.headSha, input.headSha),
        ),
      );
    for (const row of rows) numbers.add(row.number);
  }
  for (const number of numbers) {
    await refreshGhPullRequest(db, clientFactory, repo, number);
  }
  return numbers.size;
}

export async function upsertPullRequestSnapshot(
  db: FacilityDb,
  repo: typeof repos.$inferSelect,
  pull: GithubPullRequestSnapshot,
) {
  const now = new Date();
  const values = {
    id: newId("ghp"),
    orgId: repo.orgId,
    projectId: repo.projectId,
    repoId: repo.id,
    number: pull.number,
    title: pull.title,
    state: pull.state,
    draft: pull.draft,
    author: pull.author,
    headRef: pull.headRef,
    headSha: pull.headSha,
    baseRef: pull.baseRef,
    htmlUrl: pull.url,
    bodyMd: capBody(pull.body),
    closingIssues: pull.closingIssues,
    ciState: pull.ciState,
    ciHeadSha: pull.ciHeadSha,
    ciUpdatedAt: now,
    ghCreatedAt: dateOrNull(pull.createdAt),
    ghUpdatedAt: dateOrNull(pull.updatedAt),
    closedAt: dateOrNull(pull.closedAt),
    mergedAt: dateOrNull(pull.mergedAt),
    syncedAt: now,
    updatedAt: now,
  };
  const [row] = await db
    .insert(ghPullRequests)
    .values(values)
    .onConflictDoUpdate({
      target: [ghPullRequests.repoId, ghPullRequests.number],
      set: {
        orgId: values.orgId,
        projectId: values.projectId,
        title: values.title,
        state: values.state,
        draft: values.draft,
        author: values.author,
        headRef: values.headRef,
        headSha: values.headSha,
        baseRef: values.baseRef,
        htmlUrl: values.htmlUrl,
        bodyMd: values.bodyMd,
        closingIssues: values.closingIssues,
        ciState: values.ciState,
        ciHeadSha: values.ciHeadSha,
        ciUpdatedAt: values.ciUpdatedAt,
        ghCreatedAt: values.ghCreatedAt,
        ghUpdatedAt: values.ghUpdatedAt,
        closedAt: values.closedAt,
        mergedAt: values.mergedAt,
        syncedAt: now,
        updatedAt: now,
      },
    })
    .returning();
  return row ?? null;
}

async function clientForRepo(
  db: FacilityDb,
  factory: GithubClientFactory,
  repo: typeof repos.$inferSelect,
) {
  if (!repo.installationId) return null;
  const installation = (
    await db
      .select()
      .from(githubInstallations)
      .where(
        and(
          eq(githubInstallations.orgId, repo.orgId),
          eq(githubInstallations.id, repo.installationId),
        ),
      )
      .limit(1)
  )[0];
  if (!installation || installation.suspendedAt) return null;
  return new FacilityGithubClient(await factory(installation.installationId), {
    owner: repo.owner,
    repo: repo.name,
    defaultBranch: repo.defaultBranch,
  });
}

async function resolveRepo(db: FacilityDb, orgId: string, owner: string, name: string) {
  return (
    await db
      .select()
      .from(repos)
      .where(and(eq(repos.orgId, orgId), eq(repos.owner, owner), eq(repos.name, name)))
      .limit(1)
  )[0];
}

async function pullRequestWatermark(db: FacilityDb, name: string) {
  return (
    await db.select().from(schedulerWatermarks).where(eq(schedulerWatermarks.name, name)).limit(1)
  )[0];
}

async function savePullRequestScanProgress(
  db: FacilityDb,
  input: {
    name: string;
    previousCompletedAt: Date;
    cursor: string;
    scanStartedAt: Date;
  },
) {
  await db
    .insert(schedulerWatermarks)
    .values({
      name: input.name,
      lastTick: input.previousCompletedAt,
      cursor: input.cursor,
      scanStartedAt: input.scanStartedAt,
    })
    .onConflictDoUpdate({
      target: schedulerWatermarks.name,
      set: {
        cursor: input.cursor,
        scanStartedAt: input.scanStartedAt,
        updatedAt: new Date(),
      },
    });
}

async function completePullRequestScan(db: FacilityDb, name: string, completedThrough: Date) {
  await db
    .insert(schedulerWatermarks)
    .values({ name, lastTick: completedThrough })
    .onConflictDoUpdate({
      target: schedulerWatermarks.name,
      set: {
        lastTick: completedThrough,
        cursor: null,
        scanStartedAt: null,
        updatedAt: new Date(),
      },
    });
}

function webhookValues(
  repo: typeof repos.$inferSelect,
  pull: NonNullable<GithubPullRequestWebhookPayload["pull_request"]>,
) {
  if (
    !pull.number ||
    !pull.title ||
    !pull.html_url ||
    !pull.head?.ref ||
    !pull.head.sha ||
    !pull.base?.ref
  ) {
    return null;
  }
  const now = new Date();
  return {
    id: newId("ghp"),
    orgId: repo.orgId,
    projectId: repo.projectId,
    repoId: repo.id,
    number: pull.number,
    title: pull.title,
    state: pull.merged ? "merged" : pull.state === "closed" ? "closed" : "open",
    draft: pull.draft ?? false,
    author: pull.user?.login ?? null,
    headRef: pull.head.ref,
    headSha: pull.head.sha,
    baseRef: pull.base.ref,
    htmlUrl: pull.html_url,
    bodyMd: capBody(pull.body),
    ghCreatedAt: dateOrNull(pull.created_at),
    ghUpdatedAt: dateOrNull(pull.updated_at),
    closedAt: dateOrNull(pull.closed_at),
    mergedAt: dateOrNull(pull.merged_at),
    syncedAt: now,
    updatedAt: now,
  };
}

function capBody(body: string | null | undefined) {
  if (!body) return null;
  return body.length > BODY_LIMIT ? body.slice(0, BODY_LIMIT) : body;
}

function dateOrNull(value: string | null | undefined) {
  return value ? new Date(value) : null;
}
