# Executive Summary: MQL Is the DSL

## The Problem

Every web framework invents its own language. Django has ORM model definitions,
querysets, and a URL routing DSL. Rails has ActiveRecord, migrations, and
routes.rb. Express apps wire together Mongoose schemas, passport strategies,
and custom middleware — each with its own syntax, its own mental model, its own
class of bugs.

The result: developers spend more time translating between abstractions than
solving business problems. A single feature — say, "only show published posts
to anonymous users" — touches models, serializers, views, middleware, and tests
across multiple files and languages. The translation layers compound. The
impedance mismatch between what you *declare* and what the database *executes*
becomes the dominant source of complexity.

## The Insight

MongoDB already has a query language. It's called MQL — the MongoDB Query
Language. It handles filtering, aggregation, projection, lookup joins, computed
fields, TTL expiry, and document validation natively. It's battle-tested at
scale. Every MongoDB developer already knows it.

**What if the application configuration spoke the same language as the
database?**

No translation layer. No ORM. No proprietary DSL to learn. You declare intent
in MQL, and the framework executes it directly. The manifest *is* the query
plan.

## The Implementation: mdb-engine

**mdb-engine** is a Python framework that turns a JSON manifest into a
production-grade REST API backed by MongoDB. The manifest is the single source
of truth for collections, authentication, authorization, hooks, scopes,
pipelines, relations, computed fields, and more.

The core design principle:

> **MQL is the DSL.** Every `scopes`, `pipelines`, `defaults`, `hooks`,
> `relations`, and `computed` value is a native MongoDB Query Language
> expression. The manifest speaks the same language as the database — no
> translation layer, no custom syntax. Declare what you want. The engine
> handles the rest.

### What This Means in Practice

**Scopes are MQL filters.** Want to show only published posts?

```json
"scopes": {
  "published": { "status": "published" }
}
```

That object is passed directly to MongoDB's `find()`. No query builder, no
ORM translation. `GET /api/posts?scope=published` executes
`db.posts.find({ status: "published", app_id: "..." })`.

**Pipelines are MQL aggregations.** Want posts grouped by tag?

```json
"pipelines": {
  "by_tag": [
    { "$unwind": "$tags" },
    { "$group": { "_id": "$tags", "count": { "$sum": 1 } } },
    { "$sort": { "count": -1 } }
  ]
}
```

That array is passed directly to MongoDB's aggregation framework. The engine
prepends an `app_id` match stage for data isolation and exposes it as
`GET /api/posts/_agg/by_tag`.

**Policies are MQL filters.** Want row-level security?

```json
"policy": {
  "read":  { "team_id": "{{user.team_id}}" },
  "write": { "owner_id": "{{user._id}}" }
}
```

Template placeholders resolve at runtime, and the resulting filter merges into
every query. No middleware chain, no decorator stack — just a filter.

**Computed fields are MQL aggregations.** Want a live comment count on posts?

```json
"computed": {
  "comment_count": {
    "pipeline": [
      { "$lookup": { "from": "comments", ... } },
      { "$addFields": { "comment_count": { "$size": "$_comments" } } },
      { "$project": { "_comments": 0 } }
    ]
  }
}
```

Activated on demand via `?computed=comment_count`. No denormalization, no stale
caches, no background sync. The aggregation runs at query time.

**Hooks are MQL documents.** Want an automatic audit trail?

```json
"hooks": {
  "after_create": [{
    "action": "insert",
    "collection": "audit_log",
    "document": {
      "event": "post_created",
      "entity_id": "{{doc._id}}",
      "actor": "{{user.email}}",
      "timestamp": "$$NOW"
    }
  }]
}
```

The document template resolves placeholders and inserts directly into MongoDB.
Fire-and-forget. No event bus, no message queue, no application code.

## The Proof: A Production Blog in 160 Lines of JSON

The **Zero-Code Blog** is a fully functional blog platform — public reading,
authenticated comments, admin publishing, comment moderation, soft delete with
trash/restore, computed comment counts, cross-collection relations, automatic
audit trails, and auto-expiring logs — built entirely from a single
`manifest.json`.

