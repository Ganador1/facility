import { Offline } from "@/components/offline";
import { api } from "@/lib/api";
import { Eyebrow } from "@facility/ui";

export const metadata = { title: "audit" };

export default async function AuditPage() {
  const audit = await api.audit("?limit=100");
  if (!audit.ok) return <Offline detail={audit.message} />;

  const items = audit.data;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Eyebrow>audit</Eyebrow>
        <h1 className="text-[clamp(24px,3.6vw,40px)] font-semibold leading-[1.08] tracking-[-0.02em]">
          Everything, attributable.
        </h1>
        <p className="max-w-xl text-sm leading-relaxed text-(--mut)">
          Append-only and hash-chained. Every platform action — human, agent, or system — lands
          here and can be verified for tamper evidence.
        </p>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-(--dim)">No events yet.</p>
      ) : (
        <div className="overflow-x-auto border border-(--line)">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead>
              <tr className="border-b border-(--line)">
                {["seq", "actor", "action", "target", "when"].map((h) => (
                  <th key={h} className="px-5 py-3 font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-(--dim)">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((event) => (
                <tr key={event.seq} className="border-b border-(--line) last:border-b-0">
                  <td className="tabular px-5 py-3 font-mono text-[11px] text-(--dim)">
                    {event.seq}
                  </td>
                  <td className="px-5 py-3 font-mono text-[12px] text-(--mut)">
                    {event.actor.name ?? event.actor.id}
                    <span className="ml-2 text-[10px] uppercase text-(--dim)">
                      {event.actor.type}
                    </span>
                  </td>
                  <td className="px-5 py-3 font-mono text-[12px] text-(--ink)">{event.action}</td>
                  <td className="px-5 py-3 font-mono text-[11px] text-(--dim)">
                    {event.target ? `${event.target.type}/${event.target.id}` : "—"}
                  </td>
                  <td className="px-5 py-3 font-mono text-[11px] text-(--dim)">
                    {new Date(event.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
