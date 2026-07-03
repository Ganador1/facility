import { Offline } from "@/components/offline";
import { api } from "@/lib/api";
import { Eyebrow, PillTag } from "@facility/ui";

export const metadata = { title: "settings" };

export default async function SettingsPage() {
  const me = await api.me();
  if (!me.ok) return <Offline detail={me.message} />;

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-2">
        <Eyebrow>settings</Eyebrow>
        <h1 className="text-[clamp(24px,3.6vw,40px)] font-semibold leading-[1.08] tracking-[-0.02em]">
          {me.data.org.name}
        </h1>
      </div>

      <section className="flex max-w-2xl flex-col gap-4">
        <Eyebrow>your access</Eyebrow>
        <div className="flex flex-col gap-3 border border-(--line) p-6">
          <div className="flex items-center justify-between">
            <span className="text-sm text-(--mut)">signed in as</span>
            <span className="font-mono text-[13px] text-(--ink)">{me.data.email}</span>
          </div>
          <div className="flex items-start justify-between gap-6">
            <span className="text-sm text-(--mut)">permissions</span>
            <div className="flex max-w-md flex-wrap justify-end gap-1.5">
              {me.data.permissions.map((p) => (
                <span key={p} className="font-mono text-[10.5px] text-(--dim)">
                  {p}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="flex max-w-2xl flex-col gap-4">
        <Eyebrow>coming online in this build</Eyebrow>
        <div className="flex flex-wrap gap-2">
          {["members & roles", "api keys", "provider credentials", "budgets", "integrations"].map(
            (s) => (
              <PillTag key={s}>{s}</PillTag>
            ),
          )}
        </div>
        <p className="text-sm leading-relaxed text-(--dim)">
          These surfaces ship with the control-plane management pass; the API endpoints already
          exist and are governed by RBAC.
        </p>
      </section>
    </div>
  );
}
