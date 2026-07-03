import type { Principal } from "@/lib/api";
import { PillTag } from "@facility/ui";

export function Topbar({ principal }: { principal: Principal }) {
  return (
    <header className="hidden items-center justify-between border-b border-(--line) px-8 py-4 lg:flex">
      <div className="flex items-center gap-3">
        <PillTag>{principal.org.name}</PillTag>
      </div>
      <div className="flex items-center gap-4">
        <span className="font-mono text-[11px] text-(--dim)">{principal.email}</span>
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
