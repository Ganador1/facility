import { Eyebrow, PillTag } from "@facility/ui";
import { Offline } from "@/components/offline";
import { api } from "@/lib/api";

export const metadata = { title: "registry" };

const KINDS = [
  "skill",
  "rule",
  "agent_contract",
  "harness",
  "guard",
  "module",
  "template_set",
  "standard_section",
] as const;

export default async function RegistryPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const { kind } = await searchParams;
  const registry = await api.registry(kind ? `?kind=${kind}` : "");
  if (!registry.ok) return <Offline detail={registry.message} />;

  const items = registry.data;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Eyebrow>registry</Eyebrow>
        <h1 className="text-[clamp(24px,3.6vw,40px)] font-semibold leading-[1.08] tracking-[-0.02em]">
          The knowledge, versioned.
        </h1>
        <p className="max-w-xl text-sm leading-relaxed text-(--mut)">
          Skills, rules, agent contracts, harnesses, guards, and template sets — enterprise-wide or
          per project, immutable once published. The ratchet lives here.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <a href="/registry">
          <PillTag active={!kind}>all</PillTag>
        </a>
        {KINDS.map((k) => (
          <a key={k} href={`/registry?kind=${k}`}>
            <PillTag active={kind === k}>{k.replace("_", " ")}</PillTag>
          </a>
        ))}
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-(--dim)">Nothing published under this filter yet.</p>
      ) : (
        <div className="flex flex-col border border-(--line)">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-(--line) px-5 py-4 last:border-b-0"
            >
              <span className="font-mono text-[13px] text-(--ink)">{item.name}</span>
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-(--dim)">
                {item.kind} · {item.scope} · v{item.latestVersion}
              </span>
              {item.description ? (
                <span className="w-full text-[12.5px] leading-relaxed text-(--mut) sm:w-auto sm:flex-1">
                  {item.description}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
