import { agentDefs, analyticsDaily, createDb, type FacilityDb, projects } from "@facility/db";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import type { AppConfig } from "../types.js";

export type AnalyticsGroupBy = "day" | "agent" | "model";

export async function runAnalyticsRollup(config: AppConfig) {
  const { db, client } = createDb(config.databaseUrl);
  try {
    await rollupAnalytics(db);
  } finally {
    await client.end();
  }
}

export async function rollupAnalytics(db: FacilityDb) {
  await db.execute(sql`
    delete from analytics_daily
    where day >= (current_date - interval '90 days')::date
  `);
  await db.execute(sql`
    insert into analytics_daily (
      id,
      org_id,
      project_id,
      day,
      agent_def_id,
      model,
      runs_started,
      runs_succeeded,
      runs_failed,
      input_tokens,
      output_tokens,
      cache_read,
      cache_write,
      cost_cents,
      outcomes_total,
      outcomes_merged,
      outcomes_one_shot,
      updated_at
    )
    with rows as (
      select
        r.org_id,
        r.project_id,
        date_trunc('day', r.created_at)::date as day,
        r.agent_def_id,
        coalesce(ad.model->>'name', ad.model->>'model', r.engine, 'none') as model,
        count(*)::int as runs_started,
        count(*) filter (where r.status = 'succeeded')::int as runs_succeeded,
        count(*) filter (where r.status in ('failed', 'canceled'))::int as runs_failed,
        0::bigint as input_tokens,
        0::bigint as output_tokens,
        0::bigint as cache_read,
        0::bigint as cache_write,
        0::numeric as cost_cents,
        0::int as outcomes_total,
        0::int as outcomes_merged,
        0::int as outcomes_one_shot
      from runs r
      left join agent_defs ad on ad.id = r.agent_def_id
      where r.created_at >= (current_date - interval '90 days')::timestamptz
      group by 1, 2, 3, 4, 5

      union all

      select
        lr.org_id,
        lr.project_id,
        date_trunc('day', lr.created_at)::date as day,
        r.agent_def_id,
        lr.model,
        0::int,
        0::int,
        0::int,
        coalesce(sum(lr.input_tokens), 0)::bigint,
        coalesce(sum(lr.output_tokens), 0)::bigint,
        coalesce(sum(lr.cache_read), 0)::bigint,
        coalesce(sum(lr.cache_write), 0)::bigint,
        coalesce(sum(lr.cost_cents), 0)::numeric,
        0::int,
        0::int,
        0::int
      from llm_requests lr
      left join runs r on r.id = lr.run_id
      where lr.created_at >= (current_date - interval '90 days')::timestamptz
      group by 1, 2, 3, 4, 5

      union all

      select
        o.org_id,
        o.project_id,
        date_trunc('day', o.terminal_at)::date as day,
        null::text as agent_def_id,
        'outcomes' as model,
        0::int,
        0::int,
        0::int,
        0::numeric,
        0::bigint,
        0::bigint,
        0::bigint,
        0::bigint,
        count(*)::int,
        count(*) filter (where o.fate = 'merged')::int,
        count(*) filter (
          where o.fate = 'merged' and o.review_rounds = 0 and o.fixup_commits = 0
        )::int
      from outcomes o
      where o.terminal_at >= (current_date - interval '90 days')::timestamptz
      group by 1, 2, 3, 4, 5
    ),
    grouped as (
      select
        org_id,
        project_id,
        day,
        agent_def_id,
        model,
        sum(runs_started)::int as runs_started,
        sum(runs_succeeded)::int as runs_succeeded,
        sum(runs_failed)::int as runs_failed,
        sum(input_tokens)::bigint as input_tokens,
        sum(output_tokens)::bigint as output_tokens,
        sum(cache_read)::bigint as cache_read,
        sum(cache_write)::bigint as cache_write,
        sum(cost_cents)::numeric as cost_cents,
        sum(outcomes_total)::int as outcomes_total,
        sum(outcomes_merged)::int as outcomes_merged,
        sum(outcomes_one_shot)::int as outcomes_one_shot
      from rows
      group by 1, 2, 3, 4, 5
    )
    select
      'ad_' || substr(md5(org_id || ':' || project_id || ':' || day::text || ':' || coalesce(agent_def_id, '__none__') || ':' || model), 1, 24),
      org_id,
      project_id,
      day,
      agent_def_id,
      model,
      runs_started,
      runs_succeeded,
      runs_failed,
      input_tokens,
      output_tokens,
      cache_read,
      cache_write,
      cost_cents,
      outcomes_total,
      outcomes_merged,
      outcomes_one_shot,
      now()
    from grouped
    on conflict (org_id, project_id, day, coalesce(agent_def_id, '__none__'), model)
    do update set
      runs_started = excluded.runs_started,
      runs_succeeded = excluded.runs_succeeded,
      runs_failed = excluded.runs_failed,
      input_tokens = excluded.input_tokens,
      output_tokens = excluded.output_tokens,
      cache_read = excluded.cache_read,
      cache_write = excluded.cache_write,
      cost_cents = excluded.cost_cents,
      outcomes_total = excluded.outcomes_total,
      outcomes_merged = excluded.outcomes_merged,
      outcomes_one_shot = excluded.outcomes_one_shot,
      updated_at = now()
  `);
}

