import type { Member } from "@/lib/api";

/** Read-only roster for v1 — invite/role-change land with the org-admin pass. */
export function MembersList({ members }: { members: Member[] }) {
  if (members.length === 0) {
    return <p className="text-sm text-(--dim)">No members yet.</p>;
  }
  return (
    <div className="flex flex-col border border-(--line)">
      {members.map((m) => (
        <div
          key={m.userId}
          className="flex items-center gap-4 border-b border-(--line) px-4 py-3 last:border-b-0"
        >
          <span className="font-mono text-[13px] text-(--ink)">{m.email}</span>
          {m.name ? <span className="text-[12px] text-(--mut)">{m.name}</span> : null}
          <span className="ml-auto font-mono text-[10.5px] uppercase tracking-[0.18em] text-(--dim)">
            {m.roleName ?? m.roleId}
          </span>
        </div>
      ))}
    </div>
  );
}
