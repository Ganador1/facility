import { Suspense } from "react";
import { Offline } from "@/components/offline";
import { SessionsWorkspace, type SessionThread } from "@/components/product/sessions-workspace";
import { LiveRefresh } from "@/components/shell/live-refresh";
import { untypedApi } from "@/lib/api";
import { ProductTabs } from "../tabs";

export const metadata = { title: "sessions" };

type ThreadRow = SessionThread & { kind?: string };

export default async function ProductSessionsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const conversations = await untypedApi<ThreadRow[]>(
    "GET",
    `/v1/projects/${projectId}/conversations`,
  );
  if (!conversations.ok && conversations.offline) return <Offline />;

  const threads = (conversations.ok ? conversations.data : []).filter(
    (thread) => thread.kind === "assistant",
  );

  return (
    // App-shell layout: menu → tab → content; fixed composer, scrolling thread.
    <div className="flex h-[calc(100dvh-9.5rem)] min-h-[480px] flex-col gap-5">
      <LiveRefresh seconds={60} />
      <ProductTabs />

      <div className="min-h-0 flex-1">
        <Suspense>
          <SessionsWorkspace projectId={projectId} threads={threads} />
        </Suspense>
      </div>
    </div>
  );
}
