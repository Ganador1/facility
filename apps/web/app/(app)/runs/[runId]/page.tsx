import { ErrorNotice, Offline } from "@/components/offline";
import { RunCockpit } from "@/components/run/cockpit";
import { api } from "@/lib/api";

export const metadata = { title: "run" };

export default async function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const [run, me, events] = await Promise.all([api.run(runId), api.me(), api.runEvents(runId)]);

  if (!run.ok) {
    return run.offline ? <Offline /> : <ErrorNotice message={`run not found (${run.status})`} />;
  }

  const r = run.data;
  const [project, agents] = await Promise.all([
    api.project(r.projectId),
    api.projectAgents(r.projectId),
  ]);
  const agentDisplayName = agents.ok
    ? agents.data.find((agent) => agent.id === r.agentDefId)?.name
    : undefined;

  return (
    <RunCockpit
      run={r}
      project={project.ok ? project.data : null}
      agentDisplayName={agentDisplayName}
      permissions={me.ok ? me.data.permissions : []}
      initialEvents={events.ok ? events.data : []}
      initialEventsError={!events.ok}
    />
  );
}
