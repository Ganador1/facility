---
title: CLI
---

# CLI

One binary, two lives: the vendored installer it always was, and a client
for your platform.

```bash
npx @theam/facility <command>
```

## Vendored lane (no platform required)

| command | does |
|---|---|
| `init` | install the method into a repo (asks six questions, writes the files, prints the human steps) |
| `add <module>` | add a quality module (database, analytics, ai-queryability, design-system) |
| `doctor` | check the install and list what's left |

## Platform lane

| command | does |
|---|---|
| `login` | store API URL + key (`~/.facility/config.json`, profiles supported) |
| `status` | org overview: live runs, open inbox, spend, issues |
| `projects list\|get` | project inventory |
| `runs list\|watch\|trigger\|steer` | run control — `watch` tails the live session in your terminal |
| `inbox` / `inbox decide` | the human gates, scriptable |
| `kickstart` / `upgrade` | remote kickstart and upgrade PRs |
| `keys issue\|list\|revoke` | machine access |

Every platform command takes `--json` for automation. Exit codes: `0` ok,
`1` error, `2` auth.
