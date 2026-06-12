# Capataz brand

Capataz is a **TAM-50** product of The Agile Monkeys' brand system: its own
face on the TAM technical layer, with the TAM relationship named in the
footer signature. This file is the single reference for anyone producing
Capataz surfaces (README, docs site, decks, social cards).

## Name

**capataz** — always lowercase in the wordmark, sentence case ("Capataz") in
prose. /ka·pa·TAS/. Spanish for the foreman who runs a construction crew on
behalf of the owner. The metaphor is load-bearing and product-wide:

| construction | capataz |
|---|---|
| the architect | `@architect` — plans before anyone builds |
| the crew | `@builder` and the review/address agents |
| the building code | `STANDARD.md` |
| inspections | guards + the PR reviewer |
| an equipped job site | the provisioned environment |
| the owner's signature | the human approval and merge |

Tagline: **"An AI crew for your repo, under your command."**
Supporting line: "Agents do the work. You sign it."

## Palette (roles, per TAM-50)

| role | value | use |
|---|---|---|
| ink (product primary) | `#1A1714` | text, the mark's body, dark surfaces |
| surface | `#FAF7F2` | backgrounds, vial stroke on ink |
| accent | `#E8590C` (safety orange) | the bubble, CTAs, status marks, badge color — always with a role, never decoration |
| line_soft | `#D8D2C8` | soft separators, derived from surface contrast |

Few colors, clear roles, the accent repeated only where it means the same
thing (the centered bubble = "passes inspection"). No gradients as
decoration, no hard black dividers between every section.

## Mark

A spirit level with the bubble dead center — *built to code*. Geometry only
(`assets/mark.svg`), 4px radius per TAM imagery treatment, no strokes around
it, no drop shadows. The wordmark (`assets/wordmark-{light,dark}.svg`) sets
the name in the mono technical voice next to the mark, with an orange full
stop.

## Typography

Inherited TAM layer, selected by role (TAM-50):

- **IBM Plex Sans** — commercial body copy, docs prose, explanation.
- **IBM Plex Mono** — the technical voice: CLI output, code, file trees,
  labels, the wordmark. Mono is not the voice of every surface.
- **Neue Galano Light** — display headlines on commercial web surfaces only
  (a future landing page). Not used in the repo, which is a technical surface.

Do not introduce other typefaces. Font *files* are licensed assets and do not
live in this repository.

## Voice

Sensei, not startup (TAM `foundations/voice.md`): open with the failure mode,
make the reader feel recognized, be calmly opinionated, zero hype, no
"revolutionary/seamless/AI-powered", no contrarian one-liner templates, end
with implication rather than summary. CLI copy follows the same posture:
restrained, precise, one accent color, no slot-machine output.

## Signature (non-negotiable for tier membership)

Every published Capataz surface closes with the TAM-50 footer signature:
the product mark plus the live-text line
**"An initiative by [The Agile Monkeys](https://theagilemonkeys.com)"** —
IBM Plex, WCAG AA contrast on its surface, composed into the footer, never a
floating badge. The README footer is the canonical instance.
