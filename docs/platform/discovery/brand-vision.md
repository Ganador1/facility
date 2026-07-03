# Discovery dossier: TAM-50 brand system + AI SDLC vision

*Explore-agent digest, 2026-07-03. Sources: theam/theam-ai-sdlc (sdlc.theagilemonkeys.com source) + theam/brand-system (SSOT, skill v0.2.6). All hex values byte-verified against both CSS and WebGL/three.js code.*

## Site stack (the platform web app should match this generation)

Next.js 16.2 App Router · React 19.2 · TypeScript 5 · **Tailwind CSS v4 (CSS-first, tokens in `globals.css` `@theme inline`, no tailwind.config)** · framer-motion 12 · lenis smooth scroll · pnpm · fonts via `next/font/google` (IBM Plex Mono 400/500/600, IBM Plex Sans 400/500/600/700) · PostHog proxied first-party at `/ingest/*`.

## Color tokens (canonical, dark-only on the site)

| Token | Value | Role |
|---|---|---|
| `bg` | `#000000` | canvas |
| `bg-subtle` | `#0d1117` | terminal/code bg (= TAM syntax.background) |
| `card` | `#161b22` | card surfaces (= TAM-100 black_subtle) |
| `ink` | `#ffffff` | primary text |
| `mut` | `#999999` | secondary text (= gray_medium_dark) |
| `dim` | `#5c6570` | tertiary labels/counters |
| `line` | `rgba(255,255,255,.14)` | hairline borders |
| `line-strong` | `rgba(255,255,255,.28)` | emphasis borders |
| `accent` | `#FFD923` | **agent work + focus ONLY — never decoration** |
| `human` | `#FFB238` | human gates (warning.dark) |
| `ok` | `#2FBF71` | success (success.dark) |
| `bad` | `#FF6B60` | failure (critical.dark) |
| `info` | `#79C0FF` | info / ephemeral envs (info.dark) |
| scene neutrals | `#C8CFD8` (code/data), `#8A93A0` (deterministic machinery) | legend colors |

Light-mode TAM-100 primitives if ever needed: `#F5F5F5` gray_light, `#787878` gray_medium, `#0000FF` link_blue, `#707070` signature gray.

Legend semantics used product-wide: **AI = yellow, HUMAN = orange, CODE/deterministic = gray**.

## Typography

- IBM Plex Sans (prose/UI) + IBM Plex Mono (all technical chrome: labels, eyebrows, metrics, terminals, code). IBM Plex Serif exists in TAM but unused here. Neue Galano is proprietary (licensed) — NOT used on the site, NOT to be committed to this repo. Montserrat is the unlicensed fallback.
- **Weight rule: "Medium yes. Bold no."** — emphasis is 500/600; body 400. Site headlines are Sans 600.
- Site type patterns: hero `clamp(34px,5vw,72px)/0.98, -0.03em`; section h2 `clamp(26px,4vw,48px)/1.08, -0.02em`; metric counters `clamp(34-40px,4-5vw,52-64px)` **always mono + `tabular-nums`**; body 12.5–15px `leading-relaxed`.
- `.eyebrow`: mono 11px uppercase tracking `0.24em` color mut. Numeral anchors: mono, zero-padded `01`…, accent or dim.
- TAM-100 pt scale for reference: h1 40/45, h2 30/40, body1 20/30, body2 14/20, caps-titles 14/+5%, buttons 14.

## Layout rules

- Spacing scale 4/8/12/16/24/32/48/64/96/128; between sections 64–128px (site uses `py-28` = 112px).
- **Radii: 0 (buttons/inputs/separators — site is all-square), 4px max (cards/callouts), pill EXCLUSIVELY for pill_tag.** Never invent 8/12/16.
- **Shadows: none, ever.** Elevation = 1px border or surface tint.
- Breakpoints: Tailwind defaults ≈ TAM sm:640/md:1024/lg:1440, mobile-first.
- Focus: never hidden — `box-shadow: 0 2px 0 0 var(--accent)` underline-style ring (accent_focus rule). WCAG 2.2 AA floor.
- Reduced motion: global kill-switch + `useReducedMotion()` fallbacks for every animated component.

## Signature motifs (make the platform look like the site)

