# Zero-Code Blog

A full-featured blog platform from a single JSON file. No backend code required.
Now powered by **mdb-engine 0.8.7** with SSR, conditional hooks, cascade deletes,
role hierarchies, atomic operators, scheduled jobs, and more.

```
src/
├── manifest.json          # the entire API + SSR + jobs + auth + hooks
├── Dockerfile             # cloud-ready container
├── docker-compose.yml     # one-command local setup
├── .env.example           # available env vars
├── templates/             # SSR templates (Jinja2, server-rendered)
│   ├── index.html         # home page (paginated post list, tags)
│   ├── post.html          # article page (full post, comments, JSON-LD)
│   ├── 404.html           # custom not-found page
│   └── 500.html           # custom server-error page
└── public/                # SPA + static assets
    ├── index.html         # SPA shell (hash-routed, admin views)
    ├── about.html         # standalone about page
    ├── community.html     # community guidelines
    ├── style.css          # all styles (shared by SPA and SSR)
    ├── favicon.svg        # browser tab icon
    └── js/
        ├── app.js         # boot + hash router + SEO hook
        ├── home.js        # landing page (hero slideshow + recent posts)
        ├── blog.js        # browse/search with tag chips + sort
        ├── feed.js        # article view, comments, renderCard()
        ├── compose.js     # markdown editor with live preview
        ├── manage.js      # admin dashboard (stats, CRUD, moderation)
        ├── hero.js        # crossfade slideshow with dot navigation
        ├── seo.js         # dynamic title/meta/OG/JSON-LD per route
        └── utils.js       # BLOG_CONFIG, API_CONFIG, UI_CONFIG, api(), md()
```

## Two frontends, one blog

| Surface | Tech | Who it serves |
|---------|------|---------------|
| **SSR** (`/`, `/posts/{id}`, `/tags/{tag}`) | Jinja2 templates, server-rendered | Crawlers, SEO, link previews, no-JS readers |
| **SPA** (`/#home`, `/#blog`, `/#compose`, `/#manage`) | Vanilla JS modules | Logged-in users, admin, interactive features |

Both share `style.css`. SSR pages link to the SPA ("Open in App") for
authenticated actions. The SPA handles everything the SSR can't: compose,
manage, auth panels, live preview.

## What the manifest defines

| Collection | 0.8.7 Features Used |
|------------|-------------------|
| `posts` | Schema, soft delete, defaults, scopes, pipelines, **owner_field**, **immutable_fields**, **per-role writable_fields**, hooks (audit + **conditional publish notification**), **cascade delete → comments**, **cache directives**, **x-values-from** (tag validation), relations, **managed indexes** |
| `comments` | Auth (public read, create required, **moderator** write), **x-references** (post_id validation), **owner_field**, **immutable_fields**, relations, hooks (**atomic `$inc` comment_count** on approval toggle), soft delete |
| `categories` | Schema with **x-unique**, public read, admin write |
| `tags` | Schema with **x-unique**, public read, editor write, **used by x-values-from** |
| `notifications` | Schema, defaults, scopes (unread), **TTL** (7-day auto-expiry), editor-only access, **populated by conditional hooks** |
| `audit_log` | Read-only, **TTL** (90-day auto-expiry), populated by hooks, **`{{prev.*}}` placeholders** for tracking old/new status |

Auth is configured with `auth.users`:

- **Secure-by-default** — all endpoints require auth unless `public_read` is set
- **Role hierarchy** — `admin > editor > reader`, `admin > moderator > reader`
- **Per-role writable fields** — editors get full content access, moderators get status/tags only
- Admin seeded via `{{env.ADMIN_EMAIL}}` / `{{env.ADMIN_PASSWORD}}`
- Self-registered users get role `reader`
- Post/tag mutation requires `editor` role; category mutation requires `admin`
- Comment moderation requires `moderator` role (inherited by editor and admin)

## 0.8.7 features in action

### Conditional hooks with `{{prev.*}}`

Publish notifications only fire when a post **transitions** to published:

```json
"after_update": [{
  "action": "insert", "collection": "notifications",
  "document": { "type": "post_published", "message": "{{doc.title}} has been published", ... },
  "if": { "doc.status": "published", "prev.status": { "$ne": "published" } }
}]
```

### Atomic `$inc` for denormalized comment count

When a comment is approved, the parent post's `comment_count` is atomically
incremented. When unapproved, it's decremented. No expensive `$lookup` on read:

```json
"after_update": [{
  "action": "update",
  "collection": "posts",
  "filter": { "_id": "{{doc.post_id}}" },
  "update": { "$inc": { "comment_count": 1 } },
  "if": { "doc.approved": true, "prev.approved": false }
}]
```

### Cascade delete

Deleting a post automatically deletes all its comments. Soft-deleting a post
soft-deletes its comments:

```json
"cascade": {
  "on_delete": [{ "collection": "comments", "match_field": "post_id", "action": "delete" }],
  "on_soft_delete": [{ "collection": "comments", "match_field": "post_id", "action": "soft_delete" }]
}
```

### Referential integrity

Comments validate that `post_id` points to a real post at write time:

```json
"post_id": { "type": "string", "x-references": { "collection": "posts", "field": "_id" } }
```

### Tag validation with `x-values-from`

Post tags are validated against the `tags` collection:

```json
"tags": { "type": "array", "items": { "type": "string" }, "x-values-from": { "collection": "tags", "field": "name" } }
```

### Cache directives

Published posts get 5-minute caching with stale-while-revalidate. Draft/admin
queries bypass the cache:

```json
"cache": { "scope:published": { "ttl": "5m", "stale_while_revalidate": "30s" }, "default": { "ttl": "0s" } }
```

### Scheduled jobs

