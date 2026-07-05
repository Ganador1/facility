import { PillTag } from "@facility/ui";
import type { Me } from "@/lib/api";

export function Topbar({ me }: { me: Me }) {
  return (
    <header className="hidden items-center justify-between border-b border-(--line) px-8 py-4 lg:flex">
      <div className="flex items-center gap-3">
        <PillTag>{me.org?.name ?? "Facility"}</PillTag>
      </div>
      <div className="flex items-center gap-4">
        <span className="font-mono text-[11px] text-(--dim)">{me.principal.email}</span>
        <form action="/api/auth/logout" method="post">
          <button
            type="submit"
            className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-(--mut) hover:text-(--ink)"
          >
            sign out
          </button>
        </form>
      </div>
    </header>
  );
}
