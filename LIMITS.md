# Limits of Manifest-Driven Development

An honest assessment of where `manifest.json` stops and custom code begins.
Based on the zero-code blog built with **mdb-engine 0.8.7**.

> **Updated for 0.8.7** — Many limits from earlier versions have been resolved.
> Sections marked with [RESOLVED] document what changed. The [Appendix](#appendix--status-of-proposed-features)
> tracks every proposal from the original document against what shipped.

---

## Table of Contents

1. [~~No Custom Business Logic~~](#1-custom-business-logic-partially-resolved) (partially resolved)
2. [~~Fire-and-Forget Hooks~~](#2-hooks-now-have-options-resolved) (resolved)
3. [~~Flat Role Model~~](#3-role-model-resolved) (resolved)
4. [~~No Cross-Collection Integrity~~](#4-cross-collection-integrity-resolved) (resolved)
5. [~~Read-Time Computed Fields Don't Scale~~](#5-denormalized-counters-resolved) (resolved)
6. [~~No Server-Side Rendering~~](#6-server-side-rendering-resolved) (resolved)
7. [Single-Database, Single-Process Architecture](#7-single-database-single-process-architecture) (remaining)
8. [~~Frontend-Backend Coupling~~](#8-frontend-backend-coupling-partially-resolved) (partially resolved)
9. [~~Testing Is a Blind Spot~~](#9-testing-and-ci-partially-resolved) (partially resolved)
10. [Remaining Limits](#10-remaining-limits)
11. [Where the Ceiling Is Now (Updated)](#11-where-the-ceiling-is-now)
12. [Appendix — Status of Proposed Features](#appendix--status-of-proposed-features)

---

## 1. Custom Business Logic (partially resolved)

### What changed in 0.8.7

- **Conditional hooks** (`if` with `{{prev.*}}`) enable event-driven logic
  without Python: "notify only on publish transition," "increment only when
  approved changes from false to true."
- **HTTP hook actions** enable calling external services (Slack, email,
  analytics) declaratively.
- **Schema validation extensions** (`x-values-from`) validate field values
  against lookup collections.
- **Scheduled jobs** handle time-based logic (archive stale drafts daily).

### What's still missing

- **Arbitrary conditionals** — you can't express "if comment count > 100,
  set featured = true." Conditions are limited to field equality/comparison
  on the current and previous document.
- **Multi-step orchestration** — "create post, then create 3 default
  categories, then send email" can't be expressed as a single manifest flow.
- **Field transforms** — slugify, truncate, hash, or compute derived values
  before storage. The manifest has no `before_create` transform hooks.
- **Complex validation** — "title must not duplicate any existing title
  in the same category" requires cross-field, cross-document logic beyond
  `x-unique` and `x-values-from`.

---

## 2. Hooks Now Have Options [RESOLVED]

### What changed in 0.8.7

| Capability | Before | After |
|-----------|--------|-------|
| Hook actions | `insert`, `update` (auto-wrapped in `$set`) | `insert`, `update` (with `$inc`, `$push`, etc.), `delete`, `http` |
| Conditional execution | No | `if` with MQL operators + `{{prev.*}}` |
| Transaction support | No | `"transactional": true` wraps write + hooks in a MongoDB transaction |
| Background execution | No | `"background": true` with retry and `_hook_failures` logging |
| Atomic operators | No | Full MongoDB update operator support (`$inc`, `$push`, `$pull`, etc.) |

The blog now uses transactional-capable hooks, conditional publish
notifications, and atomic `$inc` for denormalized comment counts.

### What's still limited

- **No `before_create` / `before_update` hooks** — you can't intercept
  and transform a document before it's written.
- **No hook chaining** — a hook that inserts into collection B does not
  trigger B's own hooks (by design, to prevent infinite loops, but it
  means you can't compose multi-hop workflows).
- **Webhook auth** — `http` hooks support `headers` for API keys, but
  there's no built-in OAuth flow or signature verification for incoming
  webhooks.

---

## 3. Role Model [RESOLVED]

### What changed in 0.8.7

| Capability | Before | After |
|-----------|--------|-------|
| Role model | Single `role` string | `role` (string) + `roles` (array), both checked |
| Role hierarchy | None | `role_hierarchy` with inheritance |
| Per-role field access | Flat `writable_fields` list | Per-role `writable_fields` map |
| Moderator role | Not distinguished from admin | Separate role with scoped access |

The blog now has `admin > editor > moderator > reader` with editors getting
full content field access and moderators limited to `status` and `tags`.

### What's still limited

- **No per-operation role gating** — you can't say "editors can create and
  update but only admins can delete." `write_roles` gates all mutations.
- **No team/group-based access** — "members of Team X can edit Team X's
  posts" isn't expressible. Access is per-user or per-role, not per-group.
- **No ABAC (attribute-based)** — conditions like "users can only edit
  posts tagged with their department" require custom Python policies.

---

## 4. Cross-Collection Integrity [RESOLVED]

### What changed in 0.8.7

| Capability | Before | After |
|-----------|--------|-------|
| Foreign key validation | None | `x-references` validates at write time (422 on invalid) |
| Cascade delete | None | `cascade.on_delete` with `delete` action |
| Cascade soft-delete | None | `cascade.on_soft_delete` with `soft_delete` action |
| Lookup validation | None | `x-values-from` validates values against a collection |

The blog now validates that `comments.post_id` points to a real post,
cascade-deletes comments when a post is deleted, and validates tags against
the `tags` collection.

### What's still limited

- **No cross-collection uniqueness** — "this slug must be unique across
  posts AND pages" isn't expressible.
- **No cascade update** — renaming a category doesn't propagate to posts
  that reference it.
- **No orphan detection** — existing orphaned documents from before
  `x-references` was enabled are not retroactively cleaned up.

---

## 5. Denormalized Counters [RESOLVED]

### What changed in 0.8.7

Atomic update operators in hooks (`$inc`, `$push`, `$pull`) eliminate the
need for expensive read-time `$lookup` aggregations.

The blog's `comment_count` is now maintained by conditional hooks:

```json
{
  "action": "update",
  "collection": "posts",
  "filter": { "_id": "{{doc.post_id}}" },
  "update": { "$inc": { "comment_count": 1 } },
  "if": { "doc.approved": true, "prev.approved": false }
}
```

Read-time `computed` fields still exist for cases where real-time accuracy
matters more than performance, but the scaling problem is solved for the
common case.

---

## 6. Server-Side Rendering [RESOLVED]

### What changed in 0.8.7

Full SSR engine with Jinja2 templates:

- **Route-level data loading** — collections, scopes, sort, populate,
  computed fields declared per route
- **Pagination** — automatic `?page=N` with `{name}_pagination` context
- **SEO** — per-route `title`, `description`, Open Graph, JSON-LD
- **Cache-Control headers** — per-route `ttl` and `stale_while_revalidate`
- **Sitemap.xml** — auto-generated from all public SSR routes
- **Custom error pages** — `404.html` and `500.html` templates
- **Auth-gated routes** — `"auth": true` on any SSR route

The blog now serves crawlers and no-JS readers fully rendered HTML at `/`
and `/posts/{id}`, while the SPA handles admin views and interactive features.

### What's still limited

- **No incremental static regeneration (ISR)** — pages are rendered on
  every request (with caching). There's no build-time generation or
  on-demand revalidation like Next.js ISR.
- **No streaming SSR** — the full page is rendered before sending. Large
  pages with many database queries may have noticeable TTFB.
- **No component-level caching** — cache is per-route, not per-fragment.
  A sidebar that's identical across routes is re-rendered each time.

---

## 7. Single-Database, Single-Process Architecture

This remains the largest structural limit. 0.8.7 does not address:

- **No read replicas** — every query hits the same MongoDB instance.
- **No connection pool tuning** — the manifest has no concept of pool
  sizes, read preferences, or write concerns.
- **No event bus** — HTTP hooks are the only external integration point.
  There's no pub/sub, no message queue, no event sourcing.
- **No horizontal scaling primitives** — no sharding keys, no sticky
  sessions, no distributed caching.

Background hooks (`"background": true`) offload work from the request path
but still run in the same process. For true async workflows (video
transcoding, ML inference, batch email), you still need external workers.

---

## 8. Frontend-Backend Coupling (partially resolved)

### What changed in 0.8.7

- **TypeScript codegen** (`mdb-engine codegen`) generates typed API clients
  from the manifest, eliminating hand-maintained `API_CONFIG` objects.
- **Manifest diff** (`mdb-engine diff`) catches breaking changes in CI
  before they reach production.
- **Manifest dry-run** (`mdb-engine dry-run`) previews generated routes,
  indexes, and auth policies without connecting to MongoDB.

### What's still limited

- **No runtime contract validation** — the generated TypeScript client
  catches drift at *build* time, not at runtime. A deployed SPA with a
  stale client still breaks silently.
- **No frontend config endpoint** — the manifest doesn't expose a
  `/config` endpoint that frontends could consume to auto-discover scopes,
  fields, or roles.
- **SPA still hand-maintained** — the blog's SPA (`public/js/*.js`) still
  uses `API_CONFIG` manually. The codegen exists but the migration hasn't
  been done.

---

## 9. Testing and CI (partially resolved)

### What changed in 0.8.7

- **`mdb-engine diff`** enables CI checks for breaking manifest changes
  (non-zero exit code on breaking changes).
- **`mdb-engine dry-run`** enables validation without a database.
- **mdb-engine itself** now has 2861 unit tests covering all features.

### What's still limited

- **No app-level test runner** — there's no `mdb-engine test manifest.json`
  that runs user-defined assertions against the manifest.
- **No fixture/seed data format** — you can't declare test data in the
  manifest and run integration tests against it.
- **No frontend test integration** — the generated TypeScript client
  doesn't come with mock factories or test utilities.

---

## 10. Remaining Limits

These are the genuine walls that 0.8.7 does not address:

1. **No before-write hooks** — you can react to writes but not intercept
   and transform documents before they're stored.
2. **No per-operation role gating** — `write_roles` is all-or-nothing for
   create/update/delete. You can't allow editors to create but not delete.
3. **No team/group-based access control** — access is per-user or per-role,
   not per-organizational-unit.
4. **No field transforms** — slugify, compute, derive values on write.
5. **No multi-step workflows** — approval chains, state machines, saga
   patterns are not expressible declaratively.
6. **No event sourcing** — hooks fire but events are not stored in a
   replayable, ordered log.
7. **No horizontal scaling** — single process, single database instance.
8. **No streaming/real-time beyond WebSocket change streams** — no
   server-sent events, no long-polling patterns in the manifest.

---

## 11. Where the Ceiling Is Now

| Need | 0.8.6 | 0.8.7 |
|------|-------|-------|
| Standard CRUD with auth | Yes | Yes |
| Scopes, filters, sort, pagination | Yes | Yes |
| Simple role-based access | Yes | Yes |
| **Role hierarchy + multi-role** | No | **Yes** |
| **Per-role writable fields** | No | **Yes** |
| Audit logging via hooks | Best-effort | **Transactional option** |
| **Conditional hooks** | No | **Yes** |
| **Atomic update operators in hooks** | No | **Yes** |
| **Cascade delete / soft-delete** | No | **Yes** |
| **Referential integrity** | No | **Yes** |
| **Schema validation (x-values-from)** | No | **Yes** |
| **Denormalized counters** | No | **Yes** (via `$inc` hooks) |
| **Server-side rendering** | No | **Yes** |
| **Cache-Control headers** | No | **Yes** |
| **Scheduled jobs** | No | **Yes** |
| **HTTP webhooks** | No | **Yes** |
| **Background hooks with retry** | No | **Yes** |
| **Manifest diff (CI)** | No | **Yes** |
| **Manifest dry-run** | No | **Yes** |
| **TypeScript codegen** | No | **Yes** |
| **`{{prev.*}}` template context** | No | **Yes** |
| Computed fields / relations at read time | Yes | Yes |
| Unique constraints | Yes | Yes |
| TTL auto-expiry | Yes | Yes |
| Before-write transforms | No | No |
| Per-operation role gating | No | No |
| Team/group access control | No | No |
| Multi-step workflows | No | No |
| Horizontal scaling | No | No |

The manifest ceiling moved **dramatically** upward. What used to require
Python (conditional logic, atomic updates, cascades, referential integrity,
SSR, caching, jobs) is now declarative JSON. The remaining gaps are in
pre-write transforms, fine-grained operation-level RBAC, organizational
access control, and distributed architecture.

---

## Appendix — Status of Proposed Features

Every feature proposed in the original LIMITS.md appendix, tracked against
what shipped in 0.8.7.

| # | Proposal | Status | Notes |
|---|----------|--------|-------|
| A.1 | Conditional hooks | **Shipped** | `if` with `{{prev.*}}` — used in blog for publish notifications |
| A.2 | Atomic update operators | **Shipped** | Full MongoDB operator support — used for `$inc` comment count |
| A.3 | Hook delete + http actions | **Shipped** | Both actions available — blog uses cascade via `cascade` config |
| A.4 | Transactional hook mode | **Shipped** | `"transactional": true` wraps in MongoDB transactions |
| A.5 | Multi-role + hierarchy | **Shipped** | `role_hierarchy` + `roles` array — blog uses 4-tier hierarchy |
| A.6 | Per-role writable fields | **Shipped** | Object-form `writable_fields` — blog uses editor vs. moderator |
| A.7 | Referential integrity | **Shipped** | `x-references` validates at write time (422) |
| A.8 | Cascade policies | **Shipped** | `cascade.on_delete` + `cascade.on_soft_delete` |
| A.9 | Manifest diff + dry-run | **Shipped** | `mdb-engine diff` and `mdb-engine dry-run` CLI commands |
| A.10 | Contract generation | **Shipped** | `mdb-engine codegen --target typescript` |
| A.11 | Cache directives | **Shipped** | Per-scope `Cache-Control` headers |
| A.12 | Background hooks + retry | **Shipped** | `"background": true` with `retry` config + `_hook_failures` |
| A.13 | Schema validation extensions | **Shipped** | `x-values-from` for lookup validation |
| A.14 | Scheduled jobs | **Shipped** | `jobs` config with cron/interval schedules |

**14 / 14 proposals shipped.** Plus the SSR engine and `{{prev.*}}`
template context which were not in the original proposal.

---

*See also: [MDB_ENGINE_101.md](MDB_ENGINE_101.md) for the framework deep-dive,
[BLOG_101.md](BLOG_101.md) for the blog walkthrough,
[CUSTOMIZATION.md](CUSTOMIZATION.md) for manifest recipes.*