export async function queryAnalytics(
  db: FacilityDb,
  orgId: string,
  query: { projectId?: string; from?: string; to?: string; groupBy: AnalyticsGroupBy },
) {
  const clauses = [eq(analyticsDaily.orgId, orgId)];
  if (query.projectId) clauses.push(eq(analyticsDaily.projectId, query.projectId));
  if (query.from) clauses.push(gte(analyticsDaily.day, query.from));
  if (query.to) clauses.push(lte(analyticsDaily.day, query.to));
  const bucket =
    query.groupBy === "day"
      ? sql<string>`${analyticsDaily.day}::text`
      : query.groupBy === "agent"
        ? sql<string>`coalesce(${analyticsDaily.agentDefId}, 'none')`
        : analyticsDaily.model;
  const rows = await db
    .select({
      bucket,
      runsStarted: sql<number>`coalesce(sum(${analyticsDaily.runsStarted}), 0)::int`,
      runsSucceeded: sql<number>`coalesce(sum(${analyticsDaily.runsSucceeded}), 0)::int`,
      runsFailed: sql<number>`coalesce(sum(${analyticsDaily.runsFailed}), 0)::int`,
      inputTokens: sql<number>`coalesce(sum(${analyticsDaily.inputTokens}), 0)::bigint`,
      outputTokens: sql<number>`coalesce(sum(${analyticsDaily.outputTokens}), 0)::bigint`,
      costCents: sql<number>`floor(coalesce(sum(${analyticsDaily.costCents}), 0) + 0.5)::bigint`,
      outcomesTotal: sql<number>`coalesce(sum(${analyticsDaily.outcomesTotal}), 0)::int`,
      outcomesMerged: sql<number>`coalesce(sum(${analyticsDaily.outcomesMerged}), 0)::int`,
      outcomesOneShot: sql<number>`coalesce(sum(${analyticsDaily.outcomesOneShot}), 0)::int`,
      acceptance: sql<
        number | null
      >`case when sum(${analyticsDaily.outcomesTotal}) > 0 then round(100.0 * sum(${analyticsDaily.outcomesMerged}) / sum(${analyticsDaily.outcomesTotal}))::int else null end`,
      oneShot: sql<
        number | null
      >`case when sum(${analyticsDaily.outcomesTotal}) > 0 then round(100.0 * sum(${analyticsDaily.outcomesOneShot}) / sum(${analyticsDaily.outcomesTotal}))::int else null end`,
    })
    .from(analyticsDaily)
    .where(and(...clauses))
    .groupBy(bucket)
    .orderBy(bucket);
  return rows.map((row) => ({
    ...row,
    runsStarted: Number(row.runsStarted),
    runsSucceeded: Number(row.runsSucceeded),
    runsFailed: Number(row.runsFailed),
    inputTokens: Number(row.inputTokens),
    outputTokens: Number(row.outputTokens),
    costCents: Number(row.costCents),
    outcomesTotal: Number(row.outcomesTotal),
    outcomesMerged: Number(row.outcomesMerged),
    outcomesOneShot: Number(row.outcomesOneShot),
  }));
}

