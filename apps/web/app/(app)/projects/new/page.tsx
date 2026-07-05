"use client";

import {
  Button,
  Cell,
  Divider,
  Eyebrow,
  Field,
  HairlineGrid,
  LegendChip,
  PillTag,
  StatusDot,
  TextArea,
  TextInput,
} from "@facility/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useMemo, useState } from "react";

type FlowMode = "greenfield" | "existing";
type Step = "project" | "connect" | "preview" | "confirm";

type Project = {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
};

type ProjectRepo = {
  id: string;
  projectId: string;
  owner: string;
  name: string;
  defaultBranch: string;
  installationId?: string | null;
  fingerprintStatus?: string | null;
};

type KickstartPreview = {
  detection?: {
    defaultBranch?: string;
    packageManager?: "pnpm" | "yarn" | "npm" | "none";
    checks?: string[];
    provision?: string;
    org?: string;
    workflowNames?: string[];
    suggestedModules?: string[];
    existing?: {
      agentsMd?: boolean;
      claudeMd?: boolean;
      claudeSettings?: boolean;
      standard?: boolean;
    };
  };
  files: Array<{
    path: string;
    size: number;
    sha256: string;
    mode?: string;
    action?: string;
  }>;
  skipped?: string[];
};

type KickstartAnswers = {
  defaultBranch?: string;
  provisionCmd?: string;
  checkCmds?: string[];
  modules?: string[];
  modelTier?: string;
  execution_lane?: Record<string, "repo" | "platform">;
};

type KickstartResult = {
  branch?: string;
  commitSha?: string;
  pr?: { number?: number; url?: string; html_url?: string };
};

const steps: Array<{ id: Step; label: string }> = [
  { id: "project", label: "project" },
  { id: "connect", label: "connect repo" },
  { id: "preview", label: "preview" },
  { id: "confirm", label: "confirm" },
];

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function splitRepo(value: string): { owner: string; name: string } | null {
  const [owner, name] = value
    .trim()
    .replace(/^https:\/\/github\.com\//, "")
    .replace(/\.git$/, "")
    .split("/");
  if (!owner || !name) return null;
  return { owner, name };
}

function repoFullName(repo: Pick<ProjectRepo, "owner" | "name">) {
  return `${repo.owner}/${repo.name}`;
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function installationMessage(fullName: string) {
  return `Repo "${fullName}" is not connected to this project. Connect it (GitHub App / web UI) first, then retry.`;
}

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });
  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const payload = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
    const error =
      payload?.error && typeof payload.error === "object"
        ? (payload.error as Record<string, unknown>)
        : null;
    const message =
      typeof error?.message === "string"
        ? error.message
        : typeof payload?.message === "string"
          ? payload.message
          : null;
    throw new Error(message ?? `${res.status} ${res.statusText}`);
  }
  return body as T;
}

function stepIndex(step: Step) {
  return steps.findIndex((item) => item.id === step);
}

