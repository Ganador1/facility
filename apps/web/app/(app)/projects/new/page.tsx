"use client";

import { Button, Eyebrow, Field, TextArea, TextInput } from "@facility/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function NewProjectPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          slug: slug || undefined,
          description: description || undefined,
        }),
      });
      const body = (await res.json().catch(() => null)) as {
        id?: string;
        error?: { message?: string };
      } | null;
      if (!res.ok || !body?.id) {
        throw new Error(body?.error?.message ?? `create failed (${res.status})`);
      }
      router.push(`/projects/${body.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "create failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex max-w-xl flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Eyebrow>kickstart</Eyebrow>
        <h1 className="text-[clamp(24px,3.6vw,40px)] font-semibold leading-[1.08] tracking-[-0.02em]">
          A new project.
        </h1>
        <p className="text-sm leading-relaxed text-(--mut)">
          This registers the project for governance. Connecting a repository and writing the factory
          assets (workflows, guards, skills, the standard) happens next, once the GitHub App is
          installed — you'll be walked through it from the project page.
        </p>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-5">
        <Field label="name">
          <TextInput
            required
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slug) {
                // suggest, never force — the field stays editable
              }
            }}
            placeholder="TAM OS"
          />
        </Field>
        <Field label="slug" hint="lowercase identifier; defaults from the name">
          <TextInput
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="tam-os"
            pattern="[a-z0-9-]*"
          />
        </Field>
        <Field label="description">
          <TextArea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this project is, for the humans and the agents."
          />
        </Field>
        {error ? <p className="font-mono text-[11px] text-(--bad)">{error}</p> : null}
        <div>
          <Button type="submit" variant="primary" size="lg" disabled={busy || !name}>
            {busy ? "creating…" : "create project"}
          </Button>
        </div>
      </form>
    </div>
  );
}
