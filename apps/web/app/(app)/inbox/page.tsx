import { Eyebrow } from "@facility/ui";
import { IssueCard } from "@/components/inbox/issue-card";
import { ProposalCard } from "@/components/inbox/proposal-card";
import { Offline } from "@/components/offline";
import { api } from "@/lib/api";

export const metadata = { title: "inbox" };

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string }>;
}) {
  const [{ focus }, inbox] = await Promise.all([searchParams, api.inboxFull()]);
  if (!inbox.ok) return inbox.offline ? <Offline /> : <Offline detail={inbox.message} />;

  const { proposals, issues } = inbox.data;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Eyebrow>inbox</Eyebrow>
        <h1 className="text-[clamp(24px,3.6vw,40px)] font-semibold leading-[1.08] tracking-[-0.02em]">
          People decide twice.
        </h1>
        <p className="max-w-xl text-sm leading-relaxed text-(--mut)">
          Every request an agent needs a human for lands here: plan acceptances, learning-mode
          validations, kickstart reviews, budget overrides. Approving dispatches the action;
          everything is recorded in the ledger. Watchtower issues surface here too.
        </p>
      </div>

      {proposals.length === 0 && issues.length === 0 ? (
        <p className="text-sm text-(--dim)">Inbox zero. Both gates are clear.</p>
      ) : (
        <div className="flex max-w-3xl flex-col gap-10">
          <section className="flex flex-col gap-4">
            <div className="flex items-baseline justify-between">
              <Eyebrow>gates · {proposals.length}</Eyebrow>
            </div>
            {proposals.length === 0 ? (
              <p className="text-sm text-(--dim)">No decisions waiting.</p>
            ) : (
              <div className="flex flex-col gap-4">
                {proposals.map((p) => (
                  <ProposalCard key={p.id} proposal={p} focused={p.id === focus} />
                ))}
              </div>
            )}
          </section>

          {issues.length > 0 ? (
            <section className="flex flex-col gap-4">
              <div className="flex items-baseline justify-between">
                <Eyebrow className="text-(--bad)">issues · {issues.length}</Eyebrow>
                <span className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-(--dim)">
                  from watchtower
                </span>
              </div>
              <div className="flex flex-col gap-4">
                {issues.map((issue) => (
                  <IssueCard key={issue.id} issue={issue} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
