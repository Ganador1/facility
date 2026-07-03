import { Cell, Eyebrow, HairlineGrid, PillTag } from "@facility/ui";
import Link from "next/link";
import { Offline } from "@/components/offline";
import { api } from "@/lib/api";

export const metadata = { title: "projects" };

export default async function ProjectsPage() {
  const projects = await api.projects();
  if (!projects.ok) return <Offline detail={projects.message} />;

  const items = projects.data;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Eyebrow>projects</Eyebrow>
          <h1 className="text-[clamp(24px,3.6vw,40px)] font-semibold leading-[1.08] tracking-[-0.02em]">
            Everything governed, per project.
          </h1>
        </div>
        <Link
          href="/projects/new"
          className="group relative inline-flex h-10 items-center border border-(--accent) px-6 font-mono text-[12px] uppercase tracking-[0.22em] text-(--accent)"
        >
          <span className="absolute inset-0 origin-left scale-x-0 bg-(--accent) transition-transform duration-300 group-hover:scale-x-100" />
          <span className="relative z-10 transition-colors group-hover:text-black">kickstart</span>
        </Link>
      </div>

      {items.length === 0 ? (
        <p className="max-w-lg text-sm leading-relaxed text-(--dim)">
          No projects yet. Kickstart writes the full factory into a repo — workflows, guards,
          skills, the standard — and registers it here for governance.
        </p>
      ) : (
        <HairlineGrid cols="sm:grid-cols-2 lg:grid-cols-3">
          {items.map((project) => (
            <Cell key={project.id} interactive className="p-0">
              <Link
                href={`/projects/${project.id}`}
                className="flex h-full flex-col gap-4 p-6 sm:p-8"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-[14px] font-medium text-(--ink)">
                    {project.slug}
                  </span>
                  {project.status === "archived" ? <PillTag>archived</PillTag> : null}
                </div>
                <p className="line-clamp-3 flex-1 text-[13px] leading-relaxed text-(--mut)">
                  {project.description ?? "—"}
                </p>
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--dim)">
                  system {project.systemVersion ?? "unpinned"}
                </span>
              </Link>
            </Cell>
          ))}
        </HairlineGrid>
      )}
    </div>
  );
}
