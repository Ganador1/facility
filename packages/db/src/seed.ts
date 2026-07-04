import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { BUNDLED_ROLES, newId } from "@facility/core";
import { config as loadDotenv } from "dotenv";
import postgres from "postgres";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "../../..");
loadDotenv({ path: join(repoRoot, ".env"), quiet: true });

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir);
  const out: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry);
    const info = await stat(path);
    if (info.isDirectory()) {
      out.push(...(await walk(path)));
    } else {
      out.push(path);
    }
  }
  return out.sort();
}

function kindFor(path: string): string {
  if (path.includes("/guards/")) return "guard";
  if (path.includes("/agents/")) return "agent_contract";
  if (path.includes("/prompts/")) return "harness";
  if (path.includes("/modules/")) return "module";
  if (path.endsWith("STANDARD.md") || path.endsWith("standard-section.md"))
    return "standard_section";
  return "template_set";
}

export async function seed(connectionString = process.env.DATABASE_URL): Promise<void> {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }
  const sql = postgres(connectionString, { max: 1 });
  try {
    for (const role of BUNDLED_ROLES) {
      await sql`
        INSERT INTO roles (id, org_id, name, description, permissions)
        VALUES (${`role_bundled_${role.name}`}, NULL, ${role.name}, ${role.description}, ${role.permissions})
        ON CONFLICT (coalesce(org_id, '__bundled__'), name)
        DO UPDATE SET description = EXCLUDED.description, permissions = EXCLUDED.permissions, updated_at = now()
      `;
    }

    await sql`
      INSERT INTO orgs (id, name, slug, settings)
      VALUES (
        'org_dev_the_agile_monkeys',
        'The Agile Monkeys',
        'the-agile-monkeys',
        '{"retention_days":90,"telemetry_opt_in":false}'::jsonb
      )
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
    `;
    await sql`
      INSERT INTO users (id, email, name, status)
      VALUES ('user_dev_admin', 'admin@theagilemonkeys.com', 'Dev Admin', 'active')
      ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
    `;
    await sql`
      INSERT INTO org_members (id, org_id, user_id, role_id)
      VALUES ('member_dev_admin', 'org_dev_the_agile_monkeys', 'user_dev_admin', 'role_bundled_owner')
      ON CONFLICT (org_id, user_id) DO UPDATE SET role_id = EXCLUDED.role_id, updated_at = now()
    `;

    await sql`
      INSERT INTO sandbox_profiles (id, org_id, name, driver, image, setup, resources, network)
      VALUES (
        'sbx_dev_default',
        'org_dev_the_agile_monkeys',
        'Default Docker Node 22',
        'docker',
        'node:22-bookworm',
        '{"deps":[]}'::jsonb,
        '{"cpu":2,"memory_mb":4096,"timeout_min":60}'::jsonb,
        '{"egress":"restricted"}'::jsonb
      )
        ON CONFLICT (id) DO UPDATE SET image = EXCLUDED.image, updated_at = now()
    `;
    const devProjects = await sql<{ id: string }[]>`
      INSERT INTO projects (id, org_id, name, slug, description, settings)
      VALUES (
        'proj_dev_facility',
        'org_dev_the_agile_monkeys',
        'Facility Dev',
        'facility-dev',
        'Seeded development project',
        '{"default_branch":"main","check_cmds":[]}'::jsonb
      )
      ON CONFLICT (org_id, slug) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        updated_at = now()
      RETURNING id
    `;
    const devProjectId = devProjects[0]?.id;
    if (!devProjectId) throw new Error("failed to seed dev project");

    const actionTypes = [
      { name: "plan_acceptance", required: [] },
      { name: "learning_validation", required: [] },
      { name: "kickstart_review", required: [] },
      { name: "budget_override", required: [] },
      { name: "task_creation", required: ["taskId", "title", "bodyMd", "wsjf", "target"] },
      { name: "skill_proposal", required: ["name", "content", "evidence_refs"] },
      { name: "rule_proposal", required: ["name", "content", "evidence_refs"] },
      { name: "guard_candidate", required: ["title", "content", "evidence_refs"] },
      { name: "kb_amendment", required: ["type", "slug", "bodyMd", "evidence_refs"] },
    ];
    for (const actionType of actionTypes) {
      await sql`
        INSERT INTO action_types (id, org_id, name, payload_schema, resolver, executor, default_ttl_hours)
        VALUES (
          ${`act_dev_${actionType.name}`},
          'org_dev_the_agile_monkeys',
          ${actionType.name},
          ${JSON.stringify({ type: "object", required: actionType.required })}::jsonb,
          '{"type":"permission","config":{"permission":"hitl:decide"}}'::jsonb,
          ${JSON.stringify({
            type: [
              "task_creation",
              "skill_proposal",
              "rule_proposal",
              "guard_candidate",
              "kb_amendment",
            ].includes(actionType.name)
              ? "internal"
              : "none",
            config: {},
          })}::jsonb,
          72
        )
        ON CONFLICT (org_id, name) DO UPDATE SET
          payload_schema = EXCLUDED.payload_schema,
          resolver = EXCLUDED.resolver,
          executor = EXCLUDED.executor,
          updated_at = now()
      `;
    }

    const harnessRoot = join(repoRoot, "packages/harness");
    const poContract = await readFile(join(harnessRoot, "contracts/po-agent.md"), "utf8");
    const learningContract = await readFile(
      join(harnessRoot, "contracts/learning-agent.md"),
      "utf8",
    );
    const poContractId = await upsertRegistry(
      sql,
      "agent_contract",
      "po-agent",
      "Bundled Project Owner contract",
      poContract,
    );
    const learningContractId = await upsertRegistry(
      sql,
      "agent_contract",
      "learning-agent",
      "Bundled learning mode contract",
      learningContract,
    );
    const productChainId = await upsertRegistry(
      sql,
      "harness",
      "product-chain",
      "Bundled product owner artifact chain",
      JSON.stringify(productChainSeed(), null, 2),
    );
    await upsertRegistry(
      sql,
      "harness",
      "research-chain",
      "Bundled Limina-compatible research artifact chain",
      JSON.stringify(researchChainSeed(), null, 2),
    );
    await sql`
      INSERT INTO agent_defs (
        id,
        org_id,
        project_id,
        name,
        engine,
        model,
        contract_item_id,
        harness_item_id,
        triggers,
        sandbox_profile_id,
        permissions,
        enabled
      )
      VALUES (
        'agent_dev_project_owner',
        'org_dev_the_agile_monkeys',
        ${devProjectId},
        'project-owner',
        'codex',
        '{"primary":"gpt-5.5"}'::jsonb,
        ${poContractId},
        ${productChainId},
        '[{"type":"schedule","config":{"cron":"0 6 * * *","timezone":"UTC"}},{"type":"manual","config":{}}]'::jsonb,
        'sbx_dev_default',
        ARRAY['kb:write','tasks:write','hitl:write']::text[],
        true
      )
      ON CONFLICT (id) DO UPDATE SET
        project_id = EXCLUDED.project_id,
        model = EXCLUDED.model,
        contract_item_id = EXCLUDED.contract_item_id,
        harness_item_id = EXCLUDED.harness_item_id,
        triggers = EXCLUDED.triggers,
        sandbox_profile_id = EXCLUDED.sandbox_profile_id,
        permissions = EXCLUDED.permissions,
        enabled = true,
        updated_at = now()
    `;
    await sql`
      INSERT INTO agent_defs (
        id,
        org_id,
        project_id,
        name,
        engine,
        model,
        contract_item_id,
        harness_item_id,
        triggers,
        sandbox_profile_id,
        permissions,
        enabled
      )
      VALUES (
        'agent_dev_learning',
        'org_dev_the_agile_monkeys',
        ${devProjectId},
        'learning',
        'codex',
        '{"primary":"gpt-5.5"}'::jsonb,
        ${learningContractId},
        ${productChainId},
        '[{"type":"schedule","config":{"cron":"0 3 * * *","timezone":"UTC"}}]'::jsonb,
        'sbx_dev_default',
        ARRAY['runs:read','hitl:write','kb:read']::text[],
        true
      )
      ON CONFLICT (id) DO UPDATE SET
        project_id = EXCLUDED.project_id,
        model = EXCLUDED.model,
        contract_item_id = EXCLUDED.contract_item_id,
        harness_item_id = EXCLUDED.harness_item_id,
        triggers = EXCLUDED.triggers,
        sandbox_profile_id = EXCLUDED.sandbox_profile_id,
        permissions = EXCLUDED.permissions,
        enabled = true,
        updated_at = now()
    `;

    const templateRoot = join(repoRoot, "packages/cli/templates");
    const moduleRoot = join(repoRoot, "packages/cli/modules");
    const files = [...(await walk(templateRoot)), ...(await walk(moduleRoot))];
    const allContent = files.map((file) => relative(repoRoot, file)).join("\n");
    await upsertRegistry(
      sql,
      "template_set",
      "facility-standard",
      "Facility standard template set",
      allContent,
    );
    for (const file of files) {
      const content = await readFile(file, "utf8");
      const rel = relative(repoRoot, file);
      const name =
        rel.replace(/^packages\/cli\/(templates|modules)\//, "").replace(extname(rel), "") ||
        basename(file);
      await upsertRegistry(sql, kindFor(rel), name, rel, content);
    }
    console.log("seed complete");
  } finally {
    await sql.end();
  }
}

