import { newId } from "@facility/core";
import { type FacilityDb, insertAuditEvent, platformIssues } from "@facility/db";
import { and, eq, inArray } from "drizzle-orm";

export type IssueSeverity = "warn" | "error" | "high";

export type IssueInput = {
  orgId: string;
  projectId?: string | null;
  kind: string;
  severity: IssueSeverity;
  fingerprint: string;
  title: string;
  bodyMd: string;
};

export async function raisePlatformIssue(db: FacilityDb, input: IssueInput) {
  const existing = (
    await db
      .select()
      .from(platformIssues)
      .where(
        and(
          eq(platformIssues.orgId, input.orgId),
          eq(platformIssues.fingerprint, input.fingerprint),
        ),
      )
      .limit(1)
  )[0];
  const now = new Date();
  if (!existing) {
    return (
      await db
        .insert(platformIssues)
        .values({
          id: newId("iss"),
          orgId: input.orgId,
          projectId: input.projectId ?? undefined,
          kind: input.kind,
          severity: input.severity,
          fingerprint: input.fingerprint,
          title: input.title,
          bodyMd: input.bodyMd,
          state: "open",
        })
        .returning()
    )[0];
  }

  const wasResolved = existing.state === "resolved";
  const updated = (
    await db
      .update(platformIssues)
      .set({
        projectId: input.projectId ?? existing.projectId,
        kind: input.kind,
        severity: input.severity,
        title: input.title,
        bodyMd: input.bodyMd,
        state: wasResolved ? "open" : existing.state,
        lastSeen: now,
        count: existing.count + 1,
        updatedAt: now,
      })
      .where(and(eq(platformIssues.orgId, input.orgId), eq(platformIssues.id, existing.id)))
      .returning()
  )[0];
  if (wasResolved) {
    await insertAuditEvent(db, {
      orgId: input.orgId,
      actor: { type: "system", name: "watchtower" },
      action: "issue.reopened",
      target: { type: "issue", id: existing.id },
      payload: { fingerprint: input.fingerprint, kind: input.kind },
    });
  }
  return updated;
}

export async function resolvePlatformIssue(
  db: FacilityDb,
  orgId: string,
  fingerprint: string,
  note: string,
) {
  const existing = (
    await db
      .select()
      .from(platformIssues)
      .where(and(eq(platformIssues.orgId, orgId), eq(platformIssues.fingerprint, fingerprint)))
      .limit(1)
  )[0];
  if (!existing || existing.state === "resolved") return existing ?? null;
  return (
    await db
      .update(platformIssues)
      .set({
        state: "resolved",
        bodyMd: `${existing.bodyMd}\n\nRecovery: ${note}`,
        lastSeen: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(platformIssues.orgId, orgId), eq(platformIssues.id, existing.id)))
      .returning()
  )[0];
}

export async function openIssuesForProject(db: FacilityDb, orgId: string, projectId: string) {
  return db
    .select()
    .from(platformIssues)
    .where(
      and(
        eq(platformIssues.orgId, orgId),
        eq(platformIssues.projectId, projectId),
        inArray(platformIssues.state, ["open", "acked"]),
      ),
    );
}
