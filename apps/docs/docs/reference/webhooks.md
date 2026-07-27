---
title: Webhooks
---

# Integration webhooks

Facility both receives events from other systems and emits its own. Both
directions use the same four headers and the same signing formula, so one
verification routine covers them. The summary lives in the
[control-plane API reference](api.md); this page is the wire contract you
implement against.

Create `generic_inbound` integrations for events entering Facility and
`webhook` integrations for Facility events leaving it. The plaintext signing
secret is returned only when the integration is created or rotated.

Inbound requests use `POST /webhooks/inbound/:integrationId`, an unmodified JSON
body, and these required headers:

```text
X-Facility-Timestamp: <10-digit Unix seconds>
X-Facility-Delivery: <sender-unique delivery id>
X-Facility-Event: <event type>
X-Facility-Signature: sha256=<hex HMAC-SHA256>
```

Compute the HMAC over this exact byte sequence, where `body` is the exact body
sent on the wire:

```text
timestamp + "." + deliveryId + "." + eventType + "." + body
```

Facility rejects signatures outside a five-minute clock-skew window. A valid
delivery is deduplicated per integration and delivery id; a repeat returns
`202 {"ok":true,"replayed":true}` without processing twice.

For lifecycle telemetry, send the stable `facility.signal.v1` envelope. The
provider-specific identifier stays in `source`; Facility routes only the typed
outcome and never requires a particular deployment or monitoring vendor:

```json
{
  "schema": "facility.signal.v1",
  "type": "deployment",
  "status": "failed",
  "source": "my-deployer",
  "fingerprint": "deployment:acme/app:production",
  "title": "Production deployment failed",
  "bodyMd": "Release 4f9c did not become ready.",
  "projectId": "proj_…",
  "severity": "error",
  "metadata": { "commit": "4f9c…", "environment": "production" }
}
```

`type` is `issue`, `deployment`, `security`, or `check`; `status` is `failed`,
`recovered`, `pending`, or `succeeded`. Failed signals open or update one
fingerprinted issue, recovered/succeeded signals resolve it, and pending
signals are recorded without claiming failure. GitHub deployment-status and
check-run webhooks are adapted into this same contract.

Outbound webhook integrations receive the same four headers and signing
formula. Supported events are `run.finished` and `proposal.decided`; set
`config.events` to an array to subscribe to a subset, or omit it for both.
Delivery is at least once. A durable outbox claims with row locks, recovers
five-minute-stale claims, times out requests after ten seconds, follows no
redirects, and retries network errors plus HTTP 408/425/429/5xx up to eight
attempts. Backoff begins at 30 seconds, honors bounded `Retry-After`, and caps at
24 hours. Other non-2xx responses become dead immediately. Operators can list
deliveries, inspect the last status/error, and retry `failed` or `dead` entries
through CLI/API.