export default function NewProjectPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("project");
  const [mode, setMode] = useState<FlowMode>("greenfield");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [repoInput, setRepoInput] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("main");
  const [project, setProject] = useState<Project | null>(null);
  const [repo, setRepo] = useState<ProjectRepo | null>(null);
  const [preview, setPreview] = useState<KickstartPreview | null>(null);
  const [result, setResult] = useState<KickstartResult | null>(null);
  const [busy, setBusy] = useState<Step | null>(null);
  const [error, setError] = useState<string | null>(null);

  const effectiveSlug = slug || slugify(name);
  const parsedRepo = splitRepo(repoInput);
  const owner = parsedRepo?.owner ?? "";
  const repoName = parsedRepo?.name ?? (mode === "greenfield" ? effectiveSlug : "");
  const activeIndex = stepIndex(step);
  const previewFiles = preview?.files ?? [];
  const answers = useMemo<KickstartAnswers>(() => {
    const detection = preview?.detection;
    return {
      defaultBranch: detection?.defaultBranch ?? repo?.defaultBranch ?? defaultBranch,
      provisionCmd: detection?.provision || undefined,
      checkCmds: detection?.checks?.length ? detection.checks : undefined,
      modules: detection?.suggestedModules?.length ? detection.suggestedModules : undefined,
      modelTier: "tam-50",
      execution_lane: { architect: "repo", builder: "repo" },
    };
  }, [defaultBranch, preview, repo]);

  function clearDownstream() {
    setRepo(null);
    setPreview(null);
    setResult(null);
  }

  async function createProject(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !effectiveSlug) return;
    setBusy("project");
    setError(null);
    try {
      const created = await apiJson<Project>("/v1/projects", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          slug: effectiveSlug,
          description: description.trim() || undefined,
          settings: { default_branch: defaultBranch, check_cmds: [] },
        }),
      });
      setProject(created);
      setStep("connect");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create project");
    } finally {
      setBusy(null);
    }
  }

  async function connectRepo(e: FormEvent) {
    e.preventDefault();
    if (!project || !owner || !repoName) return;
    setBusy("connect");
    setError(null);
    setPreview(null);
    setResult(null);
    const fullName = `${owner}/${repoName}`;
    try {
      const existing = await apiJson<ProjectRepo[]>(`/v1/projects/${project.id}/repos`);
      const match = existing.find(
        (item) =>
          item.id === fullName || repoFullName(item).toLowerCase() === fullName.toLowerCase(),
      );
      const connected =
        match ??
        (await apiJson<ProjectRepo>(`/v1/projects/${project.id}/repos`, {
          method: "POST",
          body: JSON.stringify({ owner, name: repoName, defaultBranch }),
        }));
      setRepo(connected);
      setDefaultBranch(connected.defaultBranch);
      setStep("preview");
      await loadPreview(project.id, connected);
    } catch (err) {
      setStep("connect");
      setError(err instanceof Error ? err.message : `Could not connect ${fullName}`);
    } finally {
      setBusy(null);
    }
  }

  async function loadPreview(projectId = project?.id, selectedRepo = repo) {
    if (!projectId || !selectedRepo) return;
    const fullName = repoFullName(selectedRepo);
    setBusy("preview");
    setError(null);
    setPreview(null);
    try {
      const nextPreview = await apiJson<KickstartPreview>(
        `/v1/projects/${projectId}/kickstart/preview?repoId=${encodeURIComponent(selectedRepo.id)}`,
      );
      setPreview(nextPreview);
      setStep("preview");
    } catch (err) {
      const raw = err instanceof Error ? err.message : "Could not generate preview";
      const message = /github installation|installation/i.test(raw)
        ? `${installationMessage(fullName)} The preview cannot read repository files until the GitHub App installation webhook has linked this repo.`
        : raw;
      setError(message);
      setStep("preview");
    } finally {
      setBusy(null);
    }
  }

  async function openPr() {
    if (!project || !repo || !preview) return;
    setBusy("confirm");
    setError(null);
    try {
      const kickstart = await apiJson<KickstartResult>(`/v1/projects/${project.id}/kickstart`, {
        method: "POST",
        body: JSON.stringify({ repoId: repo.id, answers, mode: "pr" }),
      });
      setResult(kickstart);
      setStep("confirm");
      router.refresh();
    } catch (err) {
      const raw = err instanceof Error ? err.message : "Could not open kickstart PR";
      const message =
        repo && /github installation|installation/i.test(raw)
          ? installationMessage(repoFullName(repo))
          : raw;
      setError(message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex max-w-6xl flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Eyebrow>kickstart</Eyebrow>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex max-w-2xl flex-col gap-3">
            <h1 className="text-[clamp(24px,3.6vw,40px)] font-semibold leading-[1.08]">
              Project to pull request.
            </h1>
            <p className="text-sm leading-relaxed text-(--mut)">
              Create the governed project, connect a GitHub repository, inspect the generated
              Facility assets, then open the kickstart PR.
            </p>
          </div>
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-(--dim)">
            <StatusDot tone={result ? "ok" : busy ? "agent" : "machine"} pulse={Boolean(busy)} />
            {result ? "PR opened" : busy ? "working" : "ready"}
          </div>
        </div>
      </div>

      <div className="grid gap-px border border-(--line) bg-(--line) sm:grid-cols-4">
        {steps.map((item, index) => (
          <button
            key={item.id}
            type="button"
            disabled={index > activeIndex || (index > 0 && !project)}
            onClick={() => setStep(item.id)}
            className="flex min-h-16 items-center justify-between gap-3 bg-(--bg) px-4 py-3 text-left transition-colors enabled:hover:bg-(--card) disabled:cursor-not-allowed disabled:opacity-45"
          >
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-(--dim)">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="min-w-0 flex-1 font-mono text-[11px] uppercase tracking-[0.18em] text-(--ink)">
              {item.label}
            </span>
            <StatusDot
              tone={
                index < activeIndex || (item.id === "confirm" && result)
                  ? "ok"
                  : item.id === step
                    ? "agent"
                    : "machine"
              }
            />
          </button>
        ))}
      </div>

      {error ? (
        <div className="border border-(--bad) bg-(--bg-subtle) p-4 text-sm leading-relaxed text-(--bad)">
          {error}
        </div>
      ) : null}

      {step === "project" ? (
        <form onSubmit={createProject} className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex flex-col gap-5">
            <div className="grid gap-px border border-(--line) bg-(--line) sm:grid-cols-2">
              <button
                type="button"
                onClick={() => {
                  setMode("greenfield");
                  clearDownstream();
                }}
                className="bg-(--bg) p-5 text-left transition-colors hover:bg-(--card)"
              >
                <div className="mb-4 flex items-center justify-between">
                  <LegendChip tone="agent">default</LegendChip>
                  <StatusDot tone={mode === "greenfield" ? "agent" : "machine"} />
                </div>
                <h2 className="text-base font-semibold text-(--ink)">Greenfield repo</h2>
                <p className="mt-2 text-[13px] leading-relaxed text-(--mut)">
                  Register the intended repo name now. Facility will generate the first governed
                  assets into a PR after the GitHub App can read the repo.
                </p>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("existing");
                  clearDownstream();
                }}
                className="bg-(--bg) p-5 text-left transition-colors hover:bg-(--card)"
              >
                <div className="mb-4 flex items-center justify-between">
                  <PillTag active={mode === "existing"}>existing</PillTag>
                  <StatusDot tone={mode === "existing" ? "agent" : "machine"} />
                </div>
                <h2 className="text-base font-semibold text-(--ink)">Existing repo</h2>
                <p className="mt-2 text-[13px] leading-relaxed text-(--mut)">
                  Point Facility at a repository that already has code. Detection will keep the
                  generated workflow defaults aligned with what is there.
                </p>
              </button>
            </div>

            <Field label="name">
              <TextInput
                required
                value={name}
                disabled={Boolean(project)}
                onChange={(event) => {
                  const next = event.target.value;
                  setName(next);
                  if (!slugTouched) setSlug(slugify(next));
                }}
                placeholder="TAM OS"
              />
            </Field>
            <Field
              label="slug"
              hint="Lowercase project identifier. Used as the greenfield repo default."
            >
              <TextInput
                required
                value={effectiveSlug}
                disabled={Boolean(project)}
                onChange={(event) => {
                  setSlugTouched(true);
                  setSlug(slugify(event.target.value));
                }}
                placeholder="tam-os"
                pattern="[a-z0-9-]+"
              />
            </Field>
            <Field label="description">
              <TextArea
                value={description}
                disabled={Boolean(project)}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What this project is, for the humans and the agents."
              />
            </Field>
            <div>
              <Button
                type="submit"
                variant="primary"
                tone="agent"
                size="lg"
                disabled={busy === "project" || !name.trim() || !effectiveSlug || Boolean(project)}
              >
                {busy === "project" ? "creating..." : project ? "created" : "create project"}
              </Button>
            </div>
          </div>

          <aside className="flex h-fit flex-col gap-4 border border-(--line) bg-(--bg-subtle) p-5">
            <Eyebrow>defaults</Eyebrow>
            <div className="flex items-center justify-between gap-4 font-mono text-[12px]">
              <span className="text-(--dim)">branch</span>
              <span className="text-(--code)">{defaultBranch}</span>
            </div>
            <div className="flex items-center justify-between gap-4 font-mono text-[12px]">
              <span className="text-(--dim)">repo mode</span>
              <span className="text-(--code)">
                {mode === "greenfield" ? "greenfield" : "existing"}
              </span>
            </div>
            <p className="text-[13px] leading-relaxed text-(--mut)">
              The web flow registers projects and repos, previews generated assets, and opens the
              PR. It does not create GitHub repositories.
            </p>
          </aside>
        </form>
      ) : null}

      {step === "connect" ? (
        <form onSubmit={connectRepo} className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex flex-col gap-5">
            <div className="border border-(--line) bg-(--bg-subtle) p-5">
              <div className="flex flex-col gap-2">
                <Eyebrow>project registered</Eyebrow>
                <p className="font-mono text-[15px] text-(--ink)">{project?.slug}</p>
                <p className="text-sm leading-relaxed text-(--mut)">
                  Next, provide the GitHub owner/name. If it is already connected to this project,
                  Facility will reuse that repo id; otherwise it will register the repo row with the
                  existing API.
                </p>
              </div>
            </div>

            <Field
              label={mode === "greenfield" ? "intended repository" : "repository"}
              hint="Use owner/name or paste a github.com/owner/name URL."
            >
              <TextInput
                required
                value={repoInput}
                onChange={(event) => setRepoInput(event.target.value)}
                placeholder={
                  mode === "greenfield" ? `theam/${effectiveSlug || "new-repo"}` : "theam/facility"
                }
              />
            </Field>
            <Field label="default branch" hint="Sent as defaultBranch when a repo row is created.">
              <TextInput
                required
                value={defaultBranch}
                onChange={(event) => setDefaultBranch(event.target.value.trim() || "main")}
                placeholder="main"
              />
            </Field>

            <div className="flex flex-wrap gap-3">
              <Button type="button" variant="outline" onClick={() => setStep("project")}>
                back
              </Button>
              <Button
                type="submit"
                variant="primary"
                tone="agent"
                disabled={!project || !owner || !repoName || busy === "connect"}
              >
                {busy === "connect" ? "connecting..." : "connect repo"}
              </Button>
            </div>
          </div>

          <aside className="flex h-fit flex-col gap-4 border border-(--line) bg-(--bg-subtle) p-5">
            <Eyebrow>github app path</Eyebrow>
            <p className="text-sm leading-relaxed text-(--mut)">
              Install or update the Facility GitHub App for the selected owner and include this
              repository. After GitHub sends the installation event, retry preview.
            </p>
            <Divider />
            <p className="font-mono text-[11px] leading-relaxed text-(--dim)">
              {parsedRepo
                ? installationMessage(`${owner}/${repoName}`)
                : 'Repo "owner/name" is not connected to this project. Connect it (GitHub App / web UI) first, then retry.'}
            </p>
          </aside>
        </form>
      ) : null}

      {step === "preview" ? (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex min-w-0 flex-col gap-5">
            <div className="flex flex-col gap-3 border border-(--line) bg-(--bg-subtle) p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <Eyebrow>byte preview</Eyebrow>
                <p className="mt-2 break-all font-mono text-[15px] text-(--ink)">
                  {repo ? repoFullName(repo) : "no repo"}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={!project || !repo || busy === "preview"}
                onClick={() => void loadPreview()}
              >
                {busy === "preview" ? "loading..." : "retry"}
              </Button>
            </div>

            {preview ? (
              <>
                <HairlineGrid cols="grid-cols-2 lg:grid-cols-4">
                  <Cell className="p-4">
                    <MetricLike label="branch" value={answers.defaultBranch ?? "main"} />
                  </Cell>
                  <Cell className="p-4">
                    <MetricLike
                      label="package"
                      value={preview.detection?.packageManager ?? "none"}
                    />
                  </Cell>
                  <Cell className="p-4">
                    <MetricLike
                      label="checks"
                      value={String(preview.detection?.checks?.length ?? 0)}
                    />
                  </Cell>
                  <Cell className="p-4">
                    <MetricLike label="files" value={String(previewFiles.length)} tone="agent" />
                  </Cell>
                </HairlineGrid>

                <div className="flex flex-col border border-(--line)">
                  <div className="grid grid-cols-[minmax(0,1fr)_70px_88px] gap-3 border-b border-(--line) px-4 py-3 font-mono text-[10px] uppercase tracking-[0.18em] text-(--dim)">
                    <span>path</span>
                    <span>size</span>
                    <span>sha</span>
                  </div>
                  {previewFiles.map((file) => (
                    <div
                      key={`${file.path}:${file.sha256}`}
                      className="grid grid-cols-[minmax(0,1fr)_70px_88px] gap-3 border-b border-(--line) px-4 py-3 last:border-b-0"
                    >
                      <div className="min-w-0">
                        <div className="break-all font-mono text-[12px] text-(--ink)">
                          {file.path}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-2">
                          <PillTag>{file.action ?? "write"}</PillTag>
                          {file.mode ? <PillTag>{file.mode}</PillTag> : null}
                        </div>
                      </div>
                      <span className="font-mono text-[11px] text-(--mut)">
                        {formatBytes(file.size)}
                      </span>
                      <span className="break-all font-mono text-[10px] text-(--dim)">
                        {file.sha256.slice(0, 12)}
                      </span>
                    </div>
                  ))}
                </div>

                {preview.skipped?.length ? (
                  <div className="border border-(--line) p-4 text-[13px] leading-relaxed text-(--mut)">
                    Skipped existing managed sections: {preview.skipped.join(", ")}
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-3">
                  <Button type="button" variant="outline" onClick={() => setStep("connect")}>
                    back
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    tone="agent"
                    disabled={!previewFiles.length}
                    onClick={() => setStep("confirm")}
                  >
                    continue
                  </Button>
                </div>
              </>
            ) : (
              <div className="border border-(--line) bg-(--bg-subtle) p-6 text-sm leading-relaxed text-(--mut)">
                {busy === "preview"
                  ? "Reading repository files and rendering the generated asset preview..."
                  : "Preview is waiting for a connected repo. If the GitHub App was just installed, retry after the webhook lands."}
              </div>
            )}
          </div>

          <aside className="flex h-fit flex-col gap-4 border border-(--line) bg-(--bg-subtle) p-5">
            <Eyebrow>detected defaults</Eyebrow>
            <KeyValue label="provision" value={answers.provisionCmd || "none"} />
            <KeyValue label="checks" value={answers.checkCmds?.join(" / ") || "none"} />
            <KeyValue label="modules" value={answers.modules?.join(", ") || "base"} />
            <KeyValue label="lane" value="architect repo / builder repo" />
          </aside>
        </div>
      ) : null}

      {step === "confirm" ? (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex min-w-0 flex-col gap-5">
            <div className="border border-(--line) bg-(--bg-subtle) p-6">
              <Eyebrow>confirm</Eyebrow>
              <h2 className="mt-3 text-xl font-semibold text-(--ink)">
                {result ? "Kickstart PR opened." : "Open the kickstart PR."}
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-(--mut)">
                Facility will create a `facility/kickstart` branch, commit the generated assets
                listed in preview, and open a pull request against the repository default branch.
              </p>
            </div>

            {result ? (
              <div className="flex flex-col gap-4 border border-(--ok) bg-(--bg-subtle) p-5">
                <div className="flex items-center gap-3">
                  <StatusDot tone="ok" />
                  <span className="font-mono text-[12px] uppercase tracking-[0.18em] text-(--ok)">
                    success
                  </span>
                </div>
                <KeyValue label="branch" value={result.branch ?? "facility/kickstart"} />
                <KeyValue label="commit" value={result.commitSha?.slice(0, 12) ?? "created"} />
                {result.pr?.url || result.pr?.html_url ? (
                  <a
                    href={result.pr.url ?? result.pr.html_url}
                    target="_blank"
                    rel="noreferrer"
                    className="break-all font-mono text-[13px] text-(--ink) underline underline-offset-4"
                  >
                    {result.pr.url ?? result.pr.html_url}
                  </a>
                ) : null}
                {project ? (
                  <Link
                    href={`/projects/${project.id}`}
                    className="font-mono text-[11px] uppercase tracking-[0.18em] text-(--mut) hover:text-(--ink)"
                  >
                    view project -&gt;
                  </Link>
                ) : null}
              </div>
            ) : (
              <div className="flex flex-wrap gap-3">
                <Button type="button" variant="outline" onClick={() => setStep("preview")}>
                  back
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  tone="agent"
                  size="lg"
                  disabled={!project || !repo || !preview || busy === "confirm"}
                  onClick={() => void openPr()}
                >
                  {busy === "confirm" ? "opening..." : "open PR"}
                </Button>
              </div>
            )}
          </div>

          <aside className="flex h-fit flex-col gap-4 border border-(--line) bg-(--bg-subtle) p-5">
            <Eyebrow>summary</Eyebrow>
            <KeyValue label="project" value={project?.slug ?? "none"} />
            <KeyValue label="repo" value={repo ? repoFullName(repo) : "none"} />
            <KeyValue label="files" value={String(previewFiles.length)} />
            <KeyValue label="mode" value="pr" />
          </aside>
        </div>
      ) : null}
    </div>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 border-b border-(--line) pb-3 last:border-b-0 last:pb-0">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--dim)">
        {label}
      </span>
      <span className="break-words font-mono text-[12px] leading-relaxed text-(--code)">
        {value}
      </span>
    </div>
  );
}

function MetricLike({ label, value, tone }: { label: string; value: string; tone?: "agent" }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--dim)">
        {label}
      </span>
      <span
        className={
          tone === "agent" ? "font-mono text-xl text-(--accent)" : "font-mono text-xl text-(--ink)"
        }
      >
        {value}
      </span>
    </div>
  );
}
