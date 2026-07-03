"use client";

import { Button, Field, Select, TextInput } from "@facility/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ApiKey, Role } from "@/lib/api";

/**
 * Issue and revoke API keys. The secret is shown exactly once, on creation —
 * the server only ever stores its hash.
 */
export function KeysManager({ keys, roles }: { keys: ApiKey[]; roles: Role[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [roleId, setRoleId] = useState(roles[0]?.id ?? "");
  const [issued, setIssued] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function issue(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, roleId }),
      });
      const body = (await res.json().catch(() => null)) as {
        secret?: string;
        error?: { message?: string };
      } | null;
      if (!res.ok || !body?.secret)
        throw new Error(body?.error?.message ?? `failed (${res.status})`);
      setIssued(body.secret);
      setName("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    await fetch(`/api/v1/keys/${id}`, { method: "DELETE" });
    router.refresh();
  }

  const live = keys.filter((k) => !k.revokedAt);

  return (
    <div className="flex flex-col gap-5">
      {issued ? (
        <div className="flex flex-col gap-2 border border-(--accent) bg-(--bg-subtle) p-4">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-(--accent)">
            copy this now — shown once
          </span>
          <code className="break-all font-mono text-[13px] text-(--ink)">{issued}</code>
          <button
            type="button"
            onClick={() => setIssued(null)}
            className="self-start font-mono text-[10.5px] uppercase tracking-[0.2em] text-(--mut) hover:text-(--ink)"
          >
            dismiss
          </button>
        </div>
      ) : null}

      <form onSubmit={issue} className="flex flex-wrap items-end gap-3">
        <Field label="new key name" className="flex-1">
          <TextInput
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ci-pipeline"
          />
        </Field>
        <Field label="role">
          <Select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" variant="primary" disabled={busy || !name || !roleId}>
          {busy ? "issuing…" : "issue key"}
        </Button>
      </form>
      {error ? <p className="font-mono text-[11px] text-(--bad)">{error}</p> : null}

      {live.length === 0 ? (
        <p className="text-sm text-(--dim)">No active keys.</p>
      ) : (
        <div className="flex flex-col border border-(--line)">
          {live.map((k) => (
            <div
              key={k.id}
              className="flex items-center gap-4 border-b border-(--line) px-4 py-3 last:border-b-0"
            >
              <span className="font-mono text-[13px] text-(--ink)">{k.name}</span>
              <span className="font-mono text-[11px] text-(--dim)">
                {k.prefix}…{k.last4}
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-(--dim)">
                {k.scopeType}
              </span>
              <button
                type="button"
                onClick={() => revoke(k.id)}
                className="ml-auto font-mono text-[10.5px] uppercase tracking-[0.2em] text-(--mut) hover:text-(--bad)"
              >
                revoke
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
