# Limits of Manifest-Driven Development

An honest assessment of where `manifest.json` stops and custom code begins.
Based on the zero-code blog built with **mdb-engine**.

---

## Table of Contents

1. [No Custom Business Logic](#1-no-custom-business-logic)
2. [Fire-and-Forget Hooks — No Transactions](#2-fire-and-forget-hooks--no-transactions)
3. [Flat Role Model](#3-flat-role-model)
4. [No Cross-Collection Integrity](#4-no-cross-collection-integrity)
5. [Read-Time Computed Fields Don't Scale](#5-read-time-computed-fields-dont-scale)
6. [No Server-Side Rendering or Middleware](#6-no-server-side-rendering-or-middleware)
7. [Single-Database, Single-Process Architecture](#7-single-database-single-process-architecture)
8. [Frontend-Backend Coupling by Convention](#8-frontend-backend-coupling-by-convention)
9. [Testing Is a Blind Spot](#9-testing-is-a-blind-spot)
10. [Where the Ceiling Is (Summary)](#10-where-the-ceiling-is)
11. [Appendix — What mdb-engine Could Do](#appendix--what-mdb-engine-could-do)

---

## 1. No Custom Business Logic

The manifest expresses **data shape and access rules**, not behavior. The
moment you need conditionals, loops, or multi-step orchestration, you're
outside what JSON can declare.

Things you cannot do in the manifest today:

- Send an email when a post is published
- Auto-ban a user after N rejected comments
- Validate that `tags` has at most 5 items from an approved set
- Rate-limit comment creation per user (beyond login rate-limiting)
- Transform a field value before storage (slugify a title, resize an image URL)

The escape hatch exists — custom Python routes via `RequestContext` (see
[MDB_ENGINE_101.md §11](MDB_ENGINE_101.md#11-beyond-zero-code)) — but once
you use it you're maintaining two paradigms: declarative JSON *and* imperative
Python, with no single place to reason about the full system.

---

## 2. Fire-and-Forget Hooks — No Transactions

From the mdb-engine docs:

> "A hook failure never blocks the API response. The write operation always
> succeeds."

Consequences:

- If the `audit_log` insert fails, the post is still created with **no
  record of it**. There is no retry, no dead-letter queue, no alert.
- You cannot express "create the post **only if** the audit entry succeeds" —
  there are no transactional guarantees across collections.
- Hook actions are limited to `insert` and `update`. No `delete`, no HTTP
  callouts, no conditional branching.

For a blog this is acceptable. For anything with financial, legal, or
compliance requirements it is a hard wall.

---

## 3. Flat Role Model

Auth supports a single `role` string per user and collection-level
`write_roles`. But:

| Need | Supported? |
|------|-----------|
| Admin vs. reader | Yes |
| Editors who can publish but not delete | No — `write_roles` is all-or-nothing for mutations |
| Per-field authorization by role | No — `writable_fields` applies to all authenticated users equally |
| Team-based access ("members of Project X can edit") | No — `owner_field` gives "own or admin," nothing else |
| Multi-role users (admin *and* editor) | No — one role per user |
| Hierarchical roles (admin inherits editor permissions) | No |

The `CUSTOMIZATION.md` recipes show how to add roles like `editor`, but the
enforcement granularity remains coarse: you can gate an entire collection or
scope, not individual operations within it.

---

## 4. No Cross-Collection Integrity

MongoDB is schemaless. The manifest adds JSON Schema validation per document
but does not enforce referential integrity across collections:

- Deleting a post leaves orphaned comments with dangling `post_id` references.
- There is no cascade delete, cascade archive, or cascade soft-delete.
- `relations` (`?populate=post`) is a read-time `$lookup` — it does not
  validate that `post_id` refers to an existing post at write time.
- `x-unique` works within a single collection. There is no cross-collection
  uniqueness constraint.

In practice, data consistency depends entirely on the frontend (or API
consumer) doing the right thing.

---

## 5. Read-Time Computed Fields Don't Scale

The blog's `comment_count` computed field runs a `$lookup` aggregation on
every read:

```json
{
  "$lookup": {
    "from": "comments",
    "let": { "pid": { "$toString": "$_id" } },
    "pipeline": [
      { "$match": { "$expr": { "$eq": ["$post_id", "$$pid"] } } }
    ],
    "as": "_comments"
  }
}
```

With 1,000 posts and 50,000 comments this becomes expensive. A code-first
system would maintain a denormalized counter updated atomically on comment
create/delete. The manifest cannot express "increment a field in another
collection" — hook `update` takes a static template document and does not
support `$inc` or other atomic operators.

---

## 6. No Server-Side Rendering or Middleware

The frontend is a client-side SPA served as static files from `public/`.

- **No SSR** — search engines see an empty `<div>` until JavaScript executes.
  The `seo.js` module injects `<meta>` and JSON-LD dynamically, but crawlers
  that don't run JS miss all content.
- **No server-side middleware** — you cannot add request/response transforms,
  custom caching headers, or content negotiation at the manifest level.
- **No edge/CDN caching** — every API request hits MongoDB live. There is no
  declarative cache layer, no `Cache-Control` directives, no stale-while-
  revalidate strategy.

---

## 7. Single-Database, Single-Process Architecture

- **No read replicas** — every query hits the same MongoDB instance.
- **No background workers** — hooks run inline in the request process
  (fire-and-forget, but still consuming the same event loop).
- **No event bus** — hooks cannot publish to Kafka, SQS, Redis Streams, or
  any external system.
- **No horizontal scaling primitives** — the manifest has no concept of
  sharding keys, connection pool tuning, or multi-region deployment.

For a blog with hundreds of readers this is irrelevant. For a SaaS product
or high-traffic API it is an architectural ceiling.

---

## 8. Frontend-Backend Coupling by Convention

The frontend makes hard assumptions about the API:

- Endpoint paths, query parameter names (`scope`, `computed`, `populate`),
  and field names are duplicated between `manifest.json` and `utils.js`.
- Renaming a scope from `published` to `live` silently breaks the frontend —
  there is no contract validation, no codegen, no type safety.
- `BLOG_CONFIG`, `UI_CONFIG`, and `API_CONFIG` in `utils.js` are a
  hand-maintained mirror of manifest semantics.

A manifest change can cause a subtle runtime failure that only surfaces when
a user clicks the right button.

---

## 9. Testing Is a Blind Spot

There is no test infrastructure:

- No unit tests for manifest behavior
- No integration tests verifying "this manifest + this request = this response"
- No contract tests between frontend and API
- No way to dry-run a manifest change and diff the resulting endpoints

The manifest-driven approach makes testing **more** important — a single JSON
typo can break auth or expose data — while providing **less** tooling for it.

---

## 10. Where the Ceiling Is

| Need | Manifest handles it? |
|------|---------------------|
| Standard CRUD with auth | Yes |
| Scopes, filters, sort, pagination | Yes |
| Simple role-based access (admin / reader) | Yes |
| Audit logging via hooks | Yes (best-effort) |
| Computed fields / relations at read time | Yes (at cost) |
| Unique constraints within a collection | Yes |
| TTL auto-expiry | Yes |
| Conditional business logic | **No** — need Python |
| Transactional multi-collection writes | **No** |
| Fine-grained RBAC / ABAC | **No** |
| Referential integrity / cascades | **No** |
| Denormalized counters / materialized views | **No** |
| Server-side rendering | **No** |
| Background jobs / async workflows | **No** |
| Horizontal scaling primitives | **Not addressed** |

The manifest gets you from zero to working app extraordinarily fast. The
limits appear when you need **logic** (not just data shape), **guarantees**
(not just best-effort), or **scale** (not just single-process).

---

## Appendix — What mdb-engine Could Do

Potential engine-level features that would push the manifest ceiling higher
without requiring users to drop into Python.

### A.1 Conditional Hooks

Allow `if` expressions in hook definitions using MQL match syntax:

```json
"after_update": [{
  "if": { "doc.status": "published", "prev.status": { "$ne": "published" } },
  "action": "insert",
  "collection": "notifications",
  "document": {
    "type": "post_published",
    "post_id": "{{doc._id}}",
    "timestamp": "$$NOW"
  }
}]
```

This would enable "fire hook only when a specific transition happens" without
custom code. The `prev` context (previous document state) would be needed for
update hooks.

### A.2 Atomic Update Operators in Hooks

Support MongoDB update operators (`$inc`, `$push`, `$pull`, `$set`) in hook
`update` actions:

```json
"after_create": [{
  "action": "update",
  "collection": "posts",
  "filter": { "_id": "{{doc.post_id}}" },
  "update": { "$inc": { "comment_count": 1 } }
}]
```

This single addition would eliminate the biggest scaling problem: read-time
computed fields. Denormalized counters, running totals, and materialized
aggregates all become possible declaratively.

### A.3 Hook Actions: `delete` and `http`

Add `delete` and `http` (webhook) actions:

```json
"after_delete": [{
  "action": "delete",
  "collection": "comments",
  "filter": { "post_id": "{{doc._id}}" }
}]
```

```json
"after_create": [{
  "action": "http",
  "url": "https://hooks.slack.com/services/...",
  "method": "POST",
  "body": { "text": "New post: {{doc.title}}" }
}]
```

`delete` gives cascade deletes. `http` gives integration with external systems
(email services, Slack, analytics, webhooks) — the most-requested feature in
any headless CMS.

### A.4 Transactional Hook Mode

An opt-in `"transactional": true` flag on hooks that wraps the primary write
and all hook actions in a MongoDB multi-document transaction:

```json
"hooks": {
  "transactional": true,
  "after_create": [...]
}
```

If any hook fails, the entire operation rolls back. This trades latency for
correctness — appropriate for audit-critical or financial collections.

### A.5 Multi-Role Users and Role Hierarchies

Support an array of roles per user and a manifest-level role hierarchy:

```json
"auth": {
  "users": {
    "roles_field": "roles",
    "role_hierarchy": {
      "admin": ["editor", "moderator", "reader"],
      "editor": ["reader"],
      "moderator": ["reader"]
    }
  }
}
```

A user with `"roles": ["editor"]` automatically inherits `reader` permissions.
Collection-level `write_roles: ["editor"]` would now mean "editor or any role
that includes editor."

### A.6 Per-Role Writable Fields

Extend `writable_fields` to accept a role map:

```json
"writable_fields": {
  "editor": ["title", "body", "tags", "status"],
  "reader": ["body"]
}
```

Editors can modify content fields. Readers can only edit their own comment
body. Admins bypass the allowlist entirely (current behavior).

### A.7 Referential Integrity Constraints

A `references` key that validates foreign keys at write time:

```json
"schema": {
  "properties": {
    "post_id": {
      "type": "string",
      "x-references": { "collection": "posts", "field": "_id" }
    }
  }
}
```

On `POST /api/comments`, the engine verifies that `post_id` points to an
existing post before inserting. Returns `422` if the reference is invalid.

### A.8 Cascade Policies

Declarative cascade behavior on delete:

```json
"posts": {
  "cascade": {
    "on_delete": [
      { "collection": "comments", "match_field": "post_id", "action": "delete" },
      { "collection": "audit_log", "match_field": "entity_id", "action": "delete" }
    ],
    "on_soft_delete": [
      { "collection": "comments", "match_field": "post_id", "action": "soft_delete" }
    ]
  }
}
```

### A.9 Manifest Diffing and Dry-Run CLI

A CLI command that compares two manifests and reports what changed:

```bash
mdb-engine diff manifest.v1.json manifest.v2.json
```

Output:

```
+ collection "reactions" added (auto_crud, public_read)
~ posts.writable_fields: added "subtitle"
~ posts.scopes.published: filter changed
- comments.hooks.after_create[0]: removed audit_log insert
⚠ BREAKING: posts.schema.required now includes "body" (existing docs may fail validation)
```

And a dry-run mode that boots the engine without connecting to MongoDB and
prints all generated routes, scopes, indexes, and auth policies:

```bash
mdb-engine dry-run manifest.json
```

### A.10 Contract Generation for Frontends

Auto-generate a typed API client from the manifest:

```bash
mdb-engine codegen manifest.json --target typescript --out api-client.ts
```

Produces a typed module with functions like `listPosts(params)`,
`createComment(body)`, etc. — eliminating the hand-maintained `API_CONFIG`
in the frontend and catching manifest/frontend drift at build time.

### A.11 Manifest-Level Cache Directives

Declarative caching per collection or scope:

```json
"posts": {
  "cache": {
    "scope:published": { "ttl": "5m", "stale_while_revalidate": "30s" },
    "default": { "ttl": "0" }
  }
}
```

The engine sets `Cache-Control` headers and optionally maintains an in-process
LRU cache, reducing MongoDB load for read-heavy public endpoints.

### A.12 Background Hook Execution with Retry

A `"background": true` flag that offloads hook execution to a worker queue
with configurable retry:

```json
"after_create": [{
  "action": "http",
  "url": "https://api.sendgrid.com/v3/mail/send",
  "background": true,
  "retry": { "attempts": 3, "backoff": "exponential" }
}]
```

Failed hooks are logged to a `_hook_failures` system collection for
observability. This would close the gap between fire-and-forget and
transactional without requiring an external message queue.

### A.13 Schema-Level Validation Extensions

Beyond JSON Schema, support engine-specific validators:

```json
"tags": {
  "type": "array",
  "items": { "type": "string" },
  "maxItems": 5,
  "x-values-from": { "collection": "categories", "field": "name" }
}
```

`x-values-from` validates that every tag exists in the `categories`
collection. `maxItems` is standard JSON Schema but would need the engine to
actually enforce it (today schema validation depth may vary).

### A.14 Scheduled Jobs

Declarative cron-like jobs in the manifest:

```json
"jobs": {
  "archive_old_drafts": {
    "schedule": "0 3 * * *",
    "action": "update",
    "collection": "posts",
    "filter": { "status": "draft", "updated_at": { "$lt": "$$NOW_MINUS_90D" } },
    "update": { "$set": { "status": "archived" } }
  }
}
```

This would eliminate the need for external cron or background workers for
common maintenance tasks.

---

### Priority Matrix

| Feature | Complexity | Impact | Unlocks |
|---------|-----------|--------|---------|
| A.2 Atomic update operators in hooks | Low | High | Denormalized counters, materialized views |
| A.1 Conditional hooks | Medium | High | Event-driven workflows without code |
| A.9 Manifest diff / dry-run CLI | Low | High | Confidence in manifest changes, CI integration |
| A.3 Hook delete + http actions | Medium | High | Cascade deletes, external integrations |
| A.7 Referential integrity | Medium | Medium | Data consistency guarantees |
| A.10 Contract generation | Medium | Medium | Type-safe frontends, drift detection |
| A.6 Per-role writable fields | Low | Medium | Granular RBAC without custom code |
| A.5 Multi-role + hierarchy | Medium | Medium | Real-world org structures |
| A.11 Cache directives | Medium | Medium | Read-heavy performance |
| A.4 Transactional hooks | High | Medium | Audit-critical / financial use cases |
| A.8 Cascade policies | Medium | Medium | Relational-style integrity |
| A.12 Background hooks with retry | High | Medium | Reliable async side effects |
| A.13 Schema validation extensions | Low | Low | Richer input validation |
| A.14 Scheduled jobs | High | Low | Eliminates external cron dependency |

---

*See also: [MDB_ENGINE_101.md](MDB_ENGINE_101.md) for the framework deep-dive,
[BLOG_101.md](BLOG_101.md) for the blog walkthrough,
[CUSTOMIZATION.md](CUSTOMIZATION.md) for manifest recipes.*
