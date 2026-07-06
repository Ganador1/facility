---
title: MCP
---

# MCP server

Manage Facility from Claude Code, Cowork, Codex, or any MCP client — with
the same RBAC and audit as every other surface.

## Connect

Local (stdio). `@facility/mcp` is not published to a public registry, so build it
from the repo (`pnpm --filter @facility/mcp build`) and point the client at the
built binary (`packages/mcp/dist/bin/facility-mcp.js`). With no subcommand it
speaks MCP over stdio:

```json
{
  "mcpServers": {
    "facility": {
      "command": "node",
      "args": ["/abs/path/to/facility/packages/mcp/dist/bin/facility-mcp.js"],
      "env": {
        "FACILITY_API_URL": "https://facility.yourorg.com",
        "FACILITY_API_KEY": "fak_…"
      }
    }
  }
}
```

Remote: run the same binary as an HTTP server with `facility-mcp serve` (it is not
one of the containers the AWS Terraform stack deploys — host it yourself next to
the control plane). It exposes streamable HTTP at `https://<mcp-host>/mcp` with
`Authorization: Bearer <credential>`.
Two credential kinds are accepted: a `fak_…` API key (for non-interactive services) or a WorkOS
OAuth 2.1 access token (for interactive clients like Claude, Cursor, and ChatGPT). Interactive
clients discover the flow from `/.well-known/oauth-protected-resource` (advertised on a `401` via
`WWW-Authenticate`); the control plane validates the token against WorkOS's JWKS. OAuth is enabled
only when `MCP_OAUTH_AUDIENCE` and `WORKOS_AUTHKIT_DOMAIN` are set on the control plane, and
`facility-mcp serve` advertises discovery when given `MCP_PUBLIC_URL` and `MCP_AUTHORIZATION_SERVER`
(defaults to `WORKOS_AUTHKIT_DOMAIN`).

## Tools

Reads: `facility_me`, `facility_list_projects`, `facility_list_runs`,
`facility_get_run`, `facility_list_inbox`, `facility_spend`,
`facility_llm_requests`, `facility_llm_request_envelope`,
`facility_list_registry`, `facility_list_issues`, `facility_audit_tail`, …

Writes — **all HITL-gated**: `facility_trigger_run`,
`facility_steer_run`, `facility_decide_proposal`, `facility_kickstart`,
`facility_set_budget`, `facility_publish_registry_version`, …

## The approval pattern

A write tool creates a human-in-the-loop proposal and does nothing else. A
separate principal with `hitl:decide` reviews the proposal in the HITL inbox
and approves or rejects it. MCP write keys are refused if they also carry
`hitl:decide`, so the same key cannot propose and approve its own write.