function productChainSeed() {
  return {
    id: "product",
    types: {
      S: { name: "Signal", parentTypes: [] },
      D: { name: "Decision", parentTypes: ["S"] },
      T: { name: "Task", parentTypes: ["D"] },
      V: { name: "Verification", parentTypes: ["T"] },
    },
  };
}

function researchChainSeed() {
  return {
    id: "research",
    types: {
      H: { name: "Hypothesis", parentTypes: [] },
      E: { name: "Experiment", parentTypes: ["H"] },
      F: { name: "Finding", parentTypes: ["E"] },
      L: { name: "Literature", parentTypes: [] },
      CR: { name: "Challenge Review", parentTypes: [] },
      SR: { name: "Strategic Review", parentTypes: ["CR"] },
    },
  };
}

async function upsertRegistry(
  sql: postgres.Sql,
  kind: string,
  name: string,
  description: string,
  content: string,
): Promise<string> {
  const contentHash = hash(content);
  const rows = await sql<{ id: string }[]>`
    INSERT INTO registry_items (id, org_id, scope, kind, name, description, latest_version)
    VALUES (${newId("item")}, 'org_dev_the_agile_monkeys', 'bundled', ${kind}, ${name}, ${description}, 1)
    ON CONFLICT (org_id, coalesce(project_id, '__none__'), kind, name)
    DO UPDATE SET description = EXCLUDED.description, latest_version = 1, updated_at = now()
    RETURNING id
  `;
  const itemId = rows[0]?.id;
  if (!itemId) throw new Error(`failed to seed registry item ${name}`);
  await sql`
    INSERT INTO registry_versions (id, org_id, item_id, version, content, content_hash, changelog, status, created_by)
    VALUES (${newId("ver")}, 'org_dev_the_agile_monkeys', ${itemId}, 1, ${content}, ${contentHash}, 'seeded from CLI templates', 'active', 'seed')
    ON CONFLICT (item_id, version)
    DO UPDATE SET content = EXCLUDED.content, content_hash = EXCLUDED.content_hash, status = 'active', updated_at = now()
  `;
  return itemId;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seed().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