1. **Hairline-grid cards**: parent `grid gap-px border border-(--line) bg-(--line)`, children `bg-card p-8` — 1px seams, no per-card borders.
2. Eyebrow → big reveal headline → mut paragraph section pattern; sections separated by `border-t border-(--line)`, never boxed.
3. Mono uppercase micro-labels everywhere; zero-padded numbering (`01`–`05`, `00 / 11 · scroll`).
4. Grain overlay: fixed, `opacity:0.05`, SVG feTurbulence data-URI.
5. Terminal component: `bg-subtle` + header bar (mono 10px uppercase) + status-colored mono lines + blinking cursor; typewriter 13ms/char.
6. Buttons: squared; primary = `h-[52px] border border-accent px-10 mono 12px uppercase tracking .22em text-accent` with **sliding accent fill on hover (origin-left scale-x)**, text flips black. Header chip variant: `border-(--line)` → accent on hover.
7. Hand-drawn stroke SVG pictograms (`strokeWidth 2.6, no fill, round caps`); 3D/diagrams are unlit wireframes + additive glow, semantic palette only.
8. Animations: reveal `opacity 0,y:28 → 1,0` 0.8s ease `[0.2,0.7,0.2,1]`; per-word rise `y:110%→0` stagger 0.028s; count-up cubic ease-out 1.2s; spring progress hairline top of page (2px accent).

## Assets to copy

- `theam-ai-sdlc/public/tam-wordmark.svg` (= brand-system canonical, currentColor, min height 36px, never live text; below 36px use `t•` symbol min 16px 1:1) · `tam-symbol-256.png` · favicons from `brand-system/skills/tam-brand-system/assets/tam-icons/favicon/favicon-{positive,negative}.ico` + PNG ladders 16→1024.
- IBM Plex woff2 set: `brand-system/.../assets/typography/ibm-plex/{sans,mono,serif}/*.woff2` (OFL — safe to vendor). Neue Galano files are license-restricted: never commit.
- Facility's own mark/wordmark already in `assets/` of this repo.

## Tier rule (from brand-system)

TAM-50 = product has its own face on the TAM technical layer. Inherits unnegotiably from TAM-100: typography families+scale, component catalog (button/text_field/pill_tag/callout/eyebrow/numeral_anchor), spacing/grid/breakpoints, IBM UI Icons, signature composition. Free: color, imagery, backgrounds, accents. **Fixed signature: product logo + live-text "An initiative by The Agile Monkeys" in the footer.** Resolve all primitives against TAM-100.design.md; TAM-50.design.md is an allowlist, not a standalone spec.

## Component quick-specs (from extract-components.ts ground truth)

- Button: h 40px, radius 0–4, mono 14 title-case (no CAPS), nowrap, pad 12×24/32/80; variants primary (solid), outline (1px), textual (trailing →). Focus = 2px accent stroke.
- Text field: h 40px; `boxed` (uppercase label, 1px border, surface_secondary bg) XOR `underline_only` (title-case floating label); never mix in one form; errors = critical color.
- Pill tag: h 32px, radius full — the only pill; toggle or category; never color-differentiate categories.
- Callout: pad 48, gap 24, radius 4, bg surface_secondary, no border/shadow, one CTA max, order eyebrow→heading→body→button.

## Vision vocabulary (speak the site's language verbatim)

- Master thesis: *"AI agents carry every change from signal to production; people decide what ships. Every run leaves a receipt."*
- The loop (12 beats, 3 chapters: **the loop · defense in depth · self-observation**): signal/intake → the board (named owner, forward-only, agents act on a person's behalf) → the architect (plans against a live copy) → **human gate 1** (accept the plan, decision 1 of 2) → the builder (disposable sandbox, opens the PR itself) → preview env per PR → defense in depth (contract + 5 specialist reviewers + 18 deterministic guards + full build) → **human gate 2** (machines test, a person signs) → production → self-observation.
- Self-observation instruments: **run receipts** (every run; cost/tokens/duration/checks; never prompts, never code), **outcome collector** (nightly), **health monitor** (daily, budgets, incident issue), **the canary** (weekly synthetic flight). **The ratchet**: recurring failures become guards; "the guard set only grows." *"The models are interchangeable; the harness is not."*
- Evidence definitions: Accepted = human squash-merged (agents cannot merge); One-shot = zero change requests + zero fixup commits. Canonical numbers: 90% acceptance, 57% one-shot, 0 reverts/11mo, 22h median, 18 guards, lanes Claude 86% / Codex 100% / Copilot(retired) 60%, autonomous lane ≈18% of shipped work.
- Archetypes (not job titles): the prototyper (*ships questions*), the builder (*makes it real*), the optimizer (*removes weight*), the grower (*compounds usage*), the maintainer (*keeps it true*). "Each archetype maintains the part of the system it depends on."
- CTA promise: *"We are open-sourcing this system — the gates, the guards, the receipts, the self-observation layer."* (Facility platform IS that promise.)