| Capability | Traditional Stack | mdb-engine |
|---|---|---|
| Data model | Django models + migrations | `schema` in manifest (schemaless MongoDB) |
| REST API | Views + serializers + URL routing | `auto_crud: true` |
| Authentication | passport.js / Django auth / custom | `auth.users` block |
| Authorization | Custom middleware per route | `write_roles`, `policy`, `owner_field` |
| Named queries | Custom view methods | `scopes` (MQL filters) |
| Analytics endpoints | Custom aggregation code | `pipelines` (MQL aggregations) |
| Audit trail | Event bus + handlers + storage | `hooks` (MQL document templates) |
| Computed fields | Denormalized counters + sync jobs | `computed` (MQL aggregations on demand) |
| Cross-collection joins | ORM eager loading / N+1 fixes | `relations` (MQL `$lookup`) |
| Document expiry | Cron jobs + cleanup scripts | `ttl` (MongoDB TTL index) |
| Input validation | Form validators / Pydantic models | `schema` (JSON Schema) |
| Unique constraints | Database migrations | `x-unique` (auto-indexed) |
| Field protection | Custom serializer logic | `writable_fields`, `immutable_fields` |

The blog ships with four collections — `posts`, `comments`, `categories`,
`audit_log` — and a vanilla JavaScript frontend served from `public/`. The
frontend calls `fetch("/api/posts?scope=published")` on the same origin. No
CORS. No build step. No proxy config.

### Security Is Structural, Not Bolted On

When `auth.users.enabled` is `true`, every endpoint requires authentication by
default. Per-collection config can only *relax* reads (`public_read`), never
writes. The `users` collection is never exposed via auto-CRUD. Fields like
`role`, `password_hash`, and `is_admin` are auto-immutable on every collection.
Login rate limiting, registration throttling, and request body size limits are
all built in.

This isn't security through configuration — it's security through constraint.
The framework makes the insecure path harder than the secure one.

## Why It Matters

### For Developers

One language to learn. If you know MongoDB, you know the manifest. Scopes,
pipelines, policies, hooks, computed fields, relations — they all use MQL.
There is no impedance mismatch between what you write and what executes.
Debugging means reading the manifest and comparing it to the MongoDB query log.
The abstraction is transparent.

### For Teams

The manifest is a JSON file. It's diffable, reviewable, and version-controlled.
A scope change is a one-line diff. A new collection is a block of JSON. An
access control change is visible in code review without understanding a
framework's internal routing, middleware ordering, or decorator semantics. The
entire API contract lives in one file.

### For Organizations

The framework eliminates entire categories of bugs — ORM translation errors,
middleware ordering issues, forgotten authorization checks, stale
denormalized data. It reduces the surface area for security vulnerabilities by
making the secure path the default path. It compresses onboarding time because
new developers only need to learn MQL and JSON Schema, not a framework's
proprietary abstractions.

### For the MongoDB Ecosystem

mdb-engine is a bet that MongoDB's query language is expressive enough to serve
as a complete application DSL. Scopes prove it for filtering. Pipelines prove
it for analytics. Policies prove it for authorization. Computed fields prove it
for derived data. Hooks prove it for side effects. Relations prove it for
joins.

The manifest doesn't abstract MongoDB away — it leans into it. Every feature
is a thin wrapper around a native MQL capability. The engine adds multi-tenancy
(`app_id` scoping), template resolution (`{{user.*}}`, `{{doc.*}}`, `$$NOW`),
and HTTP plumbing (FastAPI + Pydantic). Everything else is MongoDB, executing
MQL, exactly as declared.

## What's Next

The Zero-Code Blog is a reference implementation. The same manifest-driven
approach scales to multi-app platforms (`create_multi_app`), AI-augmented
applications (memory, embeddings, knowledge graphs via `mdb-engine[ai]`), and
custom business logic (Python escape hatch via `RequestContext` and
`UnitOfWork`).

The pattern is clear: **declare in MQL, let the engine handle the rest.**

---

*mdb-engine v0.8.4 — MIT License — Python >=3.10*
