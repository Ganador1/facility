import { Eyebrow } from "@facility/ui";
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
    <div className="flex flex-col gap-8">
      <LiveRefresh seconds={60} />
      <div className="flex flex-col gap-2">
        <Eyebrow>product</Eyebrow>
        <h1 className="text-[clamp(22px,3vw,32px)] font-semibold tracking-tight">Product</h1>
        <p className="text-[12.5px] text-(--dim)">
          chat sessions with the digital product owner — every exchange kept, every thread resumable
        </p>
      </div>

      <ProductTabs />

      <Suspense>
        <SessionsWorkspace projectId={projectId} threads={threads} />
      </Suspense>
    </div>
  );
}
