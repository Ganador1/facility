import { Eyebrow } from "@facility/ui";
import { Suspense } from "react";
import { ErrorNotice, Offline } from "@/components/offline";
import { ProductWorkspace } from "@/components/product/workspace";
import { LiveRefresh } from "@/components/shell/live-refresh";
import { api, untypedApi } from "@/lib/api";
import type { KbDecision, KbEntry, KbSpace } from "@/lib/kb";

export const metadata = { title: "product" };

type IntakeTrigger = { type?: string; entryId?: string };

export type ProductThread = {
  id: string;
  title: string | null;
  kind?: string;
  updatedAt?: string;
};

export default async function ProductPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const [space, entries, decisions, runs, me, conversations] = await Promise.all([
    api.kbSpace(projectId),
    api.kbEntries(projectId),
    api.kbDecisions(projectId),
    api.runs(projectId),
    api.me(),
    untypedApi<ProductThread[]>("GET", `/v1/projects/${projectId}/conversations`),
  ]);

  if (!space.ok && space.offline) return <Offline />;

  const canWriteKb =
    me.ok && me.data.permissions.some((p) => p === "*" || p === "kb:write" || p === "kb:*");

  // Signals link to the review run their intake dispatched.
  const signalRuns: Record<string, string> = {};
  for (const run of runs.ok ? runs.data : []) {
    const trigger = run.trigger as IntakeTrigger | null;
    if (trigger?.type === "kb_intake" && typeof trigger.entryId === "string") {
      signalRuns[trigger.entryId] ??= run.id;
    }
  }

  const kbSpace = (space.ok ? space.data : { charterMd: "", activeMd: "" }) as KbSpace;
  const kbEntries = (entries.ok ? entries.data : []) as unknown as KbEntry[];
  const kbDecisions = (decisions.ok ? decisions.data : []) as unknown as KbDecision[];
  // Assistant threads only — sandbox-conversation rows are agent plumbing.
  const threads = (conversations.ok ? conversations.data : []).filter(
    (thread) => thread.kind === "assistant",
  );

  return (
    <div className="flex flex-col gap-8">
      <LiveRefresh seconds={60} />
      <div className="flex flex-col gap-2">
        <Eyebrow>product</Eyebrow>
        <h1 className="text-[clamp(22px,3vw,32px)] font-semibold tracking-tight">Product</h1>
        <p className="text-[12.5px] text-(--dim)">
          the project's knowledge base — decisions, documentation, and the signals they came from
        </p>
      </div>

      {!space.ok || !entries.ok ? (
        <ErrorNotice
          message={`Couldn't load the knowledge base — ${!space.ok ? space.message : entries.ok ? "" : entries.message}`}
        />
      ) : (
        <Suspense>
          <ProductWorkspace
            projectId={projectId}
            space={kbSpace}
            entries={kbEntries}
            decisions={kbDecisions}
            signalRuns={signalRuns}
            threads={threads}
            canWrite={canWriteKb}
          />
        </Suspense>
      )}
    </div>
  );
}