Stale drafts (untouched for 90 days) are auto-archived daily:

```json
"jobs": {
  "archive_stale_drafts": {
    "schedule": "@daily",
    "action": "update",
    "collection": "posts",
    "filter": { "status": "draft", "updated_at": { "$lt": "$$NOW_MINUS_90D" } },
    "update": { "$set": { "status": "archived" } }
  }
}
```

### Server-side rendering

Crawlers and link previews get fully rendered HTML with pagination, JSON-LD,
`Cache-Control` headers, and an auto-generated `/sitemap.xml`:

```json
"ssr": {
  "enabled": true,
  "routes": {
    "/": { "template": "app-shell.html", "data": { "posts": { ... } }, "cache": { "ttl": "15s" } },
    "/posts/{id}": { "template": "app-shell.html", "seo": { "json_ld": { "@type": "BlogPosting", ... } } }
  }
}
```

### Managed indexes

Explicit indexes for the most common query patterns:

```json
"managed_indexes": {
  "posts": [
    { "keys": { "status": 1, "created_at": -1 }, "name": "idx_status_created" },
    { "keys": { "tags": 1 }, "name": "idx_tags" }
  ],
  "comments": [
    { "keys": { "post_id": 1, "approved": 1 }, "name": "idx_post_approved" }
  ]
}
```

## Run with Docker

```bash
docker compose up --build
```

Override admin credentials:

```bash
ADMIN_EMAIL=me@corp.com ADMIN_PASSWORD=supersecret docker compose up
```

- **Home:** http://localhost:8000 (SSR + SPA hydration)
- **Article:** http://localhost:8000/posts/{id} (SSR with JSON-LD)
- **Sitemap:** http://localhost:8000/sitemap.xml
- **Swagger docs:** http://localhost:8000/docs

## Run locally

```bash
pip install "mdb-engine>=0.11.5" uvicorn httpx jinja2
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=admin123 mdb-engine serve manifest.json --reload
```

## CLI tools (new in 0.8.7)

```bash
# Compare manifests (CI-friendly, non-zero exit on breaking changes)
mdb-engine diff manifest.v1.json manifest.v2.json

# Print generated routes, indexes, hooks without connecting to MongoDB
mdb-engine dry-run manifest.json

# Generate typed TypeScript API client
mdb-engine codegen manifest.json --target typescript --out api-client.ts
```

## What you get automatically

| Feature | How |
|---------|-----|
| Secure-by-default | All endpoints require auth when `auth.users.enabled` is on |
| **Role hierarchy** | `admin > editor > moderator > reader` — inherited permissions |
| **Per-role writable fields** | Editors vs. moderators get different field access |
| Protected fields | `role`, `password_hash`, etc. auto-immutable on all collections |
| Public read | `public_read: true` allows anonymous reads, writes require auth |
| Login rate limiting | `max_login_attempts` blocks brute-force with 429 + Retry-After |
| Auto-CRUD | GET, POST, PUT, PATCH, DELETE from the manifest |
| JSON Schema validation | Rejects bad documents before they hit the database |
| **Referential integrity** | `x-references` validates foreign keys at write time |
| **Tag validation** | `x-values-from` validates values against a lookup collection |
| Named scopes | `?scope=published,drafts` activates predefined MQL filters |
| Aggregation pipelines | `GET /api/{collection}/_agg/{name}` |
| Document defaults | Auto-populate fields on create with `{{user.*}}` templates |
| Owner field | Auto-inject creator ID, enforce write/delete ownership |
| Immutable fields | Silently strip protected fields from updates |
| **Conditional hooks** | Fire only when conditions match (`if` + `{{prev.*}}`) |
| **Atomic update hooks** | `$inc`, `$push`, `$pull` in hook update actions |
| **Cascade delete** | Auto-delete/soft-delete children when parent is removed |
| **HTTP hooks (webhooks)** | Send requests to Slack, SendGrid, or any external service |
| Relations / populate | `?populate=name` injects `$lookup` joins at read time |
| Computed fields | `?computed=name` injects aggregation pipelines at read time |
| Unique constraints | `x-unique` in schema auto-creates indexes, returns 409 |
| TTL | Auto-expiry via TTL indexes (90d audit, 7d notifications) |
| Soft delete | Delete, trash, restore lifecycle |
| **Cache directives** | Per-scope `Cache-Control` headers |
| **Scheduled jobs** | Cron-like manifest jobs (archive stale drafts daily) |
| **Server-side rendering** | Jinja2 templates with pagination, JSON-LD, sitemap |
| **Managed indexes** | Explicit compound indexes for performance |
| Bulk insert | Batch up to 1000 documents in one request |
| Timestamps | `created_at` and `updated_at` injected automatically |
| Filtering | `?field=value`, `?field=gt:18`, `?field=in:a,b,c` |
| Sorting | `?sort=-created_at,title` |
| Pagination | `?limit=10&skip=20` |
| Field selection | `?fields=title,status` |
| Data isolation | All queries scoped by `app_id` automatically |
| Env-var seeding | `{{env.*}}` in demo_users — no plaintext secrets |
| OpenAPI docs | Swagger UI at `/docs` |
| **Manifest diff** | `mdb-engine diff` for CI pipelines |
| **Dry-run** | `mdb-engine dry-run` to preview generated routes/indexes |
| **TypeScript codegen** | `mdb-engine codegen` for typed API clients |

## The design principle

> **MQL is the DSL.** Every `scopes`, `pipelines`, `defaults`, `hooks`,
> `relations`, `computed`, `cascade`, `cache`, and `jobs` value is a native
> MongoDB Query Language expression. The manifest speaks the same language
> as the database — no translation layer, no custom syntax.
> Declare what you want. The engine handles the rest.