export async function analyticsOverview(db: FacilityDb, orgId: string, projectId?: string) {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600_000).toISOString().slice(0, 10);
  const agentClauses = [eq(agentDefs.orgId, orgId), eq(agentDefs.enabled, true)];
  if (projectId) agentClauses.push(eq(agentDefs.projectId, projectId));
  const liveAgents =
    (
      await db
        .select({ count: sql<number>`count(*)::int` })
        .from(agentDefs)
        .where(and(...agentClauses))
    )[0]?.count ?? 0;
  const mtdClauses = [
    eq(analyticsDaily.orgId, orgId),
    gte(analyticsDaily.day, monthStart.toISOString().slice(0, 10)),
  ];
  if (projectId) mtdClauses.push(eq(analyticsDaily.projectId, projectId));
  const spendMtd = Number(
    (
      await db
        .select({
          cents: sql<number>`floor(coalesce(sum(${analyticsDaily.costCents}), 0) + 0.5)::bigint`,
        })
        .from(analyticsDaily)
        .where(and(...mtdClauses))
    )[0]?.cents ?? 0,
  );
  const outcomeClauses = [eq(analyticsDaily.orgId, orgId), gte(analyticsDaily.day, thirtyDaysAgo)];
  if (projectId) outcomeClauses.push(eq(analyticsDaily.projectId, projectId));
  const rawOutcomeTotals = (
    await db
      .select({
        total: sql<number>`coalesce(sum(${analyticsDaily.outcomesTotal}), 0)::int`,
        merged: sql<number>`coalesce(sum(${analyticsDaily.outcomesMerged}), 0)::int`,
        oneShot: sql<number>`coalesce(sum(${analyticsDaily.outcomesOneShot}), 0)::int`,
      })
      .from(analyticsDaily)
      .where(and(...outcomeClauses))
  )[0] ?? { total: 0, merged: 0, oneShot: 0 };
  const outcomeTotals = {
    total: Number(rawOutcomeTotals.total),
    merged: Number(rawOutcomeTotals.merged),
    oneShot: Number(rawOutcomeTotals.oneShot),
  };
  const perProject = await db
    .select({
      projectId: projects.id,
      projectName: projects.name,
      spendCents: sql<number>`floor(coalesce(sum(${analyticsDaily.costCents}), 0) + 0.5)::bigint`,
      runsStarted: sql<number>`coalesce(sum(${analyticsDaily.runsStarted}), 0)::int`,
      outcomesTotal: sql<number>`coalesce(sum(${analyticsDaily.outcomesTotal}), 0)::int`,
      outcomesMerged: sql<number>`coalesce(sum(${analyticsDaily.outcomesMerged}), 0)::int`,
      outcomesOneShot: sql<number>`coalesce(sum(${analyticsDaily.outcomesOneShot}), 0)::int`,
    })
    .from(projects)
    .leftJoin(
      analyticsDaily,
      and(eq(analyticsDaily.projectId, projects.id), gte(analyticsDaily.day, thirtyDaysAgo)),
    )
    .where(
      projectId
        ? and(eq(projects.orgId, orgId), eq(projects.id, projectId))
        : eq(projects.orgId, orgId),
    )
    .groupBy(projects.id, projects.name)
    .orderBy(projects.name);
  return {
    liveAgents,
    spendMtdCents: spendMtd,
    acceptance30d:
      outcomeTotals.total > 0
        ? Math.round((100 * outcomeTotals.merged) / outcomeTotals.total)
        : null,
    oneShot30d:
      outcomeTotals.total > 0
        ? Math.round((100 * outcomeTotals.oneShot) / outcomeTotals.total)
        : null,
    projects: perProject.map((project) => ({
      ...project,
      spendCents: Number(project.spendCents),
      runsStarted: Number(project.runsStarted),
      outcomesTotal: Number(project.outcomesTotal),
      outcomesMerged: Number(project.outcomesMerged),
      outcomesOneShot: Number(project.outcomesOneShot),
    })),
  };
}
