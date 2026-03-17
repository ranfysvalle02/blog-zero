# MDB-Engine 101

A comprehensive guide to **mdb-engine** — the batteries-included MongoDB runtime
for Python. Learn how a single JSON manifest replaces thousands of lines of
backend boilerplate.

---

## Table of Contents

1. [What Is mdb-engine?](#1-what-is-mdb-engine)
2. [Architecture](#2-architecture)
3. [The Three Tiers](#3-the-three-tiers)
4. [Manifest-Driven Development](#4-manifest-driven-development)
5. [Zero-Code Collections Deep Dive](#5-zero-code-collections-deep-dive)
6. [Template Placeholders](#6-template-placeholders)
7. [Hooks Deep Dive](#7-hooks-deep-dive)
8. [Authentication & Security](#8-authentication--security)
9. [Server-Side Rendering](#9-server-side-rendering)
10. [Scheduled Jobs](#10-scheduled-jobs)
11. [Generated REST API](#11-generated-rest-api)
12. [CLI Tooling](#12-cli-tooling)
13. [The `public/` Convention](#13-the-public-convention)
14. [Beyond Zero-Code](#14-beyond-zero-code)
15. [Appendix A — Environment Variables](#appendix-a--environment-variables)
16. [Appendix B — Collection Config Keys](#appendix-b--collection-config-keys)
17. [Appendix C — Generated Endpoints](#appendix-c--generated-endpoints)
18. [Appendix D — Annotated Manifest](#appendix-d--annotated-manifest)

---

## 1. What Is mdb-engine?

**mdb-engine** is a Python framework that turns a JSON manifest into a
production-grade REST API backed by MongoDB. It wraps FastAPI, Motor (async
MongoDB driver), and Pydantic V2 with:

- **Automatic data isolation** — every query is scoped by `app_id`
- **Manifest-driven configuration** — collections, auth, hooks, scopes,
  pipelines, and more declared in JSON
- **Optional AI services** — memory, embeddings, knowledge graphs, and
  ChatEngine available via `pip install mdb-engine[ai]`

### What It Replaces

| Traditional Stack | mdb-engine Equivalent |
|---|---|
| Django models + serializers + views + urls.py + admin | `manifest.json` collections with `auto_crud: true` |
| Express routes + Mongoose schemas + passport.js | `manifest.json` with `auth.users` + collection schemas |
| Rails models + controllers + migrations + routes.rb | `manifest.json` — no migrations needed (schemaless MongoDB) |
| Custom audit middleware | `hooks.after_create` / `after_update` / `after_delete` |
| Cascade delete middleware (e.g. Django signals, Mongoose pre-hooks) | `cascade.on_delete` / `on_soft_delete` arrays |
| Background cron for TTL cleanup | `ttl: { "field": "ts", "expire_after": "90d" }` |
| Scheduled cron jobs (node-cron, Celery Beat, APScheduler) | `jobs` config with cron, `@daily`, or interval schedules |
| SSR frameworks (Next.js, Nuxt, SvelteKit) | `ssr` config with template routes, data binding, and SEO |
| Manual RBAC middleware | `auth.write_roles`, `policy`, `owner_field`, `role_hierarchy` |
| TypeScript client generators (openapi-typescript, orval) | `mdb-engine codegen` — auto-generates typed clients from the manifest |

The design principle:

> **MQL is the DSL.** Every `scopes`, `pipelines`, `defaults`, `hooks`,
> `relations`, and `computed` value is a native MongoDB Query Language
> expression. The manifest speaks the same language as the database — no
> translation layer, no custom syntax. Declare what you want. The engine
> handles the rest.

---

## 2. Architecture

### How `mdb-engine serve` Works

```
mdb-engine serve manifest.json --reload
        │
        ▼
┌─────────────────────────┐
│  CLI (serve command)    │  Reads manifest, sets env vars,
│  cli/commands/serve.py  │  launches uvicorn
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│  _serve_app.py          │  Creates MongoDBEngine instance,
│  (uvicorn entrypoint)   │  calls engine.create_app(slug, manifest)
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│  MongoDBEngine          │  Connects to MongoDB, validates manifest,
│  core/fastapi_app.py    │  seeds demo users, creates indexes
└────────┬────────────────┘
         │
         ├──► mount_auto_crud_routes()    → REST endpoints for each collection
         ├──► setup auth middleware        → JWT sessions, CSRF, rate limiting
         ├──► mount /auth/* endpoints      → register, login, logout, me
         ├──► mount SSR routes             → server-rendered HTML from templates
         ├──► start job scheduler          → cron / interval background tasks
         ├──► mount public/ static files   → index.html at /, assets at /public/
         └──► mount /docs                  → OpenAPI / Swagger UI
```

### Request Flow

```mermaid
sequenceDiagram
    participant Client
    participant FastAPI
    participant AuthMiddleware
    participant AutoCRUD
    participant ScopedDB
    participant MongoDB

    Client->>FastAPI: GET /api/posts?scope=published
    FastAPI->>AuthMiddleware: Check session cookie
    AuthMiddleware-->>FastAPI: user (or None for public_read)
    FastAPI->>AutoCRUD: Route handler
    AutoCRUD->>AutoCRUD: Resolve scope "published" → {status: "published"}
    AutoCRUD->>AutoCRUD: Resolve policy (read filter)
    AutoCRUD->>ScopedDB: find({status: "published", app_id: "..."})
    ScopedDB->>MongoDB: db.posts.find(...)
    MongoDB-->>ScopedDB: documents
    ScopedDB-->>AutoCRUD: results
    AutoCRUD-->>Client: { "data": [...] }
```

Every query passes through `ScopedCollectionWrapper`, which automatically
injects the `app_id` filter. You never hardcode `app_id` — the framework
handles multi-tenancy transparently.

---

## 3. The Three Tiers

mdb-engine offers three levels of abstraction depending on how much control
you need.

### Tier 1 — Zero-config (`quickstart`)

Fastest path. One function call, one dependency.

```python
from mdb_engine import quickstart
from mdb_engine.dependencies import get_scoped_db
from fastapi import Depends

app = quickstart("my_app")

@app.get("/items")
async def list_items(db=Depends(get_scoped_db)):
    return await db.items.find({}).to_list(10)
```

Reads `MONGODB_URI` / `MDB_MONGO_URI` from environment (falls back to
`localhost:27017`). No manifest, no config files.

### Tier 2 — Manifest-based (`create_app`)

Full manifest power. Collections, auth, hooks, scopes — all in JSON.

```python
from pathlib import Path
from mdb_engine import MongoDBEngine

engine = MongoDBEngine(mongo_uri="mongodb://localhost:27017", db_name="mydb")
app = engine.create_app(slug="my_app", manifest=Path("manifest.json"))
```

This is what `mdb-engine serve` uses internally. The manifest defines
everything; Python code is optional.

### Tier 3 — Multi-app (`create_multi_app`)

Run multiple apps on a single engine with isolated data and optional SSO.

```python
app = engine.create_multi_app(
    apps=[
        {"slug": "blog", "manifest": Path("blog/manifest.json"), "path_prefix": "/blog"},
        {"slug": "store", "manifest": Path("store/manifest.json"), "path_prefix": "/store"},
    ],
    title="My Platform",
)
```

Each app gets its own `app_id` scope, collections, and auth config — but they
share a single MongoDB connection and can optionally share users via
`SharedUserPool`.

---

## 4. Manifest-Driven Development

The manifest is a JSON file that serves as the **single source of truth** for
your application. It replaces models, routes, middleware, migrations, and admin
config.

### Minimal Manifest

```json
{
  "schema_version": "2.0",
  "slug": "my_app",
  "name": "My Application"
}
```

This alone gives you a running FastAPI app with OpenAPI docs at `/docs`.

### Adding a Collection

```json
{
  "schema_version": "2.0",
  "slug": "my_app",
  "name": "My Application",
  "collections": {
    "tasks": {
      "auto_crud": true,
      "schema": {
        "type": "object",
        "properties": {
          "title": { "type": "string" },
          "status": { "type": "string", "enum": ["pending", "done"] }
        },
        "required": ["title"]
      }
    }
  }
}
```

This generates a complete REST API for `tasks`:

```
GET    /api/tasks          — list (filter, sort, paginate)
GET    /api/tasks/_count   — count
GET    /api/tasks/{id}     — get by ID
POST   /api/tasks          — create (with schema validation)
POST   /api/tasks/_bulk    — bulk create
PUT    /api/tasks/{id}     — full replace
PATCH  /api/tasks/{id}     — partial update
DELETE /api/tasks/{id}     — delete
```

No Python. No route definitions. No ORM. Just JSON.

### The Philosophy

Traditional web development follows a **code-first** approach: you write
models, then routes, then middleware, then tests, then migrations. Every feature
requires touching multiple files in multiple languages.

mdb-engine follows a **manifest-first** approach: you declare what you want in
JSON, and the engine generates the implementation. Conditional hooks, atomic
update operators, cascade deletes, per-scope caching, server-side rendering,
and scheduled jobs are all expressible declaratively — no Python required for
the vast majority of applications. When you do need custom behavior, you drop
into Python and use the framework's abstractions (`RequestContext`,
`UnitOfWork`, `Entity`).

The manifest speaks MQL — MongoDB Query Language. Scopes are MQL filters.
Pipelines are MQL aggregations. Defaults are MQL-compatible values. Hook
updates use MQL atomic operators (`$inc`, `$push`, `$pull`). There is no
proprietary DSL to learn. If you know MongoDB, you know the manifest.

---

## 5. Zero-Code Collections Deep Dive

Every key in a collection config controls a specific behavior. Here is the
complete reference with examples.

### 5.1 `auto_crud`

**Type:** `boolean` | **Default:** `true`

When `true`, the engine generates all REST endpoints for this collection.
Set to `false` if you want to define custom routes only.

```json
{ "auto_crud": true }
```

### 5.2 `schema`

**Type:** `object` (JSON Schema)

Standard JSON Schema for document validation. Documents that fail validation
are rejected with 422. Supports several `x-*` extensions for constraints that
go beyond standard JSON Schema.

```json
{
  "schema": {
    "type": "object",
    "properties": {
      "title": { "type": "string" },
      "email": { "type": "string", "x-unique": true },
      "status": { "type": "string", "enum": ["active", "inactive"] }
    },
    "required": ["title", "email"]
  }
}
```

- `x-unique: true` auto-creates a unique index at startup. Duplicates return
  `409 Conflict`.
- `required` fields are validated on POST. Missing fields return 422.
- `enum` values are validated. Invalid values return 422.

#### `x-references` — Referential Integrity

**Type:** `object` on a schema property

Declares that a field references a document in another collection. The engine
validates on write that the referenced document exists — if it does not, the
request returns `422 Unprocessable Entity`.

```json
{
  "schema": {
    "type": "object",
    "properties": {
      "post_id": {
        "type": "string",
        "x-references": { "collection": "posts", "field": "_id" }
      }
    }
  }
}
```

| Key | Description |
|---|---|
| `collection` | The target collection to look up |
| `field` | The field in the target collection to match against (usually `_id`) |

This replaces manual "does this post exist?" checks in your route handlers.
Combine with `cascade` on the parent collection to handle cleanup when the
referenced document is deleted.

#### `x-values-from` — Lookup Validation

**Type:** `object` on a schema property

Constrains field values to those found in another collection. Works like a
dynamic enum — the allowed values come from a live query rather than a
hardcoded list.

```json
{
  "schema": {
    "type": "object",
    "properties": {
      "tags": {
        "type": "array",
        "items": { "type": "string" },
        "x-values-from": { "collection": "tags", "field": "name" }
      }
    }
  }
}
```

| Key | Description |
|---|---|
| `collection` | The collection containing valid values |
| `field` | The field whose distinct values form the allowlist |

On every write, the engine fetches distinct values of `field` from
`collection` and rejects any value not in the set. This keeps your data
consistent without hardcoding enums — add a new tag document and the value
immediately becomes valid.

### 5.3 `soft_delete`

**Type:** `boolean` | **Default:** `false`

When enabled, `DELETE` sets a `deleted_at` timestamp instead of removing the
document. Adds trash and restore endpoints.

```json
{ "soft_delete": true }
```

Extra endpoints generated:

| Method | Path | Description |
|---|---|---|
| GET | `/api/{name}/_trash` | List soft-deleted documents |
| POST | `/api/{name}/{id}/_restore` | Restore a soft-deleted document |

All normal `GET` queries automatically exclude soft-deleted documents.

### 5.4 `timestamps`

**Type:** `boolean` | **Default:** `true`

Automatically injects `created_at` (on create) and `updated_at` (on every
write). Set to `false` for collections like `audit_log` that manage their own
time fields.

```json
{ "timestamps": false }
```

### 5.5 `read_only`

**Type:** `boolean` | **Default:** `false`

Only generates GET endpoints. POST, PUT, PATCH, DELETE return `405 Method Not
Allowed`. Ideal for audit logs, analytics tables, or externally-populated data.

```json
{ "read_only": true }
```

### 5.6 `bulk_insert`

**Type:** `boolean` | **Default:** `true`

Enables `POST /api/{name}/_bulk` for batch inserts (up to 1000 documents).
Each document is validated individually. Hooks fire per document.

```json
{ "bulk_insert": true }
```

### 5.7 `defaults`

**Type:** `object`

Default values applied to new documents via `setdefault` — caller-provided
values always take precedence. Supports template placeholders.

```json
{
  "defaults": {
    "status": "draft",
    "tags": [],
    "author": "{{user.email}}",
    "owner_id": "{{user._id}}"
  }
}
```

- Static defaults: `"status": "draft"`, `"tags": []`
- User-derived defaults: `"author": "{{user.email}}"` resolves to the
  authenticated user's email at runtime
- If a placeholder like `{{user.email}}` is used and no user is authenticated,
  the request returns 401

### 5.8 `scopes`

**Type:** `object`

Named MQL filters activated via `?scope=name` query parameter. Two formats
supported:

**Plain filter:**

```json
{
  "scopes": {
    "published": { "status": "published" },
    "active": { "status": { "$ne": "archived" } },
    "recent": { "created_at": { "$gt": "$$NOW" } }
  }
}
```

**Extended (with auth):**

```json
{
  "scopes": {
    "pending": {
      "filter": { "approved": false },
      "auth": { "roles": ["admin"] }
    }
  }
}
```

The extended format lets you restrict who can activate a scope. The `pending`
scope above returns 403 unless the user has the `admin` role.

**Usage:**

```
GET /api/posts?scope=published          — single scope
GET /api/posts?scope=published,recent   — multiple scopes ($and-merged)
GET /api/posts/_count?scope=published   — count with scope
```

Unknown scope names return 400.

### 5.9 `pipelines`

**Type:** `object`

Named aggregation pipelines exposed as `GET /api/{name}/_agg/{pipeline_name}`.
The engine automatically prepends an `app_id` `$match` stage.

```json
{
  "pipelines": {
    "by_status": [
      { "$group": { "_id": "$status", "count": { "$sum": 1 } } },
      { "$sort": { "count": -1 } }
    ],
    "by_tag": [
      { "$unwind": "$tags" },
      { "$group": { "_id": "$tags", "count": { "$sum": 1 } } },
      { "$sort": { "count": -1 } }
    ]
  }
}
```

```bash
curl "http://localhost:8000/api/posts/_agg/by_status"
# [{"_id": "published", "count": 12}, {"_id": "draft", "count": 3}]

curl "http://localhost:8000/api/posts/_agg/by_tag"
# [{"_id": "python", "count": 8}, {"_id": "mongodb", "count": 5}]
```

### 5.10 `hooks`

**Type:** `object`

Lifecycle hooks that fire after write operations. Three events supported:
`after_create`, `after_update`, `after_delete`. See
[Section 7 — Hooks Deep Dive](#7-hooks-deep-dive) for the full reference
including conditional hooks, atomic operators, and advanced modes.

```json
{
  "hooks": {
    "after_create": [
      {
        "action": "insert",
        "collection": "audit_log",
        "document": {
          "event": "post_created",
          "entity": "posts",
          "entity_id": "{{doc._id}}",
          "actor": "{{user.email}}",
          "timestamp": "$$NOW"
        }
      }
    ]
  }
}
```

Hook documents support all template placeholders: `{{doc.*}}`, `{{user.*}}`,
`{{prev.*}}`, `{{env.*}}`, and `$$NOW`.

Hooks fire for every document in a bulk insert, ensuring audit trails have no
blind spots.

### 5.11 `computed`

**Type:** `object`

Virtual fields computed at read time via aggregation pipelines. Activated with
`?computed=field_name` query parameter.

```json
{
  "computed": {
    "comment_count": {
      "pipeline": [
        {
          "$lookup": {
            "from": "comments",
            "let": { "pid": { "$toString": "$_id" } },
            "pipeline": [
              { "$match": { "$expr": { "$eq": ["$post_id", "$$pid"] } } }
            ],
            "as": "_comments"
          }
        },
        { "$addFields": { "comment_count": { "$size": "$_comments" } } },
        { "$project": { "_comments": 0 } }
      ]
    }
  }
}
```

```bash
curl "http://localhost:8000/api/posts?scope=published&computed=comment_count"
# Each post now has a "comment_count" field — computed live, never stale
```

No denormalization, no background sync, no stale counts. The aggregation runs
at query time.

### 5.12 `relations`

**Type:** `object`

Cross-collection joins populated at read time via `?populate=name`. Uses
MongoDB `$lookup` under the hood.

```json
{
  "relations": {
    "post": {
      "from": "posts",
      "local_field": "post_id",
      "foreign_field": "_id",
      "single": true
    }
  }
}
```

```bash
curl "http://localhost:8000/api/comments?scope=approved&populate=post"
```

```json
{
  "data": [{
    "_id": "...",
    "body": "Great post!",
    "post": {
      "_id": "...",
      "title": "Hello World",
      "body": "..."
    }
  }]
}
```

- `single: true` returns a single object (like MongoDB's `$unwind`)
- `single: false` (default) returns an array

### 5.13 `policy`

**Type:** `object`

Document-level access control via MQL filters. Applied automatically to every
query.

```json
{
  "policy": {
    "read":   { "team_id": "{{user.team_id}}" },
    "write":  { "owner_id": "{{user._id}}" },
    "delete": { "owner_id": "{{user._id}}" }
  }
}
```

- `read` — merged into every GET query
- `write` — merged into PUT/PATCH lookups
- `delete` — merged into DELETE lookups (falls back to `write` if omitted)

If a `{{user.*}}` placeholder is used and no user is authenticated, the
endpoint returns 401.

### 5.14 `owner_field`

**Type:** `string`

The field that stores the document creator's user ID. When set, the engine:

1. Auto-injects the creator's `_id` as a default on create
2. Generates implicit write/delete policies (owner can modify, admin bypasses)
3. Enforces ownership on restore (soft delete)

```json
{ "owner_field": "author_id" }
```

### 5.15 `immutable_fields`

**Type:** `array`

Fields that cannot be changed after creation. Silently stripped from PUT/PATCH
bodies.

```json
{ "immutable_fields": ["author_id", "post_id"] }
```

Even if a client sends `{"author_id": "hacked"}` in a PATCH, the engine strips
it silently. No error, no escalation path.

### 5.16 `writable_fields`

**Type:** `array` | `object` (per-role)

Allowlist of fields that clients can write. Everything else is stripped. This is
an allowlist approach (safer than a denylist).

**Flat list (all writers share the same allowlist):**

```json
{ "writable_fields": ["title", "body", "author", "status", "tags"] }
```

**Per-role object (different roles can write different fields):**

```json
{
  "writable_fields": {
    "editor": ["title", "body", "author", "status", "tags"],
    "moderator": ["status", "tags"]
  }
}
```

In the per-role form, the engine looks up the user's role (or highest role via
`role_hierarchy`) and applies the corresponding allowlist. A `moderator` can
update `status` and `tags` but cannot touch `title` or `body`. An `editor` gets
the full set. Roles not listed in the object have no write access at all (the
request is rejected with 403).

A client cannot inject `internal_flag`, `admin_override`, or any other
undeclared field regardless of form.

### 5.17 `ttl`

**Type:** `object`

MongoDB TTL index for automatic document expiry. No cron jobs, no cleanup code.

```json
{
  "ttl": {
    "field": "timestamp",
    "expire_after": "90d"
  }
}
```

Supported duration formats: `"90d"` (days), `"24h"` (hours), `"3600s"`
(seconds), or an integer (seconds).

### 5.18 `max_body_bytes`

**Type:** `integer` | **Default:** `1048576` (1 MB)

Maximum request body size for write endpoints. Prevents memory exhaustion
attacks.

```json
{ "max_body_bytes": 524288 }
```

### 5.19 `default_projection`

**Type:** `object`

MongoDB projection applied to all reads when the client does not specify
`?fields=`. Use to hide internal fields.

```json
{
  "default_projection": { "internal_notes": 0, "audit_trail": 0 }
}
```

### 5.20 `auth` (per-collection)

**Type:** `object`

Per-collection authentication and authorization overrides.

```json
{
  "auth": {
    "public_read": true,
    "create_required": true,
    "write_roles": ["admin"],
    "required": false
  }
}
```

| Key | Effect |
|---|---|
| `public_read` | Anonymous users can GET. Writes still require auth. |
| `required` | All endpoints require authentication (default when app auth is enabled) |
| `create_required` | POST requires auth, but any role suffices |
| `write_roles` | PUT/PATCH/DELETE restricted to these roles |

### 5.21 `cascade`

**Type:** `object`

Declarative cascade rules that fire when a document in this collection is
deleted or soft-deleted. Replaces custom middleware, Django signals, or
Mongoose `pre("remove")` hooks.

```json
{
  "cascade": {
    "on_delete": [
      { "collection": "comments", "match_field": "post_id", "action": "delete" }
    ],
    "on_soft_delete": [
      { "collection": "comments", "match_field": "post_id", "action": "soft_delete" }
    ]
  }
}
```

| Key | Description |
|---|---|
| `on_delete` | Array of rules that fire on hard delete (`DELETE` without `soft_delete`, or permanent purge) |
| `on_soft_delete` | Array of rules that fire on soft delete (`DELETE` when `soft_delete: true`) |

Each rule specifies:

| Field | Description |
|---|---|
| `collection` | The child collection to cascade into |
| `match_field` | The field on the child that references this document's `_id` |
| `action` | `"delete"` (hard delete) or `"soft_delete"` (set `deleted_at`) |

In the blog example, deleting a post hard-deletes all its comments. Soft-
deleting a post soft-deletes all its comments (so they can be restored
together). The cascade runs inside the same request — no background job, no
eventual consistency.

### 5.22 `cache`

**Type:** `object`

Per-scope response cache directives. The engine caches GET responses in memory
(or via a configured cache backend) and returns them without hitting MongoDB
on subsequent requests until the TTL expires.

```json
{
  "cache": {
    "scope:published": { "ttl": "5m", "stale_while_revalidate": "30s" },
    "default": { "ttl": "0s" }
  }
}
```

| Key | Description |
|---|---|
| `scope:<name>` | Cache rule applied when the request uses `?scope=<name>` |
| `default` | Fallback cache rule for requests that don't match a scope key |
| `ttl` | How long the cached response is considered fresh (`"5m"`, `"1h"`, `"30s"`) |
| `stale_while_revalidate` | Serve stale content while refreshing in the background |

Setting `"ttl": "0s"` disables caching for that scope. This is useful for
draft or admin scopes where you always want fresh data, while caching the
public-facing published scope aggressively.

Write operations (`POST`, `PUT`, `PATCH`, `DELETE`) automatically invalidate
the relevant cache entries.

---

## 6. Template Placeholders

The manifest supports five types of runtime placeholders, resolved by
`template_resolver.py`:

### `{{user.*}}`

Resolves to a value from the authenticated user object. Dot paths up to 3
levels deep.

| Placeholder | Resolves To |
|---|---|
| `{{user._id}}` | The user's `_id` field |
| `{{user.email}}` | The user's email |
| `{{user.role}}` | The user's role |
| `{{user.team_id}}` | Any top-level user field |
| `{{user.profile.org}}` | Nested path (max 3 levels) |

If the user is `None` (not authenticated), the engine returns **401**.

### `{{doc.*}}`

Resolves to a value from the document being created, updated, or deleted.
Used in hooks.

| Placeholder | Resolves To |
|---|---|
| `{{doc._id}}` | The document's `_id` (as string) |
| `{{doc.title}}` | Any field on the document |
| `{{doc.author.name}}` | Nested paths supported |

If the document is `None`, the placeholder is left as-is (no error).

### `{{prev.*}}`

Resolves to a value from the **previous version** of the document before the
update. Only available in `after_update` hooks. This enables change-detection
logic — you can compare the old and new values of any field.

| Placeholder | Resolves To |
|---|---|
| `{{prev.status}}` | The field's value before the update |
| `{{prev.approved}}` | Any field from the previous document |

Combine with conditional hooks to trigger actions only when a specific field
transitions:

```json
{
  "if": {
    "doc.status": "published",
    "prev.status": { "$ne": "published" }
  }
}
```

This fires only when `status` changes *to* `"published"` — not on every update
to an already-published document. See
[Section 7 — Hooks Deep Dive](#7-hooks-deep-dive) for full details.

### `{{env.*}}`

Resolves to an environment variable. Keys must match `^[A-Z_][A-Z0-9_]*$`.

| Placeholder | Resolves To |
|---|---|
| `{{env.ADMIN_EMAIL}}` | Value of `$ADMIN_EMAIL` |
| `{{env.ADMIN_PASSWORD}}` | Value of `$ADMIN_PASSWORD` |
| `{{env.INVITE_CODE}}` | Value of `$INVITE_CODE` |

If the environment variable is not set, the engine returns **400**.

### `$$NOW`

Resolves to the current UTC datetime (`datetime.now(timezone.utc)`).

```json
{ "timestamp": "$$NOW" }
```

### Resolution Context

| Placeholder | Available In |
|---|---|
| `{{user.*}}` | `defaults`, `scopes`, `policy`, `hooks`, `pipelines` |
| `{{doc.*}}` | `hooks` only (the document has been created/updated/deleted) |
| `{{prev.*}}` | `after_update` hooks only (the document before the update) |
| `{{env.*}}` | `demo_users`, `invite_codes` |
| `$$NOW` | `scopes`, `hooks`, `defaults` |

---

## 7. Hooks Deep Dive

Hooks are the manifest's answer to business logic. They fire after write
operations and can insert audit records, update counters, send webhooks,
cascade changes, and more — all without writing Python.

### Events

| Event | When It Fires | Available Contexts |
|---|---|---|
| `after_create` | After a document is inserted | `{{doc.*}}`, `{{user.*}}`, `$$NOW` |
| `after_update` | After a document is updated (PUT/PATCH) | `{{doc.*}}`, `{{prev.*}}`, `{{user.*}}`, `$$NOW` |
| `after_delete` | After a document is deleted or soft-deleted | `{{doc.*}}`, `{{user.*}}`, `$$NOW` |

Each event holds an array of hook objects. They execute in order.

### Actions

#### `insert` — Create a Document

Inserts a document into the target collection.

```json
{
  "action": "insert",
  "collection": "audit_log",
  "document": {
    "event": "post_created",
    "entity_id": "{{doc._id}}",
    "actor": "{{user.email}}",
    "timestamp": "$$NOW"
  }
}
```

#### `update` — Modify Existing Documents

Updates documents matching a filter. Supports the full range of MQL atomic
update operators.

```json
{
  "action": "update",
  "collection": "posts",
  "filter": { "_id": "{{doc.post_id}}" },
  "update": { "$inc": { "comment_count": 1 } }
}
```

**Supported atomic operators:**

| Operator | Effect | Example |
|---|---|---|
| `$set` | Set a field | `{ "$set": { "status": "archived" } }` |
| `$inc` | Increment/decrement a numeric field | `{ "$inc": { "comment_count": 1 } }` |
| `$push` | Append to an array | `{ "$push": { "tags": "featured" } }` |
| `$pull` | Remove from an array | `{ "$pull": { "tags": "deprecated" } }` |
| `$unset` | Remove a field | `{ "$unset": { "temp_flag": "" } }` |
| `$addToSet` | Append only if not already present | `{ "$addToSet": { "subscribers": "{{user._id}}" } }` |

These are standard MongoDB update operators — the engine passes them through
to Motor unchanged. You can use any operator MongoDB supports.

#### `delete` — Remove Documents

Deletes documents matching a filter from the target collection.

```json
{
  "action": "delete",
  "collection": "temp_data",
  "filter": { "parent_id": "{{doc._id}}" }
}
```

#### `http` — External Webhook

Sends an HTTP request to an external URL. Useful for notifying Slack, triggering
CI/CD, or integrating with third-party services.

```json
{
  "action": "http",
  "method": "POST",
  "url": "https://hooks.slack.com/services/T.../B.../xxx",
  "headers": { "Content-Type": "application/json" },
  "body": {
    "text": "New post published: {{doc.title}}"
  }
}
```

| Field | Description |
|---|---|
| `method` | HTTP method (`GET`, `POST`, `PUT`, `DELETE`) |
| `url` | Target URL (supports `{{env.*}}` for secrets) |
| `headers` | Optional request headers |
| `body` | Request body (template placeholders resolved before sending) |

### Conditional Hooks with `if`

Add an `if` object to a hook to make it fire only when conditions are met.
Each key is a dot-path into `doc` or `prev`, and the value is either a literal
(equality check) or an MQL comparison operator.

```json
{
  "action": "insert",
  "collection": "notifications",
  "document": {
    "type": "post_published",
    "message": "{{doc.title}} has been published",
    "entity_id": "{{doc._id}}",
    "actor": "{{user.email}}",
    "read": false,
    "timestamp": "$$NOW"
  },
  "if": {
    "doc.status": "published",
    "prev.status": { "$ne": "published" }
  }
}
```

This hook only fires when `status` transitions to `"published"`. All
conditions in `if` are AND-ed together.

**Common patterns:**

```json
// Fire when a comment gets approved
{ "if": { "doc.approved": true, "prev.approved": false } }

// Fire only for admin users
{ "if": { "user.role": "admin" } }

// Fire when status is not "draft"
{ "if": { "doc.status": { "$ne": "draft" } } }
```

### Transactional Mode

By default, hooks are fire-and-forget — a hook failure never blocks the API
response. Set `"transactional": true` to run the hook inside the same MongoDB
transaction as the triggering write. If the hook fails, the entire operation
rolls back.

```json
{
  "action": "update",
  "collection": "posts",
  "filter": { "_id": "{{doc.post_id}}" },
  "update": { "$inc": { "comment_count": 1 } },
  "transactional": true
}
```

Use transactional mode for operations where data consistency is critical (e.g.,
counter updates, balance adjustments). Avoid it for audit logs or notifications
where eventual delivery is acceptable.

### Background Mode with Retry

Set `"background": true` to defer the hook to a background task. The API
response returns immediately, and the hook executes asynchronously with
automatic retries on failure.

```json
{
  "action": "http",
  "method": "POST",
  "url": "https://hooks.slack.com/services/...",
  "body": { "text": "New post: {{doc.title}}" },
  "background": true
}
```

Background hooks retry up to 3 times with exponential backoff. If all retries
fail, the failure is recorded in the `_hook_failures` system collection.

### `_hook_failures` System Collection

When a hook fails (after all retries in background mode, or on the first
attempt in default mode), the engine records the failure:

```json
{
  "_id": "...",
  "hook_event": "after_update",
  "source_collection": "comments",
  "source_id": "abc123",
  "action": "http",
  "error": "Connection refused",
  "attempts": 3,
  "last_attempt": "2026-03-17T12:00:00Z",
  "app_id": "zero_code_blog"
}
```

Query this collection to monitor hook health:

```bash
curl "http://localhost:8000/api/_hook_failures?sort=-last_attempt&limit=20"
```

The collection is automatically created and has a 30-day TTL.

---

## 8. Authentication & Security

### Secure-by-Default

When `auth.users.enabled` is `true`, **every collection endpoint requires
authentication** — reads, writes, deletes, everything. You don't need to add
`"auth": {"required": true}` to each collection.

Per-collection `auth` can only *relax* access in one specific way:
`public_read: true` allows anonymous GETs. There is no way to make writes
public when app-level auth is on.

### Auth Configuration

```json
{
  "auth": {
    "mode": "app",
    "users": {
      "enabled": true,
      "strategy": "app_users",
      "allow_registration": true,
      "registration_role": "reader",
      "max_login_attempts": 5,
      "login_lockout_seconds": 900,
      "session_cookie_name": "blog_session",
      "role_hierarchy": {
        "admin": ["editor", "moderator", "reader"],
        "editor": ["reader"],
        "moderator": ["reader"]
      },
      "demo_users": [
        {
          "email": "{{env.ADMIN_EMAIL}}",
          "password": "{{env.ADMIN_PASSWORD}}",
          "role": "admin"
        }
      ]
    }
  }
}
```

### Role Hierarchy

The `role_hierarchy` object declares which roles inherit permissions from which
other roles. Each key is a role name, and its value is an array of roles it
subsumes.

```json
{
  "role_hierarchy": {
    "admin": ["editor", "moderator", "reader"],
    "editor": ["reader"],
    "moderator": ["reader"]
  }
}
```

In this example:

- An `admin` inherits all permissions of `editor`, `moderator`, and `reader`.
- An `editor` inherits `reader` permissions.
- A `moderator` inherits `reader` permissions.

When a collection's `write_roles` includes `["editor"]`, an `admin` also
passes the check because `admin` subsumes `editor`. Without `role_hierarchy`,
you would need to list every allowed role explicitly:
`"write_roles": ["editor", "admin"]`.

The hierarchy is resolved transitively. If role A subsumes B and B subsumes C,
then A also subsumes C.

### Multi-Role Support

Users can hold multiple roles simultaneously via a `roles` array field. This
is useful when a user needs capabilities from two unrelated branches of the
hierarchy — for example, both `editor` and `moderator`.

```json
{
  "email": "jane@example.com",
  "role": "editor",
  "roles": ["editor", "moderator"]
}
```

The `role` field remains the user's primary role (used for `registration_role`
and backward compatibility). The `roles` array is the canonical source for
authorization checks. When evaluating `write_roles` or scope `auth.roles`,
the engine checks whether **any** of the user's roles (including those
inherited via `role_hierarchy`) satisfies the requirement.

### Generated Auth Endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/auth/register` | Create a new user (gets `registration_role`) |
| POST | `/auth/login` | Authenticate and receive session cookie |
| POST | `/auth/logout` | Clear session |
| GET | `/auth/me` | Current session info |

### Demo Users (Admin Seeding)

The `demo_users` array seeds users at startup. Supports `{{env.*}}`
placeholders so credentials never appear in the manifest file.

```json
"demo_users": [
  {
    "email": "{{env.ADMIN_EMAIL}}",
    "password": "{{env.ADMIN_PASSWORD}}",
    "role": "admin"
  }
]
```

Set environment variables:

```bash
export ADMIN_EMAIL=admin@example.com
export ADMIN_PASSWORD=supersecret
```

The engine resolves placeholders before hashing passwords and inserting users.
Users are only created if they don't already exist (idempotent).

### Automatic Security Features

| Feature | How It Works |
|---|---|
| **Users collection blocked** | The `users` collection is never exposed via auto-CRUD. Managed through `/auth/*` only. |
| **Protected fields** | `role`, `roles`, `password`, `password_hash`, `is_admin` are auto-immutable on every collection. |
| **Sensitive fields hidden** | `password` and `password_hash` are excluded from GET responses via `default_projection`. |
| **Per-role writable fields** | `writable_fields` object form restricts each role to a specific field allowlist. A moderator cannot edit title; an editor can. |
| **Writable fields allowlist** | Flat `writable_fields` restricts which fields all clients can write. Allowlist > denylist. |
| **Login rate limiting** | `max_login_attempts` (default 5) per email per 15 minutes. Returns 429 with `Retry-After`. |
| **Registration rate limiting** | 5 accounts per IP per hour. Returns 429. |
| **Request body size limit** | `max_body_bytes` (default 1 MB) per collection. |
| **Restore policy enforced** | Soft-delete `_restore` respects ownership policies. |
| **No plaintext secrets** | `{{env.*}}` in demo_users — never commit credentials. |
| **Role hierarchy enforcement** | `role_hierarchy` ensures inherited roles are checked transitively. |

### Registration Modes

**Open registration:**

```json
{ "allow_registration": true, "registration_role": "reader" }
```

**Invite-only:**

```json
{
  "allow_registration": "invite_only",
  "invite_codes": ["{{env.INVITE_CODE}}", "beta-tester-2025"]
}
```

Clients include `"invite_code"` in the registration body. Codes support
`{{env.*}}` so they can be rotated without changing the manifest.

---

## 9. Server-Side Rendering

mdb-engine includes a built-in SSR engine that renders Jinja2-style HTML
templates with data fetched from your collections. No separate frontend
framework needed — define routes, bind data, configure SEO, and the engine
serves fully-rendered HTML pages alongside the REST API.

### Enabling SSR

Add an `ssr` top-level key to your manifest:

```json
{
  "ssr": {
    "enabled": true,
    "site_name": "blog-zero",
    "site_description": "A full-featured blog built from a single JSON manifest.",
    "base_url": "",
    "sitemap": true,
    "routes": { }
  }
}
```

| Key | Description |
|---|---|
| `enabled` | Turn SSR on (`true`) or off (`false`) |
| `site_name` | Used in default SEO titles and sitemap metadata |
| `site_description` | Default meta description for pages without explicit SEO |
| `base_url` | Canonical URL prefix for SEO and sitemap (`""` for same-origin) |
| `sitemap` | Generate `/sitemap.xml` from SSR routes when `true` |

### Route Definitions

Each key in `ssr.routes` is a URL path. The engine registers it as a GET
route that renders a template with bound data.

```json
{
  "routes": {
    "/s": {
      "template": "index.html",
      "data": {
        "posts": {
          "collection": "posts",
          "scope": "published",
          "sort": { "created_at": -1 },
          "limit": 12,
          "computed": ["comment_count"]
        },
        "tag_stats": {
          "collection": "posts",
          "pipeline": "by_tag"
        }
      },
      "seo": {
        "title": "blog-zero",
        "description": "Stories from the edge of code and creativity."
      },
      "cache": { "ttl": "5m", "stale_while_revalidate": "30s" }
    }
  }
}
```

Each route object supports:

| Key | Description |
|---|---|
| `template` | Path to a Jinja2 template file (relative to `templates/` directory) |
| `data` | Object mapping variable names to data sources |
| `seo` | SEO metadata (title, description, og_type, json_ld) |
| `cache` | Response cache with `ttl` and optional `stale_while_revalidate` |
| `auth` | Optional auth requirements for the page |

### Data Binding

Each key in `data` becomes a variable available in the template. Data sources
can be:

**Collection query:**

```json
{
  "posts": {
    "collection": "posts",
    "scope": "published",
    "sort": { "created_at": -1 },
    "limit": 12,
    "computed": ["comment_count"]
  }
}
```

The template receives `posts` as a list of documents.

**Single document by route parameter:**

```json
{
  "post": {
    "collection": "posts",
    "id_param": "id"
  }
}
```

For a route like `/s/posts/{id}`, the engine extracts `id` from the URL and
fetches a single document. If not found, the engine returns a 404.

**Filtered query with route parameters:**

```json
{
  "comments": {
    "collection": "comments",
    "filter": { "post_id": "{{params.id}}", "approved": true },
    "sort": { "created_at": 1 },
    "limit": 100
  }
}
```

The `{{params.*}}` placeholder resolves to URL path parameters.

**Aggregation pipeline:**

```json
{
  "tag_stats": {
    "collection": "posts",
    "pipeline": "by_tag"
  }
}
```

Runs a named pipeline from the collection's `pipelines` config.

### SEO Configuration

Each route can declare SEO metadata that the engine injects into the rendered
HTML:

```json
{
  "seo": {
    "title": "{{post.title}} — blog-zero",
    "description": "{{post.excerpt}}",
    "og_type": "article",
    "json_ld": {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      "headline": "{{post.title}}",
      "datePublished": "{{post.created_at}}",
      "author": {
        "@type": "Person",
        "name": "{{post.author}}"
      },
      "publisher": {
        "@type": "Organization",
        "name": "blog-zero"
      }
    }
  }
}
```

SEO placeholders like `{{post.title}}` resolve against the data variables
fetched for the route. The engine sets `<title>`, `<meta name="description">`,
Open Graph tags, and injects JSON-LD `<script>` blocks automatically.

### Pagination Context

For list routes, the engine provides a `pagination` object in the template
context:

```
{{ pagination.page }}        — current page number (1-based)
{{ pagination.total_pages }} — total number of pages
{{ pagination.total_items }} — total document count
{{ pagination.has_next }}    — boolean
{{ pagination.has_prev }}    — boolean
{{ pagination.next_url }}    — URL for the next page
{{ pagination.prev_url }}    — URL for the previous page
```

Pagination is activated by the `limit` key in the data source. The page
number comes from the `?page=` query parameter on the SSR route.

### Sitemap Generation

When `"sitemap": true`, the engine generates a `/sitemap.xml` endpoint that
lists all SSR routes. For routes with dynamic segments (like `/s/posts/{id}`),
the engine queries the collection and generates a `<url>` entry for every
document.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://example.com/s</loc>
    <changefreq>daily</changefreq>
  </url>
  <url>
    <loc>https://example.com/s/posts/abc123</loc>
    <lastmod>2026-03-15T10:30:00Z</lastmod>
    <changefreq>weekly</changefreq>
  </url>
  <!-- ... one entry per published post -->
</urlset>
```

The `base_url` in the SSR config is prepended to each URL. Set it to your
production domain for correct absolute URLs.

### Custom Error Pages

Place `404.html` and `500.html` in the `templates/` directory to customize
error pages. The engine renders them with the same Jinja2 context (site name,
request path) so your error pages match your site's look and feel.

```
src/
├── manifest.json
├── templates/
│   ├── index.html     ← SSR home page
│   ├── post.html      ← SSR post detail page
│   ├── 404.html       ← Custom 404 page
│   └── 500.html       ← Custom 500 page
└── public/
    ├── css/
    └── js/
```

### Relationship to `public/`

SSR routes and the `public/` static directory coexist. Static files (CSS, JS,
images) live in `public/` and are served at `/public/*`. SSR templates
reference them via standard HTML:

```html
<link rel="stylesheet" href="/public/css/style.css">
<script src="/public/js/page-shell.js"></script>
```

The `public/index.html` file (if present) is still served at `/` — but if
you define an SSR route for `/`, the SSR route takes precedence. In the blog
example, the SSR home page is at `/s` to avoid conflict with the SPA shell
at `/`.

---

## 10. Scheduled Jobs

The `jobs` top-level config defines background tasks that run on a schedule.
Jobs replace external cron daemons, Celery Beat, or APScheduler for common
database maintenance tasks.

### Configuration

```json
{
  "jobs": {
    "archive_stale_drafts": {
      "schedule": "@daily",
      "action": "update",
      "collection": "posts",
      "filter": {
        "status": "draft",
        "updated_at": { "$lt": "$$NOW_MINUS_90D" }
      },
      "update": { "$set": { "status": "archived" } }
    }
  }
}
```

Each key in `jobs` is a job name (used in logs). Each job object specifies
when to run and what to do.

### Schedule Formats

| Format | Example | Description |
|---|---|---|
| Cron expression | `"0 3 * * *"` | Standard 5-field cron (minute hour day month weekday) |
| `@daily` | `"@daily"` | Shortcut for `0 0 * * *` (midnight UTC) |
| `@hourly` | `"@hourly"` | Shortcut for `0 * * * *` |
| `@weekly` | `"@weekly"` | Shortcut for `0 0 * * 0` (Sunday midnight) |
| `@monthly` | `"@monthly"` | Shortcut for `0 0 1 * *` (1st of month) |
| Interval | `"every 6h"` | Run every N hours/minutes/seconds (`"every 30m"`, `"every 6h"`) |

### Time Variables

Jobs support special time placeholders for date math:

| Variable | Resolves To |
|---|---|
| `$$NOW` | Current UTC datetime |
| `$$NOW_MINUS_1D` | 1 day ago |
| `$$NOW_MINUS_7D` | 7 days ago |
| `$$NOW_MINUS_30D` | 30 days ago |
| `$$NOW_MINUS_90D` | 90 days ago |
| `$$NOW_MINUS_1H` | 1 hour ago |

These are resolved at execution time. Combine with MQL comparison operators in
filters:

```json
{ "updated_at": { "$lt": "$$NOW_MINUS_90D" } }
```

### Actions

Jobs support two actions:

**`update` — Modify matching documents:**

```json
{
  "action": "update",
  "collection": "posts",
  "filter": { "status": "draft", "updated_at": { "$lt": "$$NOW_MINUS_90D" } },
  "update": { "$set": { "status": "archived" } }
}
```

The engine runs `update_many` — all matching documents are updated in a single
operation.

**`delete` — Remove matching documents:**

```json
{
  "action": "delete",
  "collection": "temp_uploads",
  "filter": { "created_at": { "$lt": "$$NOW_MINUS_1D" } }
}
```

Job executions are logged. Failed jobs are retried on the next schedule tick.

### Example: Multiple Jobs

```json
{
  "jobs": {
    "archive_stale_drafts": {
      "schedule": "@daily",
      "action": "update",
      "collection": "posts",
      "filter": { "status": "draft", "updated_at": { "$lt": "$$NOW_MINUS_90D" } },
      "update": { "$set": { "status": "archived" } }
    },
    "cleanup_old_notifications": {
      "schedule": "0 2 * * *",
      "action": "delete",
      "collection": "notifications",
      "filter": { "read": true, "timestamp": { "$lt": "$$NOW_MINUS_30D" } }
    },
    "expire_unverified_accounts": {
      "schedule": "@weekly",
      "action": "delete",
      "collection": "users",
      "filter": { "verified": false, "created_at": { "$lt": "$$NOW_MINUS_7D" } }
    }
  }
}
```

---

## 11. Generated REST API

### Endpoints Per Collection

For a collection named `tasks` with all features enabled:

| Method | Path | Description |
|---|---|---|
| GET | `/api/tasks` | List with filter, sort, paginate, scope, computed, populate |
| GET | `/api/tasks/_count` | Count with filter/scope support |
| GET | `/api/tasks/_trash` | List soft-deleted documents (if `soft_delete`) |
| GET | `/api/tasks/_agg/{name}` | Run a named aggregation pipeline |
| GET | `/api/tasks/{id}` | Get a single document by ID |
| POST | `/api/tasks` | Create (with defaults, schema validation, hooks) |
| POST | `/api/tasks/_bulk` | Bulk create up to 1000 documents |
| PUT | `/api/tasks/{id}` | Full replace |
| PATCH | `/api/tasks/{id}` | Partial update |
| DELETE | `/api/tasks/{id}` | Delete (or soft-delete) |
| POST | `/api/tasks/{id}/_restore` | Restore soft-deleted document |

### Query Parameters

All list endpoints (`GET /api/{name}`) support:

| Parameter | Example | Description |
|---|---|---|
| `scope` | `?scope=published` | Activate named scopes (comma-separated) |
| `computed` | `?computed=comment_count` | Include computed fields |
| `populate` | `?populate=post` | Populate relations |
| `sort` | `?sort=-created_at,title` | Sort (prefix `-` for descending) |
| `limit` | `?limit=10` | Max documents per page |
| `skip` | `?skip=20` | Skip N documents (pagination) |
| `fields` | `?fields=title,status` | Select specific fields (projection) |
| `filter` | `?status=published` | Field-level filter |
| | `?age=gt:18` | Comparison operator |
| | `?tags=in:python,go` | Set membership |

### Filter Operators

| Syntax | MongoDB Equivalent | Example |
|---|---|---|
| `field=value` | `{ field: value }` | `?status=active` |
| `field=gt:N` | `{ field: { $gt: N } }` | `?age=gt:18` |
| `field=gte:N` | `{ field: { $gte: N } }` | `?price=gte:10` |
| `field=lt:N` | `{ field: { $lt: N } }` | `?stock=lt:5` |
| `field=lte:N` | `{ field: { $lte: N } }` | `?rating=lte:3` |
| `field=ne:V` | `{ field: { $ne: V } }` | `?status=ne:deleted` |
| `field=in:a,b,c` | `{ field: { $in: [...] } }` | `?tags=in:python,go` |

---

## 12. CLI Tooling

### `mdb-engine serve`

Run a manifest as a live API server:

```bash
mdb-engine serve manifest.json --reload
mdb-engine serve manifest.json --host 0.0.0.0 --port 8080
mdb-engine serve manifest.json --mongo-uri mongodb://remote:27017 --db-name prod
```

Options:

| Flag | Default | Description |
|---|---|---|
| `--host` | `0.0.0.0` | Bind host |
| `--port` / `-p` | `8000` | Bind port |
| `--reload` | off | Auto-reload on file changes (dev mode) |
| `--mongo-uri` | `$MONGODB_URI` | MongoDB connection string |
| `--db-name` | `$MDB_DB_NAME` | Database name |

### `mdb-engine add-user`

Create users interactively (no secrets in files or env vars):

```bash
mdb-engine add-user manifest.json --email admin@corp.com --role admin
# Password: ********
# Confirm: ********
# User admin@corp.com created with role 'admin'.
```

### `mdb-engine validate`

Validate a manifest without starting the server:

```bash
mdb-engine validate manifest.json
```

### `mdb-engine new-app`

Scaffold a new mdb-engine project:

```bash
mdb-engine new-app my_project
```

### `mdb-engine doctor`

Diagnose common configuration issues:

```bash
mdb-engine doctor
```

### `mdb-engine diff`

Compare two manifest versions and show a structured diff of what changed.
Useful for reviewing manifest changes before deploying.

```bash
mdb-engine diff manifest.old.json manifest.json
```

```
 collections.posts.writable_fields:
-  ["title", "body", "author", "status", "tags"]
+  { "editor": ["title", "body", "author", "status", "tags"], "moderator": ["status", "tags"] }

 collections.posts.cascade:
+  { "on_delete": [...], "on_soft_delete": [...] }

 auth.users.role_hierarchy:
+  { "admin": ["editor", "moderator", "reader"], ... }
```

The diff is schema-aware — it understands collection configs, auth changes,
and top-level sections. It highlights additions (+), removals (-), and
modifications (~).

### `mdb-engine dry-run`

Start the engine, validate the manifest, create indexes, and report what
would be generated — without actually starting the HTTP server.

```bash
mdb-engine dry-run manifest.json
```

```
✓ Manifest valid (schema_version 2.0)
✓ 6 collections: posts, comments, categories, tags, notifications, audit_log
✓ 42 REST endpoints generated
✓ 2 SSR routes: /s, /s/posts/{id}
✓ 1 scheduled job: archive_stale_drafts (@daily)
✓ 4 managed indexes created
✓ 1 demo user seeded
✓ Sitemap: /sitemap.xml (2 static + dynamic entries)
```

This is useful in CI/CD pipelines to verify manifests before deployment.

### `mdb-engine codegen`

Generate typed client code from the manifest. Produces TypeScript types,
API client functions, and optionally React hooks or Vue composables.

```bash
mdb-engine codegen manifest.json --lang typescript --output ./client/
mdb-engine codegen manifest.json --lang typescript --react-hooks --output ./client/
```

Generates:

```
client/
├── types.ts         ← TypeScript interfaces for each collection schema
├── api.ts           ← Typed fetch functions (createPost, listPosts, etc.)
└── hooks.ts         ← React hooks (usePosts, usePost, etc.) — if --react-hooks
```

The generated client respects `writable_fields`, `schema.required`, and
`schema.enum` constraints — giving you compile-time safety against invalid
API calls.

---

## 13. The `public/` Convention

When using `mdb-engine serve`, the engine auto-detects a `public/` directory
next to the manifest and serves it:

- `public/index.html` is served at `/` (the root)
- All files in `public/` are available under `/public/`

```
my_app/
├── manifest.json
└── public/
    ├── index.html      ← served at /
    ├── styles.css       ← served at /public/styles.css
    └── app.js           ← served at /public/app.js
```

**Same-origin advantage:** Because the frontend and API run on the same origin,
there are no CORS issues. Your JavaScript can call `fetch("/api/posts")` with
no extra configuration. Session cookies work automatically.

This is inspired by Rails' `public/` directory convention. No build step, no
webpack, no proxy config. Just drop HTML files next to the manifest.

---

## 14. Beyond Zero-Code

Zero-code collections handle most CRUD APIs. When you need custom business
logic, mdb-engine provides Python-level abstractions:

### Custom Routes with RequestContext

```python
from mdb_engine.dependencies import RequestContext, get_request_context

@app.post("/api/publish/{post_id}")
async def publish(post_id: str, ctx: RequestContext = Depends(get_request_context)):
    ctx.require_role("editor")
    db = await ctx.get_db()
    await db.posts.update_one({"_id": post_id}, {"$set": {"status": "published"}})
    if ctx.memory:
        await ctx.memory.add(messages=f"Published post {post_id}", user_id=ctx.user["_id"])
    return {"ok": True}
```

`RequestContext` is the all-in-one dependency. It provides lazy access to
database, auth, memory, embeddings, LLM, and more.

### Repository Pattern

```python
from dataclasses import dataclass
from mdb_engine.repositories import Entity

@dataclass
class Invoice(Entity):
    customer_id: str = ""
    amount: float = 0.0
    status: str = "draft"
```

```python
from mdb_engine.dependencies import get_unit_of_work

@app.get("/invoices")
async def list_invoices(uow=Depends(get_unit_of_work)):
    return await uow.invoices.find({"status": "pending"}, limit=50)
```

`Entity` provides `id`, `created_at`, `updated_at` automatically. `UnitOfWork`
creates and caches typed repositories.

### Memory Service (AI)

```json
{ "memory_config": "smart" }
```

```python
from mdb_engine.dependencies import get_memory_service

@app.post("/remember")
async def remember(text: str, memory=Depends(get_memory_service)):
    return await memory.add(messages=text, user_id="user1")

@app.get("/recall")
async def recall(q: str, memory=Depends(get_memory_service)):
    return await memory.search(query=q, user_id="user1", limit=5)
```

Presets: `"basic"` (infer only), `"smart"` (cognitive + categories),
`"full"` (reflection, graph, emotion, conflict resolution).

### Knowledge Graph (GraphRAG)

```json
{
  "graph_config": { "node_types": ["person", "interest", "event"] },
  "graphrag_config": { "community_detection": { "enabled": true } }
}
```

```python
from mdb_engine.dependencies import get_graph_service

@app.post("/graph/extract")
async def extract(text: str, graph=Depends(get_graph_service)):
    return await graph.extract_graph_from_text(text, user_id="user1")
```

### Dependency Injection

```python
from mdb_engine.di import Container, Scope

container = Container()
container.register(MyService, scope=Scope.SINGLETON)
```

Scopes: `SINGLETON` (one per app), `REQUEST` (one per HTTP request),
`TRANSIENT` (new each time).

---

## Appendix A — Environment Variables

| Canonical Name | Deprecated Aliases | Purpose | Default |
|---|---|---|---|
| `MDB_MONGO_URI` | `MONGODB_URI`, `MONGO_URI` | MongoDB connection string | `mongodb://localhost:27017` |
| `MDB_DB_NAME` | `MONGODB_DB`, `MONGO_DB_NAME`, `DB_NAME` | Database name | `mdb_engine` |
| `MDB_JWT_SECRET` | `MDB_ENGINE_JWT_SECRET`, `SECRET_KEY` | JWT signing secret | — (required for auth) |
| `MDB_ENGINE_MASTER_KEY` | — | Master encryption key | — (required for app auth) |
| `OPENAI_API_KEY` | — | OpenAI API key (memory/LLM) | — |
| `AZURE_OPENAI_API_KEY` | — | Azure OpenAI key | — |
| `AZURE_OPENAI_ENDPOINT` | — | Azure OpenAI endpoint | — |
| `AZURE_OPENAI_DEPLOYMENT_NAME` | — | Azure deployment name | `gpt-4o` |
| `OPENAI_MODEL` | — | OpenAI model name | `gpt-4o` |
| `ADMIN_EMAIL` | — | Admin email (for `{{env.ADMIN_EMAIL}}`) | — |
| `ADMIN_PASSWORD` | — | Admin password (for `{{env.ADMIN_PASSWORD}}`) | — |

---

## Appendix B — Collection Config Keys

| Key | Type | Default | Description |
|---|---|---|---|
| `auto_crud` | boolean | `true` | Generate REST endpoints |
| `schema` | object | — | JSON Schema for document validation (supports `x-unique`, `x-references`, `x-values-from`) |
| `read_only` | boolean | `false` | GET endpoints only |
| `timestamps` | boolean | `true` | Auto-inject `created_at` / `updated_at` |
| `soft_delete` | boolean | `false` | Soft delete with trash/restore |
| `bulk_insert` | boolean | `true` | Enable `POST /_bulk` |
| `auth` | object | — | Per-collection auth (`public_read`, `required`, `roles`, `write_roles`, `create_required`) |
| `realtime` | boolean | `false` | Change Stream WebSocket events |
| `policy` | object | — | Document-level access policies (MQL filters) |
| `scopes` | object | — | Named MQL filters activated via `?scope=` |
| `pipelines` | object | — | Named aggregation endpoints |
| `defaults` | object | — | Default field values on create |
| `default_projection` | object | — | Default MongoDB projection for reads |
| `hooks` | object | — | Lifecycle hooks (`after_create`, `after_update`, `after_delete`) with conditional `if`, atomic operators, `transactional`, `background` |
| `computed` | object | — | Virtual fields via `?computed=` (aggregation at read time) |
| `relations` | object | — | Cross-collection joins via `?populate=` |
| `owner_field` | string | — | Field storing document creator's user ID |
| `immutable_fields` | array | — | Fields that cannot change after creation |
| `writable_fields` | array \| object | — | Allowlist of client-writable fields (flat array or per-role object) |
| `cascade` | object | — | Cascade rules on delete/soft-delete (`on_delete`, `on_soft_delete` arrays) |
| `cache` | object | — | Per-scope response cache directives (`ttl`, `stale_while_revalidate`) |
| `ttl` | object | — | TTL index (`field`, `expire_after`) |
| `max_body_bytes` | integer | `1048576` | Max request body size in bytes |

---

## Appendix C — Generated Endpoints

### Per Collection (with `auto_crud: true`)

| Method | Path | Condition | Description |
|---|---|---|---|
| GET | `/api/{name}` | always | List (filter, sort, paginate, scope, computed, populate) |
| GET | `/api/{name}/_count` | always | Count with filter/scope support |
| GET | `/api/{name}/_trash` | `soft_delete: true` | List soft-deleted documents |
| GET | `/api/{name}/_agg/{pipeline}` | `pipelines` defined | Run named aggregation pipeline |
| GET | `/api/{name}/{id}` | always | Get single document by ID |
| POST | `/api/{name}` | not `read_only` | Create (with defaults + validation + hooks) |
| POST | `/api/{name}/_bulk` | `bulk_insert: true` | Bulk create (up to 1000 docs) |
| PUT | `/api/{name}/{id}` | not `read_only` | Full replace |
| PATCH | `/api/{name}/{id}` | not `read_only` | Partial update |
| DELETE | `/api/{name}/{id}` | not `read_only` | Delete or soft-delete |
| POST | `/api/{name}/{id}/_restore` | `soft_delete: true` | Restore soft-deleted document |

### Auth Endpoints (when `auth.users.enabled: true`)

| Method | Path | Description |
|---|---|---|
| POST | `/auth/register` | Create new user |
| POST | `/auth/login` | Authenticate |
| POST | `/auth/logout` | End session |
| GET | `/auth/me` | Current session info |

### SSR Routes (when `ssr.enabled: true`)

| Method | Path | Description |
|---|---|---|
| GET | Each path in `ssr.routes` | Server-rendered HTML page with bound data |
| GET | `/sitemap.xml` | Auto-generated XML sitemap (when `ssr.sitemap: true`) |

In the blog example:

| Method | Path | Description |
|---|---|---|
| GET | `/s` | Home page — list of published posts with tag stats |
| GET | `/s/posts/{id}` | Post detail page with approved comments |
| GET | `/sitemap.xml` | Sitemap with home page + one entry per published post |

### System Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/docs` | Swagger UI (OpenAPI) |
| GET | `/` | `public/index.html` (if present) |
| GET | `/public/*` | Static files from `public/` directory |

---

## Appendix D — Annotated Manifest

The complete `manifest.json` from the blog-zero project, annotated:

```json
{
  // --- Manifest metadata ---
  "schema_version": "2.0",           // Manifest format version
  "slug": "zero_code_blog",          // Unique app identifier (used for app_id scoping)
  "name": "Zero-Code Blog",          // Human-readable name

  // --- Authentication ---
  "auth": {
    "mode": "app",                   // App-level auth (vs. "hub" for multi-app SSO)
    "users": {
      "enabled": true,               // Turns on secure-by-default (all endpoints require auth)
      "strategy": "app_users",       // Users stored in app's own collection
      "allow_registration": true,    // Public can create accounts
      "registration_role": "reader", // New users get "reader" role
      "max_login_attempts": 5,       // Rate limit: 5 attempts per email
      "login_lockout_seconds": 900,  // Lockout for 15 minutes after limit
      "session_cookie_name": "blog_session",  // Custom cookie name

      // Role hierarchy — admin inherits editor + moderator + reader permissions.
      // An editor inherits reader. A moderator inherits reader.
      // Checks are transitive: if write_roles is ["editor"], admin also passes.
      "role_hierarchy": {
        "admin": ["editor", "moderator", "reader"],
        "editor": ["reader"],
        "moderator": ["reader"]
      },

      "demo_users": [                // Seeded at startup (idempotent)
        {
          "email": "{{env.ADMIN_EMAIL}}",     // Resolved from environment
          "password": "{{env.ADMIN_PASSWORD}}", // Never in plaintext
          "role": "admin"
        }
      ]
    }
  },

  // --- Collections ---
  "collections": {

    // ═══ POSTS ═══
    "posts": {
      "auto_crud": true,             // Generate all REST endpoints
      "soft_delete": true,           // DELETE → deleted_at, plus _trash and _restore

      // Auth: anyone reads, editors (and admin via hierarchy) can write
      "auth": { "public_read": true, "write_roles": ["editor"] },

      // Ownership tracking
      "owner_field": "author_id",          // Auto-injected on create
      "immutable_fields": ["author_id"],   // Cannot be changed after creation

      // Per-role writable fields — editors get full access, moderators can only
      // change status and tags (e.g. for moderation without content editing)
      "writable_fields": {
        "editor": ["title", "body", "author", "status", "tags"],
        "moderator": ["status", "tags"]
      },

      // JSON Schema validation
      "schema": {
        "type": "object",
        "properties": {
          "title":         { "type": "string" },
          "body":          { "type": "string" },
          "author":        { "type": "string" },
          "status":        { "type": "string", "enum": ["draft", "published", "archived"] },

          // x-values-from: tags array values must exist in the tags collection.
          // Add a tag document and it immediately becomes a valid value.
          "tags":          { "type": "array", "items": { "type": "string" },
                             "x-values-from": { "collection": "tags", "field": "name" } },

          "comment_count": { "type": "integer" }
        },
        "required": ["title"]        // Title is mandatory
      },

      // Defaults applied on create (caller values take precedence)
      "defaults": {
        "status": "draft",           // New posts start as drafts
        "tags": [],                  // Empty tags array
        "comment_count": 0,          // Counter starts at zero
        "author": "{{user.email}}"   // Auto-set from authenticated user
      },

      // Named scopes activated via ?scope=name
      "scopes": {
        "published": { "status": "published" },
        "drafts":    { "status": "draft" },
        "archived":  { "status": "archived" }
      },

      // Aggregation pipelines at /api/posts/_agg/{name}
      "pipelines": {
        "by_author": [
          { "$group": { "_id": "$author", "count": { "$sum": 1 } } },
          { "$sort": { "count": -1 } }
        ],
        "by_tag": [
          { "$unwind": "$tags" },
          { "$group": { "_id": "$tags", "count": { "$sum": 1 } } },
          { "$sort": { "count": -1 } }
        ]
      },

      // Cross-collection join — populate author user via ?populate=author_user
      "relations": {
        "author_user": { "from": "users", "local_field": "author_id",
                         "foreign_field": "_id", "single": true }
      },

      // Lifecycle hooks with conditional logic and {{prev.*}} context
      "hooks": {
        "after_create": [
          {
            "action": "insert", "collection": "audit_log",
            "document": {
              "event": "post_created", "entity": "posts",
              "entity_id": "{{doc._id}}", "actor": "{{user.email}}",
              "title": "{{doc.title}}", "timestamp": "$$NOW"
            }
          }
        ],
        "after_update": [
          // Conditional hook: only fires when status transitions TO "published"
          // Uses {{prev.*}} to check old value and {{doc.*}} for new value
          {
            "action": "insert", "collection": "notifications",
            "document": {
              "type": "post_published",
              "message": "{{doc.title}} has been published",
              "entity_id": "{{doc._id}}",
              "actor": "{{user.email}}",
              "read": false,
              "timestamp": "$$NOW"
            },
            "if": {
              "doc.status": "published",
              "prev.status": { "$ne": "published" }
            }
          },
          // Audit log with old and new status captured via {{prev.*}} and {{doc.*}}
          {
            "action": "insert", "collection": "audit_log",
            "document": {
              "event": "post_updated", "entity": "posts",
              "entity_id": "{{doc._id}}", "actor": "{{user.email}}",
              "old_status": "{{prev.status}}", "new_status": "{{doc.status}}",
              "timestamp": "$$NOW"
            }
          }
        ],
        "after_delete": [
          {
            "action": "insert", "collection": "audit_log",
            "document": {
              "event": "post_deleted", "entity": "posts",
              "entity_id": "{{doc._id}}", "actor": "{{user.email}}",
              "timestamp": "$$NOW"
            }
          }
        ]
      },

      // Cascade: when a post is deleted, its comments go too.
      // Hard delete → hard delete comments. Soft delete → soft delete comments.
      "cascade": {
        "on_delete": [
          { "collection": "comments", "match_field": "post_id", "action": "delete" }
        ],
        "on_soft_delete": [
          { "collection": "comments", "match_field": "post_id", "action": "soft_delete" }
        ]
      },

      // Per-scope caching: published posts cached for 5 min, everything else uncached
      "cache": {
        "scope:published": { "ttl": "5m", "stale_while_revalidate": "30s" },
        "default": { "ttl": "0s" }
      }
    },

    // ═══ COMMENTS ═══
    "comments": {
      "auto_crud": true,
      "soft_delete": true,
      "owner_field": "user_id",
      "immutable_fields": ["post_id", "user_id"],  // Can't reassign comment to another post/user

      // Public reads, authenticated creates, moderator-only moderation
      "auth": {
        "public_read": true,
        "create_required": true,     // Must be logged in to comment
        "write_roles": ["moderator"] // Moderator (and admin via hierarchy) can PATCH/DELETE
      },

      "schema": {
        "type": "object",
        "properties": {
          // x-references: post_id must reference an existing post document.
          // Engine validates on write — returns 422 if post doesn't exist.
          "post_id":  { "type": "string",
                        "x-references": { "collection": "posts", "field": "_id" } },
          "user_id":  { "type": "string" },
          "author":   { "type": "string" },
          "body":     { "type": "string" },
          "approved": { "type": "boolean" }
        },
        "required": ["post_id", "body"]
      },

      // New comments default to unapproved
      "defaults": {
        "approved": false,
        "author": "{{user.email}}"
      },

      "scopes": {
        "approved": { "approved": true },           // Public: see approved comments
        "pending": {                                 // Moderator-only: see unapproved
          "filter": { "approved": false },
          "auth": { "roles": ["moderator"] }
        }
      },

      // Join to posts collection via ?populate=post
      "relations": {
        "post": { "from": "posts", "local_field": "post_id",
                  "foreign_field": "_id", "single": true }
      },

      // Hooks with atomic operators and conditional logic
      "hooks": {
        "after_create": [
          {
            "action": "insert", "collection": "audit_log",
            "document": {
              "event": "comment_created", "entity": "comments",
              "entity_id": "{{doc._id}}", "actor": "{{user.email}}",
              "timestamp": "$$NOW"
            }
          }
        ],
        "after_update": [
          // When a comment gets approved: $inc comment_count on the parent post
          {
            "action": "update",
            "collection": "posts",
            "filter": { "_id": "{{doc.post_id}}" },
            "update": { "$inc": { "comment_count": 1 } },
            "if": { "doc.approved": true, "prev.approved": false }
          },
          // When a comment gets unapproved: $inc comment_count by -1
          {
            "action": "update",
            "collection": "posts",
            "filter": { "_id": "{{doc.post_id}}" },
            "update": { "$inc": { "comment_count": -1 } },
            "if": { "doc.approved": false, "prev.approved": true }
          }
        ]
      }
    },

    // ═══ CATEGORIES ═══
    "categories": {
      "auto_crud": true,
      "auth": { "public_read": true, "write_roles": ["admin"] },
      "schema": {
        "type": "object",
        "properties": {
          "name":        { "type": "string", "x-unique": true },  // Unique index
          "description": { "type": "string" }
        },
        "required": ["name"]
      }
    },

    // ═══ TAGS ═══
    // Referenced by posts.tags via x-values-from — acts as a controlled vocabulary
    "tags": {
      "auto_crud": true,
      "auth": { "public_read": true, "write_roles": ["editor"] },
      "schema": {
        "type": "object",
        "properties": {
          "name": { "type": "string", "x-unique": true }
        },
        "required": ["name"]
      }
    },

    // ═══ NOTIFICATIONS ═══
    // Written by conditional hooks (e.g. post published), consumed by editors
    "notifications": {
      "auto_crud": true,
      "auth": { "roles": ["editor"] },
      "schema": {
        "type": "object",
        "properties": {
          "type":      { "type": "string" },
          "message":   { "type": "string" },
          "entity_id": { "type": "string" },
          "actor":     { "type": "string" },
          "read":      { "type": "boolean" }
        }
      },
      "defaults": { "read": false },
      "scopes": {
        "unread": { "read": false }
      },
      "ttl": { "field": "timestamp", "expire_after": "7d" }  // Auto-cleanup after 7 days
    },

    // ═══ AUDIT LOG ═══
    "audit_log": {
      "auto_crud": true,
      "read_only": true,             // No POST/PUT/PATCH/DELETE — only hooks can write
      "timestamps": false,           // Uses hook-injected "timestamp" instead
      "ttl": {
        "field": "timestamp",        // TTL index on this field
        "expire_after": "90d"        // Auto-delete after 90 days
      }
    }
  },

  // --- Server-Side Rendering ---
  "ssr": {
    "enabled": true,
    "site_name": "blog-zero",
    "site_description": "A full-featured blog built from a single JSON manifest.",
    "base_url": "",                  // Same-origin; set to production domain for sitemap
    "sitemap": true,                 // Generate /sitemap.xml
    "routes": {

      // Home page — lists published posts with tag stats sidebar
      "/s": {
        "template": "index.html",
        "data": {
          "posts": {
            "collection": "posts",
            "scope": "published",
            "sort": { "created_at": -1 },
            "limit": 12,
            "computed": ["comment_count"]
          },
          "tag_stats": {
            "collection": "posts",
            "pipeline": "by_tag"
          }
        },
        "seo": {
          "title": "blog-zero",
          "description": "Stories from the edge of code and creativity."
        },
        "cache": { "ttl": "5m", "stale_while_revalidate": "30s" }
      },

      // Post detail page — single post + approved comments
      "/s/posts/{id}": {
        "template": "post.html",
        "data": {
          "post": {
            "collection": "posts",
            "id_param": "id"         // Extracts {id} from URL path
          },
          "comments": {
            "collection": "comments",
            "filter": { "post_id": "{{params.id}}", "approved": true },
            "sort": { "created_at": 1 },
            "limit": 100
          }
        },
        "seo": {
          "title": "{{post.title}} — blog-zero",
          "description": "{{post.excerpt}}",
          "og_type": "article",
          "json_ld": {               // Structured data for search engines
            "@context": "https://schema.org",
            "@type": "BlogPosting",
            "headline": "{{post.title}}",
            "datePublished": "{{post.created_at}}",
            "author": {
              "@type": "Person",
              "name": "{{post.author}}"
            },
            "publisher": {
              "@type": "Organization",
              "name": "blog-zero"
            }
          }
        },
        "cache": { "ttl": "10m", "stale_while_revalidate": "1m" }
      }
    }
  },

  // --- Scheduled Jobs ---
  // Runs on a schedule without external cron or task queues
  "jobs": {
    "archive_stale_drafts": {
      "schedule": "@daily",          // Runs once per day at midnight UTC
      "action": "update",
      "collection": "posts",
      "filter": {
        "status": "draft",
        "updated_at": { "$lt": "$$NOW_MINUS_90D" }  // Drafts untouched for 90 days
      },
      "update": { "$set": { "status": "archived" } }
    }
  },

  // --- Managed Indexes ---
  // Declared indexes that the engine creates at startup (idempotent)
  "managed_indexes": {
    "posts": [
      { "type": "regular", "keys": { "status": 1, "created_at": -1 },
        "name": "idx_status_created" },
      { "type": "regular", "keys": { "tags": 1 }, "name": "idx_tags" }
    ],
    "comments": [
      { "type": "regular", "keys": { "post_id": 1, "approved": 1 },
        "name": "idx_post_approved" }
    ]
  }
}
```

> **Note:** JSON does not support comments. The annotations above are for
> documentation purposes. The actual `manifest.json` file contains no comments.

---

*mdb-engine v0.8.7 — MIT License — Python >=3.10*
