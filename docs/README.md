# Documents about building Facility

This directory holds the documents that only matter if you are working *on*
Facility: what verification has to prove before a change is releasable, and the
requirements the platform was built against.

Everything about *using* Facility — the method, the concepts, the guides, the
reference, self-hosting — lives in [`apps/docs`](../apps/docs), which is the
published documentation site. If you are writing something a user would read,
it belongs there.

- [`testing.md`](testing.md) — the two acceptance tiers and the sandbox E2E
  policy. A green fast test run is not release evidence.
- [`platform/PRD.md`](platform/PRD.md) — the v1 product requirements. Kept as
  the record of what the platform set out to do; the site is the current truth.
