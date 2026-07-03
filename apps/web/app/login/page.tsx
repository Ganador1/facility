"use client";

import { Button, Eyebrow, Field, TextInput } from "@facility/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function devLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/dev-login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? `login failed (${res.status})`);
      }
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-10 px-6">
      <div className="flex flex-col gap-3">
        <span className="font-mono text-[22px] font-semibold tracking-tight">
          facility<span className="text-(--accent)">.</span>
        </span>
        <p className="text-sm leading-relaxed text-(--mut)">
          Agents build. People decide twice. Everything gets measured.
        </p>
      </div>

      <div className="flex flex-col gap-6">
        <a
          href="/api/auth/login"
          className="group relative inline-flex h-[52px] items-center justify-center border border-(--accent) px-10 font-mono text-[12px] uppercase tracking-[0.22em] text-(--accent)"
        >
          <span className="absolute inset-0 origin-left scale-x-0 bg-(--accent) transition-transform duration-300 group-hover:scale-x-100" />
          <span className="relative z-10 transition-colors group-hover:text-black">
            continue with sso
          </span>
        </a>

        <div className="flex items-center gap-4">
          <span className="h-px flex-1 bg-(--line)" />
          <Eyebrow>or local dev</Eyebrow>
          <span className="h-px flex-1 bg-(--line)" />
        </div>

        <form onSubmit={devLogin} className="flex flex-col gap-4">
          <Field label="email" error={error ?? undefined}>
            <TextInput
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@theagilemonkeys.com"
              autoComplete="email"
            />
          </Field>
          <Button type="submit" variant="outline" disabled={busy}>
            {busy ? "signing in…" : "dev sign in"}
          </Button>
        </form>
      </div>

      <p className="font-mono text-[10px] leading-relaxed text-(--dim)">
        An initiative by{" "}
        <a href="https://theagilemonkeys.com" className="underline-offset-4 hover:underline">
          The Agile Monkeys
        </a>
      </p>
    </div>
  );
}
