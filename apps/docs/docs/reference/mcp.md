---
title: MCP
---

# MCP server

Manage Facility from Claude Code, Cowork, Codex, or any MCP client — with
the same RBAC and audit as every other surface.

## Connect

Local (stdio):

```json
{
  "mcpServers": {
    "facility": {
      "command": "npx",
      "args": ["-y", "@facility/mcp"],
      "env": {
        "FACILITY_API_URL": "https://facility.yourorg.com",
        "FACILITY_API_KEY": "fak_…"
      }
    }
  }
}
```

Remote: streamable HTTP at `https://<mcp-host>/mcp` with
`Authorization: Bearer fak_…`.

## Tools

Reads: `facility_me`, `facility_list_projects`, `facility_list_runs`,
`facility_get_run`, `facility_list_inbox`, `facility_spend`,
`facility_list_registry`, `facility_list_issues`, `facility_audit_tail`, …

Writes — **all confirmation-gated**: `facility_trigger_run`,
`facility_steer_run`, `facility_decide_proposal`, `facility_kickstart`,
`facility_set_budget`, `facility_publish_registry_version`, …

## The confirmation pattern

A write tool called without a token returns a summary and a short-lived
confirmation token, and does nothing. The client (or the human behind it)
calls again with the token to execute. One-shot destructive tool calls are
structurally impossible — the same production pattern the tam-os MCP uses.
