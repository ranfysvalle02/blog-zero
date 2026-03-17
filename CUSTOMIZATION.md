# Customizing the Zero-Code Blog

A practical guide to reshaping the blog through manifest changes and frontend
tweaks. Every recipe here works without writing Python -- just edit
`manifest.json` and `public/index.html`.

> **Updated for mdb-engine 0.8.7** — includes role hierarchy, per-role
> writable fields, conditional hooks, `$inc` counters, cascade deletes,
> cache directives, SSR routes, and scheduled jobs.

---

## Table of Contents

1. [Access Control Recipes](#1-access-control-recipes)
2. [Content Visibility Patterns](#2-content-visibility-patterns)
3. [Role Engineering](#3-role-engineering)
4. [Schema Extensions](#4-schema-extensions)
5. [New Collections](#5-new-collections)
6. [Pipeline Recipes](#6-pipeline-recipes)
7. [Hook Recipes](#7-hook-recipes)
8. [Cascade Delete Recipes](#8-cascade-delete-recipes)
9. [Cache Directive Recipes](#9-cache-directive-recipes)
10. [SSR Recipes](#10-ssr-recipes)
11. [Scheduled Job Recipes](#11-scheduled-job-recipes)
12. [UI/UX Customization](#12-uiux-customization)
13. [Appendix A — Manifest Diff Recipes](#appendix-a--manifest-diff-recipes)
14. [Appendix B — CSS Variable Reference](#appendix-b--css-variable-reference)
15. [Appendix C — Frontend Extension Patterns](#appendix-c--frontend-extension-patterns)

---

## 1. Access Control Recipes

The blog ships with a simple model: anyone reads, admin writes. The manifest
supports far more nuanced patterns -- all without code.

### Recipe: Fully Public Blog (No Auth)

Remove `auth.users` entirely. Every endpoint is open.

```json
{
  "schema_version": "2.0",
  "slug": "open_blog",
  "name": "Open Blog",
  "collections": {
    "posts": {
      "auto_crud": true,
      "schema": { ... }
    }
  }
}
```

No login, no registration, no sessions. Anyone can read and write. Suitable for
internal tools behind a VPN.

### Recipe: Members-Only Blog (Login Required to Read)

Remove `public_read` from posts. With `auth.users.enabled: true`, reads require
authentication automatically.

```json
"posts": {
  "auth": { "write_roles": ["editor"] }
}
```

Without `"public_read": true`, anonymous visitors get `401` on
`GET /api/posts`. They must register and log in first. With `role_hierarchy`,
admin inherits the editor write permission automatically.

**Frontend change:** The feed loader should catch 401 and show a login prompt
instead of an empty feed:

```javascript
async function loadFeed() {
  const r = await api('GET', '/api/posts?scope=published&sort=-created_at&limit=50');
  if (r.status === 401) {
    $('#feed').innerHTML = `
      <div class="feed-empty">
        <p>Sign in to read posts.</p>
        <button class="btn btn-p" onclick="showAuthPanel('login')">Sign in</button>
        <button class="btn btn-o" onclick="showAuthPanel('register')">Register</button>
      </div>`;
    return;
  }
  // ... render posts ...
}
```

### Recipe: Mixed Visibility (Public + Members-Only Posts)

Add a `visibility` field to posts and use scopes to filter by audience.

**Schema change:**

```json
"posts": {
  "schema": {
    "properties": {
      "visibility": {
        "type": "string",
        "enum": ["public", "members", "premium"]
      }
    }
  },
  "writable_fields": {
    "editor": ["title", "body", "author", "status", "tags", "visibility"],
    "moderator": ["status", "tags"]
  },
  "defaults": {
    "visibility": "public"
  }
}
```

**Scopes:**

```json
"scopes": {
  "published": { "status": "published" },
  "public_feed": { "status": "published", "visibility": "public" },
  "members_feed": {
    "filter": { "status": "published", "visibility": { "$in": ["public", "members"] } },
    "auth": { "required": true }
  },
  "premium_feed": {
    "filter": { "status": "published" },
    "auth": { "roles": ["premium"] }
  }
}
```

**How it works:**

- Anonymous visitors: `GET /api/posts?scope=public_feed` -- sees only public posts
- Logged-in members: `GET /api/posts?scope=members_feed` -- sees public + members posts
- Premium subscribers: `GET /api/posts?scope=premium_feed` -- sees everything
- Admin inherits premium via `role_hierarchy` — no need to list both

The scope's `auth` block enforces this server-side. A non-premium user who
manually types `?scope=premium_feed` gets `403`.

**Frontend change:** Switch scope based on session state:

```javascript
async function loadFeed() {
  let scope = 'public_feed';
  if (isAdmin()) scope = 'published';
  else if (isPremium()) scope = 'premium_feed';
  else if (isAuthed()) scope = 'members_feed';

  const r = await api('GET', `/api/posts?scope=${scope}&sort=-created_at&limit=50`);
  // ... render ...
}

function isPremium() {
  return state.session?.user?.role === 'premium';
}
```

### Recipe: Team-Scoped Posts (Multi-Tenant)

Each user sees only their team's posts via `policy`.

```json
"posts": {
  "auth": { "required": true },
  "policy": {
    "read":  { "team_id": "{{user.team_id}}" },
    "write": { "team_id": "{{user.team_id}}" }
  },
  "defaults": {
    "team_id": "{{user.team_id}}"
  }
}
```

Every query is automatically filtered by the user's `team_id`. User A on
team "engineering" never sees posts from team "marketing". No code, no
middleware -- just a policy filter.

### Recipe: Owner-Only Drafts, Public Published

Combine `policy` and `scopes` for granular control:

```json
"posts": {
  "auth": { "required": true },
  "scopes": {
    "published": { "status": "published" },
    "my_drafts": {
      "filter": { "status": "draft", "author_id": "{{user._id}}" },
      "auth": { "required": true }
    }
  },
  "policy": {
    "write": { "author_id": "{{user._id}}" }
  }
}
```

- `?scope=published` returns all published posts (any user)
- `?scope=my_drafts` returns only the current user's drafts
- PATCH/DELETE only works if `author_id` matches the current user
- Admin role bypasses all ownership checks

---

## 2. Content Visibility Patterns

These patterns use the manifest to implement common publishing workflows.

### Pattern: Scheduled Publishing

Add a `publish_at` field. Use a scope with `$$NOW` to filter:

```json
"posts": {
  "schema": {
    "properties": {
      "publish_at": { "type": "string", "format": "date-time" }
    }
  },
  "writable_fields": {
    "editor": ["title", "body", "author", "status", "tags", "publish_at"],
    "moderator": ["status", "tags"]
  },
  "scopes": {
    "live": {
      "status": "published",
      "$or": [
        { "publish_at": { "$exists": false } },
        { "publish_at": { "$lte": "$$NOW" } }
      ]
    },
    "scheduled": {
      "filter": { "status": "published", "publish_at": { "$gt": "$$NOW" } },
      "auth": { "roles": ["editor"] }
    }
  }
}
```

- `?scope=live` -- public feed, only shows posts whose `publish_at` is in the
  past (or unset)
- `?scope=scheduled` -- editor/admin only, shows future-dated posts

The admin creates a post with `"status": "published", "publish_at": "2025-12-25T00:00:00Z"`.
It appears in the public feed only after Christmas.

### Pattern: Featured Posts

Add a boolean `featured` field:

```json
"posts": {
  "schema": {
    "properties": {
      "featured": { "type": "boolean" }
    }
  },
  "writable_fields": {
    "editor": ["title", "body", "author", "status", "tags", "featured"],
    "moderator": ["status", "tags"]
  },
  "defaults": {
    "featured": false
  },
  "scopes": {
    "published": { "status": "published" },
    "featured": { "status": "published", "featured": true },
    "not_featured": { "status": "published", "featured": { "$ne": true } }
  }
}
```

Frontend can show a hero section for featured posts and a regular list below:

```javascript
async function loadFeed() {
  const [featuredRes, postsRes] = await Promise.all([
    api('GET', '/api/posts?scope=featured&sort=-created_at&limit=3'),
    api('GET', '/api/posts?scope=not_featured&sort=-created_at&limit=20'),
  ]);
  // Render featured posts in a hero layout, rest below
}
```

### Pattern: Pinned Posts

Use a `pinned` field and a sort pipeline:

```json
"posts": {
  "schema": {
    "properties": {
      "pinned": { "type": "boolean" }
    }
  },
  "defaults": { "pinned": false },
  "pipelines": {
    "feed": [
      { "$match": { "status": "published" } },
      { "$addFields": { "_pin_sort": { "$cond": ["$pinned", 0, 1] } } },
      { "$sort": { "_pin_sort": 1, "created_at": -1 } },
      { "$project": { "_pin_sort": 0 } }
    ]
  }
}
```

```bash
GET /api/posts/_agg/feed
```

Pinned posts always appear first, unpinned posts sorted by newest.

### Pattern: Draft Preview Links

Give each draft a unique `preview_token` that allows unauthenticated access:

```json
"posts": {
  "schema": {
    "properties": {
      "preview_token": { "type": "string" }
    }
  },
  "scopes": {
    "preview": {
      "status": "draft"
    }
  }
}
```

The admin creates a draft and sets a random `preview_token`. The frontend
checks the URL for `?preview=TOKEN` and fetches the post directly by ID,
verifying the token client-side. Since the API returns the token in the
document, the frontend can compare.

---

## 3. Role Engineering

The default blog uses `role_hierarchy` to define a four-role system where
admin automatically inherits the permissions of every role beneath it.

### Role Hierarchy (0.8.7)

```json
"auth": {
  "users": {
    "enabled": true,
    "allow_registration": true,
    "registration_role": "reader",
    "role_hierarchy": {
      "admin": ["editor", "moderator", "reader"],
      "editor": ["reader"],
      "moderator": ["reader"]
    },
    "demo_users": [
      { "email": "{{env.ADMIN_EMAIL}}", "password": "{{env.ADMIN_PASSWORD}}", "role": "admin" },
      { "email": "{{env.EDITOR_EMAIL}}", "password": "{{env.EDITOR_PASSWORD}}", "role": "editor" }
    ]
  }
}
```

**What this means:** When a collection declares `"write_roles": ["editor"]`,
admin inherits that permission through the hierarchy. You no longer need to
list `["editor", "admin"]` everywhere — just `["editor"]`.

#### Role: Editor (Can Write Posts, Cannot Manage)

```json
"posts": {
  "auth": {
    "public_read": true,
    "write_roles": ["editor"]
  }
}
```

Editors can create and edit posts. Admin inherits editor, so admins can too.
Only admins can delete or manage comments (because `role_hierarchy` gives admin
the moderator role, not editors).

#### Role: Moderator (Can Approve Comments, Cannot Write Posts)

```json
"comments": {
  "auth": {
    "public_read": true,
    "create_required": true,
    "write_roles": ["moderator"]
  },
  "scopes": {
    "pending": {
      "filter": { "approved": false },
      "auth": { "roles": ["moderator"] }
    }
  }
}
```

With `role_hierarchy`, admin inherits moderator — so admins can also approve
comments and view the pending scope. No need to duplicate `["moderator", "admin"]`.

#### Role: Premium (Can Read Members-Only Content)

See the [Mixed Visibility recipe](#recipe-mixed-visibility-public--members-only-posts)
above. The `premium` role gates access to a scope. To include premium in the
hierarchy, extend the config:

```json
"role_hierarchy": {
  "admin": ["editor", "moderator", "premium", "reader"],
  "editor": ["reader"],
  "moderator": ["reader"],
  "premium": ["reader"]
}
```

#### Role Hierarchy Table

| Capability | reader | editor | moderator | premium | admin |
|---|---|---|---|---|---|
| Read public posts | Yes | Yes | Yes | Yes | Yes |
| Read members posts | No | Yes | No | Yes | **Yes** *(inherits)* |
| Comment | Yes | Yes | Yes | Yes | Yes |
| Write posts | No | Yes | No | No | **Yes** *(inherits editor)* |
| Approve comments | No | No | Yes | No | **Yes** *(inherits moderator)* |
| Delete posts | No | No | No | No | Yes |
| View audit log | No | No | No | No | Yes |

Cells marked *(inherits)* are granted automatically through `role_hierarchy` --
no per-collection config needed.

**Seed all roles via demo_users:**

```json
"demo_users": [
  { "email": "{{env.ADMIN_EMAIL}}", "password": "{{env.ADMIN_PASSWORD}}", "role": "admin" },
  { "email": "{{env.EDITOR_EMAIL}}", "password": "{{env.EDITOR_PASSWORD}}", "role": "editor" },
  { "email": "{{env.MOD_EMAIL}}", "password": "{{env.MOD_PASSWORD}}", "role": "moderator" }
]
```

### Invite-Only Registration

```json
"auth": {
  "users": {
    "allow_registration": "invite_only",
    "invite_codes": ["{{env.INVITE_CODE}}", "launch-day-2025"],
    "registration_role": "reader"
  }
}
```

Clients must include `"invite_code": "launch-day-2025"` in the registration
body. Invalid codes return 403.

**Frontend change:** Add an invite code field to the registration form:

```javascript
// In the auth submit handler:
const payload = state.authMode === 'register'
  ? { email, password, name, invite_code: $('#authInvite').value.trim() }
  : { email, password };
```

### Closed Registration (Admin Creates Users)

```json
"auth": {
  "users": {
    "allow_registration": false
  }
}
```

Users can only be created via `mdb-engine add-user` CLI or by an admin through
a custom endpoint.

---

## 4. Schema Extensions

Extend the posts schema to support richer content without changing any code.

### Add Cover Images

```json
"posts": {
  "schema": {
    "properties": {
      "cover_image": { "type": "string", "format": "uri" },
      "cover_alt": { "type": "string" }
    }
  },
  "writable_fields": {
    "editor": ["title", "body", "author", "status", "tags", "cover_image", "cover_alt"],
    "moderator": ["status", "tags"]
  }
}
```

```bash
curl -b cookies -X POST http://localhost:8000/api/posts \
  -H "Content-Type: application/json" \
  -d '{
    "title": "My Post",
    "cover_image": "https://images.unsplash.com/photo-123",
    "cover_alt": "A sunset over mountains"
  }'
```

Frontend: render in the card and article view:

```javascript
// In the feed card template:
const cover = p.cover_image
  ? `<img src="${esc(p.cover_image)}" alt="${esc(p.cover_alt || '')}"
      style="width:100%;height:180px;object-fit:cover;border-radius:var(--r);margin-bottom:12px">`
  : '';
h += `<div class="card" onclick="openPost('${p._id}')">${cover}<div class="meta">...`;
```

### Add Excerpt / Subtitle

```json
"posts": {
  "schema": {
    "properties": {
      "excerpt": { "type": "string", "maxLength": 300 }
    }
  },
  "writable_fields": {
    "editor": ["title", "body", "author", "status", "tags", "excerpt"],
    "moderator": ["status", "tags"]
  }
}
```

The admin writes a custom excerpt in the compose view. The feed card uses it
instead of auto-generating from body text:

```javascript
const desc = p.excerpt || excerpt(p.body);
```

### Add Reading Time (Computed)

Instead of calculating client-side, add a computed field:

```json
"posts": {
  "computed": {
    "comment_count": { ... },
    "word_count": {
      "pipeline": [
        { "$addFields": {
          "word_count": {
            "$size": { "$split": [{ "$ifNull": ["$body", ""] }, " "] }
          }
        }}
      ]
    }
  }
}
```

```bash
GET /api/posts?scope=published&computed=word_count,comment_count
```

### Add Category Linking

Connect posts to the existing categories collection with referential integrity:

```json
"posts": {
  "schema": {
    "properties": {
      "category_id": {
        "type": "string",
        "x-references": { "collection": "categories", "field": "_id" }
      }
    }
  },
  "writable_fields": {
    "editor": ["title", "body", "author", "status", "tags", "category_id"],
    "moderator": ["status", "tags"]
  },
  "relations": {
    "category": {
      "from": "categories",
      "local_field": "category_id",
      "foreign_field": "_id",
      "single": true
    }
  }
}
```

`x-references` tells the engine to validate that the given `category_id`
actually exists in the `categories` collection before accepting a write. If
you POST a post with a non-existent category, you get `400 Bad Request`.

```bash
GET /api/posts?scope=published&populate=category
```

Each post now includes `"category": {"_id": "...", "name": "Technology"}`.

### Tag Validation with `x-values-from`

The blog ships with a `tags` collection. Use `x-values-from` to constrain the
tags array to only values that exist in that collection:

```json
"posts": {
  "schema": {
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

If you POST a post with `"tags": ["python", "nosuchvalue"]`, the engine rejects
it because `"nosuchvalue"` doesn't exist in the tags collection. Seed your tags
first:

```bash
curl -b cookies -X POST http://localhost:8000/api/tags \
  -H "Content-Type: application/json" \
  -d '{"name": "python"}'
```

### Add a Series / Collection Field

Group posts into multi-part series:

```json
"posts": {
  "schema": {
    "properties": {
      "series": { "type": "string" },
      "series_order": { "type": "integer" }
    }
  },
  "scopes": {
    "published": { "status": "published" },
    "series": { "series": { "$exists": true, "$ne": null } }
  },
  "pipelines": {
    "by_series": [
      { "$match": { "series": { "$exists": true, "$ne": null } } },
      { "$group": { "_id": "$series", "count": { "$sum": 1 }, "latest": { "$max": "$created_at" } } },
      { "$sort": { "latest": -1 } }
    ]
  }
}
```

```bash
# List all series
GET /api/posts/_agg/by_series

# Posts in a specific series, ordered
GET /api/posts?scope=published&series=Getting+Started&sort=series_order
```

---

## 5. New Collections

Add entire new capabilities by declaring new collections.

> **Note:** The blog already ships with `tags` and `notifications` collections
> in 0.8.7. Tags are used by `x-values-from` for validated tagging.
> Notifications are populated by conditional hooks on publish transitions.
> See `manifest.json` for their schemas.

### Reactions (Likes / Emojis)

```json
"reactions": {
  "auto_crud": true,
  "auth": { "required": true },
  "owner_field": "user_id",
  "schema": {
    "type": "object",
    "properties": {
      "post_id": {
        "type": "string",
        "x-references": { "collection": "posts", "field": "_id" }
      },
      "user_id": { "type": "string" },
      "type":    { "type": "string", "enum": ["like", "love", "fire", "think"] }
    },
    "required": ["post_id", "type"]
  },
  "defaults": {
    "user_id": "{{user._id}}"
  },
  "immutable_fields": ["post_id", "user_id"],
  "pipelines": {
    "by_post": [
      { "$group": {
        "_id": { "post_id": "$post_id", "type": "$type" },
        "count": { "$sum": 1 }
      }},
      { "$sort": { "count": -1 } }
    ]
  }
}
```

`x-references` on `post_id` ensures you can't react to a post that doesn't
exist.

```bash
# React to a post
curl -b cookies -X POST http://localhost:8000/api/reactions \
  -H "Content-Type: application/json" \
  -d '{"post_id":"<ID>","type":"fire"}'

# Get reaction counts for all posts
curl http://localhost:8000/api/reactions/_agg/by_post
```

### Bookmarks (Save for Later)

```json
"bookmarks": {
  "auto_crud": true,
  "auth": { "required": true },
  "owner_field": "user_id",
  "policy": {
    "read":   { "user_id": "{{user._id}}" },
    "write":  { "user_id": "{{user._id}}" },
    "delete": { "user_id": "{{user._id}}" }
  },
  "schema": {
    "type": "object",
    "properties": {
      "post_id": {
        "type": "string",
        "x-references": { "collection": "posts", "field": "_id" }
      },
      "user_id": { "type": "string" },
      "note":    { "type": "string" }
    },
    "required": ["post_id"]
  },
  "defaults": {
    "user_id": "{{user._id}}"
  },
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

Each user can only see and manage their own bookmarks (enforced by `policy`).
`x-references` prevents bookmarking a deleted or non-existent post.

```bash
# Save a post
curl -b cookies -X POST http://localhost:8000/api/bookmarks \
  -d '{"post_id":"<ID>","note":"Read this later"}'

# My bookmarks with post details
curl -b cookies http://localhost:8000/api/bookmarks?populate=post
```

### Newsletter Subscribers

```json
"subscribers": {
  "auto_crud": true,
  "auth": { "write_roles": ["admin"] },
  "schema": {
    "type": "object",
    "properties": {
      "email": { "type": "string", "x-unique": true },
      "name":  { "type": "string" },
      "subscribed": { "type": "boolean" }
    },
    "required": ["email"]
  },
  "defaults": { "subscribed": true },
  "scopes": {
    "active": { "subscribed": true }
  }
}
```

Only admins can read the subscriber list. Pair with a public subscribe
endpoint (a simple POST form in the frontend).

### Page Views / Analytics

```json
"page_views": {
  "auto_crud": true,
  "auth": { "required": false },
  "read_only": false,
  "writable_fields": ["post_id", "referrer", "user_agent"],
  "schema": {
    "type": "object",
    "properties": {
      "post_id":    { "type": "string" },
      "referrer":   { "type": "string" },
      "user_agent": { "type": "string" }
    },
    "required": ["post_id"]
  },
  "pipelines": {
    "by_post": [
      { "$group": { "_id": "$post_id", "views": { "$sum": 1 } } },
      { "$sort": { "views": -1 } }
    ],
    "by_day": [
      { "$group": {
        "_id": { "$dateToString": { "format": "%Y-%m-%d", "date": "$created_at" } },
        "views": { "$sum": 1 }
      }},
      { "$sort": { "_id": -1 } },
      { "$limit": 30 }
    ]
  },
  "ttl": { "field": "created_at", "expire_after": "90d" }
}
```

Fire-and-forget from the frontend when a post is opened:

```javascript
async function openPost(id) {
  // Track the view (best-effort, no await)
  api('POST', '/api/page_views', { post_id: id });
  // ... render post ...
}
```

Admin dashboard:

```bash
# Most viewed posts
GET /api/page_views/_agg/by_post

# Views per day (last 30 days)
GET /api/page_views/_agg/by_day
```

---

## 6. Pipeline Recipes

Pipelines are aggregation endpoints declared in the manifest. Use them for
analytics, leaderboards, and cross-collection queries.

### Trending Posts (Most Commented This Week)

```json
"posts": {
  "pipelines": {
    "trending": [
      { "$lookup": {
        "from": "comments",
        "let": { "pid": { "$toString": "$_id" } },
        "pipeline": [
          { "$match": {
            "$expr": { "$eq": ["$post_id", "$$pid"] },
            "created_at": { "$gte": { "$subtract": ["$$NOW", 604800000] } }
          }}
        ],
        "as": "_recent_comments"
      }},
      { "$addFields": { "recent_comment_count": { "$size": "$_recent_comments" } } },
      { "$match": { "status": "published", "recent_comment_count": { "$gt": 0 } } },
      { "$sort": { "recent_comment_count": -1 } },
      { "$limit": 10 },
      { "$project": { "_recent_comments": 0 } }
    ]
  }
}
```

### Author Leaderboard

```json
"posts": {
  "pipelines": {
    "leaderboard": [
      { "$match": { "status": "published" } },
      { "$group": {
        "_id": "$author",
        "posts": { "$sum": 1 },
        "latest": { "$max": "$created_at" }
      }},
      { "$sort": { "posts": -1 } },
      { "$limit": 20 }
    ]
  }
}
```

### Tag Cloud

```json
"posts": {
  "pipelines": {
    "tag_cloud": [
      { "$match": { "status": "published" } },
      { "$unwind": "$tags" },
      { "$group": { "_id": "$tags", "count": { "$sum": 1 } } },
      { "$sort": { "count": -1 } },
      { "$limit": 50 }
    ]
  }
}
```

Render as a weighted tag cloud in the frontend:

```javascript
async function loadTagCloud() {
  const r = await api('GET', '/api/posts/_agg/tag_cloud');
  const tags = r.data || [];
  const maxCount = Math.max(...tags.map(t => t.count), 1);
  return tags.map(t => {
    const size = 0.7 + (t.count / maxCount) * 1.3; // 0.7rem to 2rem
    return `<a href="#" onclick="filterByTag('${esc(t._id)}')"
      style="font-size:${size}rem;padding:4px 8px;display:inline-block">${esc(t._id)}</a>`;
  }).join(' ');
}
```

### Monthly Archive

```json
"posts": {
  "pipelines": {
    "archive": [
      { "$match": { "status": "published" } },
      { "$group": {
        "_id": { "$dateToString": { "format": "%Y-%m", "date": "$created_at" } },
        "count": { "$sum": 1 }
      }},
      { "$sort": { "_id": -1 } }
    ]
  }
}
```

```bash
GET /api/posts/_agg/archive
# [{"_id": "2025-03", "count": 8}, {"_id": "2025-02", "count": 12}, ...]
```

---

## 7. Hook Recipes

Hooks fire after write operations. Use them for side effects -- audit logging,
cross-collection updates, notifications, and external integrations. In 0.8.7,
hooks support conditional execution (`if`), atomic updates (`$inc`), delete
actions, HTTP webhooks, retry policies, and transactional guarantees.

### Recipe: Cross-Collection Counters with `$inc`

Maintain a denormalized `comment_count` on posts. When a comment is approved,
increment the counter atomically; when un-approved, decrement it.

```json
"comments": {
  "hooks": {
    "after_update": [
      {
        "action": "update",
        "collection": "posts",
        "filter": { "_id": "{{doc.post_id}}" },
        "update": { "$inc": { "comment_count": 1 } },
        "if": { "doc.approved": true, "prev.approved": false }
      },
      {
        "action": "update",
        "collection": "posts",
        "filter": { "_id": "{{doc.post_id}}" },
        "update": { "$inc": { "comment_count": -1 } },
        "if": { "doc.approved": false, "prev.approved": true }
      }
    ]
  }
}
```

**How it works:**

- `"action": "update"` runs an update operation on the target collection
- `"$inc"` atomically increments/decrements — no race conditions
- `"if"` checks the transition: the hook only fires when `approved` actually
  changes, not on every update. `prev.approved` refers to the value *before*
  the update.

This replaces the need for a computed `$lookup` count on every read. The
tradeoff: you maintain a denormalized field, but reads are instant.

### Recipe: Conditional Notification on Publish

Notify editors only when a post transitions from draft to published — not on
every update:

```json
"posts": {
  "hooks": {
    "after_update": [
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
    ]
  }
}
```

**The `if` block** supports any MQL comparison on `doc.*` and `prev.*`:

| Pattern | Meaning |
|---|---|
| `"doc.status": "published"` | New value equals "published" |
| `"prev.status": { "$ne": "published" }` | Old value was *not* "published" |
| `"doc.featured": true` | Document is now featured |

This is already in the blog's `manifest.json`. The notification lands in the
`notifications` collection and auto-expires via TTL after 7 days.

### Recipe: Activity Feed with Conditional Hooks

Create an `activity` collection populated selectively — only for published
posts, not drafts:

```json
"activity": {
  "auto_crud": true,
  "read_only": true,
  "timestamps": false,
  "ttl": { "field": "timestamp", "expire_after": "30d" }
}
```

Add conditional hooks to posts and comments:

```json
"posts": {
  "hooks": {
    "after_create": [
      { "action": "insert", "collection": "audit_log", "document": { ... } },
      {
        "action": "insert",
        "collection": "activity",
        "document": {
          "type": "new_post",
          "title": "{{doc.title}}",
          "author": "{{user.email}}",
          "post_id": "{{doc._id}}",
          "timestamp": "$$NOW"
        },
        "if": { "doc.status": "published" }
      }
    ],
    "after_update": [
      {
        "action": "insert",
        "collection": "activity",
        "document": {
          "type": "post_published",
          "title": "{{doc.title}}",
          "author": "{{user.email}}",
          "post_id": "{{doc._id}}",
          "timestamp": "$$NOW"
        },
        "if": {
          "doc.status": "published",
          "prev.status": { "$ne": "published" }
        }
      }
    ]
  }
},
"comments": {
  "hooks": {
    "after_create": [
      {
        "action": "insert",
        "collection": "activity",
        "document": {
          "type": "new_comment",
          "author": "{{user.email}}",
          "post_id": "{{doc.post_id}}",
          "timestamp": "$$NOW"
        }
      }
    ]
  }
}
```

Draft creation doesn't pollute the activity feed. Only publishes and comments
appear.

```bash
GET /api/activity?sort=-timestamp&limit=20
```

### Recipe: Cascade Delete via Hooks

If you prefer explicit control over what happens when a post is deleted (instead
of using the `cascade` config), use a `delete` hook action:

```json
"posts": {
  "hooks": {
    "after_delete": [
      {
        "action": "delete",
        "collection": "comments",
        "filter": { "post_id": "{{doc._id}}" }
      },
      {
        "action": "delete",
        "collection": "reactions",
        "filter": { "post_id": "{{doc._id}}" }
      },
      {
        "action": "insert",
        "collection": "audit_log",
        "document": {
          "event": "post_deleted",
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

This deletes all comments and reactions when a post is deleted. Unlike the
`cascade` config (Section 8), hook-based cascades give you more control —
you can mix deletes with audit inserts, add conditions, or target collections
that `cascade` doesn't cover.

**When to use hooks vs `cascade`:** Use `cascade` (Section 8) for simple
parent→child cleanup. Use hooks when you need conditional logic, audit trails,
or cross-cutting concerns alongside the delete.

### Recipe: HTTP Webhook (Slack Notification)

Post a message to Slack when a new post is published:

```json
"posts": {
  "hooks": {
    "after_update": [
      {
        "action": "http",
        "method": "POST",
        "url": "{{env.SLACK_WEBHOOK_URL}}",
        "headers": { "Content-Type": "application/json" },
        "body": {
          "text": "New post published: *{{doc.title}}* by {{user.email}}"
        },
        "if": {
          "doc.status": "published",
          "prev.status": { "$ne": "published" }
        }
      }
    ]
  }
}
```

Set `SLACK_WEBHOOK_URL` in your `.env`:

```bash
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T00/B00/xxxx
```

The `http` action fires asynchronously — it never blocks the API response. If
the webhook fails, the post is still saved. Use `retry` (below) for
reliability.

### Recipe: Background Hook with Retry (SendGrid Email)

Send a welcome email to new subscribers via SendGrid, with retry on failure:

```json
"subscribers": {
  "hooks": {
    "after_create": [
      {
        "action": "http",
        "method": "POST",
        "url": "https://api.sendgrid.com/v3/mail/send",
        "headers": {
          "Authorization": "Bearer {{env.SENDGRID_API_KEY}}",
          "Content-Type": "application/json"
        },
        "body": {
          "personalizations": [{ "to": [{ "email": "{{doc.email}}" }] }],
          "from": { "email": "noreply@yourblog.com" },
          "subject": "Welcome to the blog!",
          "content": [{ "type": "text/plain", "value": "Thanks for subscribing, {{doc.name}}!" }]
        },
        "retry": { "attempts": 3, "backoff": "exponential" }
      }
    ]
  }
}
```

`retry` ensures transient failures (network blips, 429 rate limits) don't
silently lose the email. The engine retries up to 3 times with exponential
backoff (1s → 2s → 4s).

### Recipe: Transactional Hooks (Audit-Critical Writes)

For audit-critical operations where the hook *must* succeed or the write should
roll back, use `transactional: true`:

```json
"posts": {
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
          "title": "{{doc.title}}",
          "timestamp": "$$NOW"
        },
        "transactional": true
      }
    ]
  }
}
```

With `transactional: true`, the engine wraps the original write and the hook
in a MongoDB transaction. If the audit insert fails, the post creation is
rolled back. Use this sparingly — transactions add latency and require a
replica set.

**Default behavior (without `transactional`):** Hooks are fire-and-forget.
A hook failure is logged but never blocks the API response.

---

## 8. Cascade Delete Recipes

When a parent document is deleted, cascade rules automatically clean up child
documents. The blog uses this to delete comments when a post is removed.

### `cascade.on_delete`

Hard-delete child documents when the parent is hard-deleted:

```json
"posts": {
  "cascade": {
    "on_delete": [
      { "collection": "comments",  "match_field": "post_id", "action": "delete" },
      { "collection": "reactions", "match_field": "post_id", "action": "delete" }
    ]
  }
}
```

When `DELETE /api/posts/{id}` fires, the engine automatically deletes all
comments and reactions whose `post_id` matches the deleted post's `_id`.

### `cascade.on_soft_delete`

Soft-delete child documents when the parent is soft-deleted:

```json
"posts": {
  "soft_delete": true,
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

| Operation | What Happens to Children |
|---|---|
| Hard delete (`DELETE` with `?permanent=true`) | Comments hard-deleted via `on_delete` |
| Soft delete (`DELETE` default) | Comments soft-deleted via `on_soft_delete` |
| Restore (`POST /{id}/_restore`) | Does **not** auto-restore children |

### Cascade + Soft Delete Interaction

The blog's posts collection uses both:

```json
"posts": {
  "soft_delete": true,
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

When an admin soft-deletes a post, its comments are also soft-deleted. Both
appear in their respective `_trash` endpoints:

```bash
# Soft-deleted posts
GET /api/posts/_trash

# Soft-deleted comments
GET /api/comments/_trash
```

To restore the post *and* its comments, restore them separately:

```bash
POST /api/posts/<post_id>/_restore
# Then restore the orphaned comments:
# (comments don't auto-restore — you need to handle them)
```

### Multi-Level Cascade

Chain cascades for deeper hierarchies. If you add reactions to comments:

```json
"comments": {
  "cascade": {
    "on_delete": [
      { "collection": "comment_reactions", "match_field": "comment_id", "action": "delete" }
    ]
  }
}
```

Deleting a post → deletes comments → deletes comment reactions. The engine
processes cascades recursively.

---

## 9. Cache Directive Recipes

The blog uses per-scope caching to speed up public reads while keeping admin
views fresh.

### Per-Scope Caching

```json
"posts": {
  "cache": {
    "scope:published": { "ttl": "5m", "stale_while_revalidate": "30s" },
    "default": { "ttl": "0s" }
  }
}
```

| Key | Meaning |
|---|---|
| `scope:published` | Cache responses for `?scope=published` for 5 minutes |
| `stale_while_revalidate` | Serve stale data for 30s while refreshing in background |
| `default` | All other queries (drafts, admin views) bypass cache |

The published feed loads instantly for readers. Admin views always show live
data.

### Aggressive Caching for High-Traffic Blogs

Increase TTL and add cache rules for pipelines:

```json
"posts": {
  "cache": {
    "scope:published": { "ttl": "15m", "stale_while_revalidate": "2m" },
    "scope:featured":  { "ttl": "10m", "stale_while_revalidate": "1m" },
    "pipeline:tag_cloud": { "ttl": "30m" },
    "pipeline:archive":   { "ttl": "1h" },
    "default": { "ttl": "0s" }
  }
}
```

Tag clouds and archives change rarely — cache them for 30 minutes to an hour.

### Bypassing Cache for Admin Queries

The `default` key with `"ttl": "0s"` ensures non-scoped queries (admin panel,
draft views) always hit the database. You can also scope admin views explicitly:

```json
"posts": {
  "cache": {
    "scope:published": { "ttl": "5m", "stale_while_revalidate": "30s" },
    "scope:drafts":    { "ttl": "0s" },
    "scope:archived":  { "ttl": "0s" },
    "default":         { "ttl": "0s" }
  }
}
```

Admins editing drafts always see the latest version. Readers browsing the
published feed get the cached version.

### Cache for Static Collections

Collections that change rarely benefit from longer TTLs:

```json
"categories": {
  "cache": {
    "default": { "ttl": "1h", "stale_while_revalidate": "5m" }
  }
},
"tags": {
  "cache": {
    "default": { "ttl": "30m", "stale_while_revalidate": "2m" }
  }
}
```

---

## 10. SSR Recipes

The blog ships with server-side rendered routes for SEO. The `ssr` config in
the manifest defines HTML templates, data bindings, and SEO metadata — all
without writing Python.

### Adding a New SSR Route

Add an `/s/about` page that pulls data from a hypothetical `site_info`
collection:

```json
"ssr": {
  "routes": {
    "/s/about": {
      "template": "about.html",
      "data": {
        "info": {
          "collection": "site_info",
          "filter": { "slug": "about" },
          "single": true
        }
      },
      "seo": {
        "title": "About — blog-zero",
        "description": "Learn about the blog and its authors."
      },
      "cache": { "ttl": "1h" }
    }
  }
}
```

Create `src/templates/about.html`:

```html
<div class="wrap">
  <h1>{{ info.title }}</h1>
  <div class="prose">{{ info.body }}</div>
</div>
```

The engine fetches data at request time, renders the template, and returns
full HTML — indexable by search engines.

### Auth-Gated SSR Pages

Restrict an SSR route to authenticated users:

```json
"ssr": {
  "routes": {
    "/s/dashboard": {
      "template": "dashboard.html",
      "auth": { "required": true, "roles": ["editor"] },
      "data": {
        "my_drafts": {
          "collection": "posts",
          "filter": { "status": "draft", "author_id": "{{user._id}}" },
          "sort": { "updated_at": -1 },
          "limit": 20
        },
        "notifications": {
          "collection": "notifications",
          "filter": { "read": false },
          "sort": { "timestamp": -1 },
          "limit": 10
        }
      },
      "seo": {
        "title": "Dashboard — blog-zero"
      }
    }
  }
}
```

Unauthenticated visitors get a redirect to the login page. The template can
reference `{{ user.email }}` for personalization.

### Custom JSON-LD for Rich Search Results

The blog's post detail page already includes JSON-LD. Customize it for richer
snippets:

```json
"/s/posts/{id}": {
  "template": "post.html",
  "data": {
    "post": { "collection": "posts", "id_param": "id" },
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
    "json_ld": {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      "headline": "{{post.title}}",
      "datePublished": "{{post.created_at}}",
      "dateModified": "{{post.updated_at}}",
      "wordCount": "{{post.word_count}}",
      "commentCount": "{{post.comment_count}}",
      "author": {
        "@type": "Person",
        "name": "{{post.author}}"
      },
      "publisher": {
        "@type": "Organization",
        "name": "blog-zero",
        "url": "https://yourblog.com"
      }
    }
  },
  "cache": { "ttl": "10m", "stale_while_revalidate": "1m" }
}
```

Google uses JSON-LD to generate rich search cards with author, date, and
comment count.

### SSR Route for Tag-Filtered Pages

Create SEO-friendly tag pages:

```json
"/s/tags/{tag}": {
  "template": "index.html",
  "data": {
    "posts": {
      "collection": "posts",
      "filter": { "status": "published", "tags": "{{params.tag}}" },
      "sort": { "created_at": -1 },
      "limit": 20
    }
  },
  "seo": {
    "title": "Posts tagged '{{params.tag}}' — blog-zero",
    "description": "All posts tagged with {{params.tag}}."
  },
  "cache": { "ttl": "10m" }
}
```

```bash
GET /s/tags/python
# Returns server-rendered HTML of all posts tagged "python"
```

---

## 11. Scheduled Job Recipes

The `jobs` config runs background tasks on a cron schedule. No external
scheduler needed — the engine handles it.

### Archive Stale Drafts

The blog ships with this job. Drafts untouched for 90 days are auto-archived:

```json
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
```

| Schedule Shorthand | Meaning |
|---|---|
| `@daily` | Once a day at midnight UTC |
| `@hourly` | Once an hour at :00 |
| `@weekly` | Once a week on Sunday at midnight UTC |
| `"0 9 * * *"` | Standard cron syntax (9 AM UTC daily) |

### Clean Up Expired Notifications

The `notifications` collection has a 7-day TTL, but you can also proactively
purge read notifications:

```json
"jobs": {
  "cleanup_read_notifications": {
    "schedule": "@daily",
    "action": "delete",
    "collection": "notifications",
    "filter": {
      "read": true,
      "timestamp": { "$lt": "$$NOW_MINUS_3D" }
    }
  }
}
```

Read notifications older than 3 days are deleted, reducing collection size
between TTL sweeps.

### Generate Daily Digest

Insert a summary document each morning for an email digest workflow:

```json
"jobs": {
  "daily_digest": {
    "schedule": "0 8 * * *",
    "action": "insert",
    "collection": "digests",
    "document": {
      "type": "daily",
      "generated_at": "$$NOW",
      "status": "pending"
    }
  }
}
```

Pair with an `http` hook on the `digests` collection to trigger an external
email service when a new digest document appears:

```json
"digests": {
  "auto_crud": true,
  "read_only": true,
  "hooks": {
    "after_create": [
      {
        "action": "http",
        "method": "POST",
        "url": "{{env.DIGEST_WEBHOOK_URL}}",
        "headers": { "Content-Type": "application/json" },
        "body": { "digest_id": "{{doc._id}}", "type": "{{doc.type}}" },
        "retry": { "attempts": 3, "backoff": "exponential" }
      }
    ]
  }
}
```

### Purge Old Page Views

Keep analytics lean by removing page views older than 90 days (belt-and-suspenders
with the TTL index):

```json
"jobs": {
  "purge_old_views": {
    "schedule": "@weekly",
    "action": "delete",
    "collection": "page_views",
    "filter": {
      "created_at": { "$lt": "$$NOW_MINUS_90D" }
    }
  }
}
```

---

## 12. UI/UX Customization

The frontend is a single `public/index.html` file using CSS custom properties.
Every visual aspect is customizable.

### 12.1 Theme System (CSS Variables)

The entire design is driven by CSS custom properties in `:root`. Change colors,
fonts, spacing, and borders in one place.

#### Dark Theme (Default)

```css
:root {
  --bg: #0a0a0b;
  --surface: #111113;
  --surface2: #18181b;
  --surface3: #1f1f23;
  --border: #27272a;
  --border-h: #3f3f46;
  --text: #fafafa;
  --text2: #a1a1aa;
  --text3: #71717a;
  --accent: #8b5cf6;
  --accent2: #c4b5fd;
  --accent-bg: rgba(139,92,246,.08);
}
```

#### Light Theme

Replace the `:root` block:

```css
:root {
  --bg: #ffffff;
  --surface: #f8f9fa;
  --surface2: #f1f3f5;
  --surface3: #e9ecef;
  --border: #dee2e6;
  --border-h: #ced4da;
  --text: #212529;
  --text2: #495057;
  --text3: #868e96;
  --accent: #7c3aed;
  --accent2: #6d28d9;
  --accent-bg: rgba(124,58,237,.06);
  --green: #16a34a;
  --green-bg: rgba(22,163,74,.06);
  --red: #dc2626;
  --red-bg: rgba(220,38,38,.06);
  --amber: #d97706;
  --amber-bg: rgba(217,119,6,.06);
}
```

#### Auto Light/Dark (System Preference)

```css
:root { /* light defaults */ }

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0a0a0b;
    --surface: #111113;
    /* ... dark values ... */
  }
}
```

#### Accent Color Presets

Change `--accent` and `--accent2` for a different brand feel:

| Brand | `--accent` | `--accent2` |
|---|---|---|
| Purple (default) | `#8b5cf6` | `#c4b5fd` |
| Blue | `#3b82f6` | `#93c5fd` |
| Green | `#22c55e` | `#86efac` |
| Orange | `#f97316` | `#fdba74` |
| Pink | `#ec4899` | `#f9a8d4` |
| Red | `#ef4444` | `#fca5a5` |
| Teal | `#14b8a6` | `#5eead4` |

### 12.2 Typography

The blog uses three font stacks:

```css
:root {
  --sans: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --serif: 'Georgia', 'Times New Roman', serif;
  --mono: ui-monospace, 'SF Mono', Consolas, monospace;
}
```

- `--sans` -- navigation, UI elements, headings
- `--serif` -- article body (`.prose`)
- `--mono` -- code blocks, textarea

#### Use All Sans-Serif (Modern/Clean)

```css
.prose { font-family: var(--sans); }
```

#### Use a Custom Google Font

Add to `<head>`:

```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Merriweather:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">
```

```css
:root {
  --sans: 'Inter', system-ui, sans-serif;
  --serif: 'Merriweather', Georgia, serif;
}
```

### 12.3 Layout Variations

#### Wider Content Area

```css
:root { --max: 960px; }
```

#### Narrow/Focused Reading

```css
:root { --max: 640px; }
```

#### Full-Width Feed with Max-Width Articles

```css
:root { --max: 1100px; }
.article header, .prose, .comments { max-width: 720px; margin: 0 auto; }
```

### 12.4 Card Styles

#### Magazine Layout (Grid)

Replace the feed's flex layout with a grid:

```css
.feed {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
  background: none;
  border: none;
  border-radius: 0;
}
.card {
  border: 1px solid var(--border);
  border-radius: var(--rl);
}
```

#### Card with Left Border Accent

```css
.card {
  border-left: 3px solid var(--accent);
  border-radius: 0 var(--r) var(--r) 0;
}
```

#### Minimal Card (No Background)

```css
.card {
  background: transparent;
  padding: 20px 0;
  border-bottom: 1px solid var(--border);
}
.card:hover { background: transparent; }
.feed {
  background: none;
  border: none;
  gap: 0;
}
```

### 12.5 Nav Customization

#### Centered Nav

```css
nav.top .inner {
  justify-content: center;
}
nav.top .brand { position: absolute; left: 24px; }
.auth-area { position: absolute; right: 24px; }
```

#### Full-Width Nav (No Max Width)

```css
nav.top .inner { max-width: none; }
```

#### Bottom Nav (Mobile-First)

```css
@media (max-width: 640px) {
  nav.top {
    position: fixed;
    bottom: 0;
    top: auto;
    border-bottom: none;
    border-top: 1px solid var(--border);
  }
  .wrap { padding-bottom: 80px; }
}
```

### 12.6 Adding a Sidebar

Wrap the feed in a two-column layout:

```html
<div class="view on" id="v-feed">
  <div style="display:grid;grid-template-columns:1fr 280px;gap:24px;align-items:start">
    <div>
      <div class="feed-header">...</div>
      <div id="feed"></div>
    </div>
    <aside id="sidebar" style="position:sticky;top:72px">
      <div id="tagCloud" style="..."></div>
      <div id="recentPosts" style="..."></div>
    </aside>
  </div>
</div>
```

```css
@media (max-width: 820px) {
  #v-feed > div { grid-template-columns: 1fr !important; }
  #sidebar { display: none; }
}
```

Populate the sidebar with pipeline data:

```javascript
async function loadSidebar() {
  const [tags, archive] = await Promise.all([
    api('GET', '/api/posts/_agg/tag_cloud'),
    api('GET', '/api/posts/_agg/archive'),
  ]);
  // Render tag cloud and archive links
}
```

### 12.7 Article View Enhancements

#### Table of Contents (Auto-Generated)

Parse headings from the Markdown body client-side:

```javascript
function generateTOC(body) {
  const headings = [];
  body.replace(/^(#{1,3})\s+(.+)$/gm, (_, hashes, text) => {
    const level = hashes.length;
    const id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    headings.push({ level, text, id });
  });
  if (!headings.length) return '';
  return `<nav class="toc" style="margin-bottom:24px;padding:16px;background:var(--surface);
    border:1px solid var(--border);border-radius:var(--rl)">
    <strong style="font-size:.8rem;text-transform:uppercase;letter-spacing:.05em;color:var(--text3)">
      Contents</strong>
    <ul style="margin-top:8px;padding-left:0;list-style:none;font-size:.875rem">
      ${headings.map(h => `<li style="padding:2px 0 2px ${(h.level - 1) * 16}px">
        <a href="#${h.id}" style="color:var(--text2)">${esc(h.text)}</a></li>`).join('')}
    </ul></nav>`;
}
```

#### Reading Progress Bar

```html
<div id="readProgress" style="position:fixed;top:56px;left:0;height:2px;
  background:var(--accent);width:0;transition:width 50ms;z-index:99"></div>
```

```javascript
window.addEventListener('scroll', () => {
  if (state.currentView !== 'article') return;
  const h = document.documentElement.scrollHeight - window.innerHeight;
  const pct = h > 0 ? (window.scrollY / h) * 100 : 0;
  $('#readProgress').style.width = pct + '%';
});
```

#### Estimated Reading Time Badge

Already computed client-side by the `readTime()` function. Style it:

```css
.read-time {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--surface3);
  font-size: .7rem;
  color: var(--text3);
  font-weight: 500;
}
```

### 12.8 Search (Client-Side Filtering)

Add a search input above the feed:

```html
<input id="searchInput" placeholder="Search posts..." style="margin-bottom:16px">
```

Filter feed cards client-side:

```javascript
$('#searchInput').addEventListener('input', () => {
  const q = $('#searchInput').value.toLowerCase();
  $$('.card').forEach(card => {
    const text = card.textContent.toLowerCase();
    card.style.display = text.includes(q) ? '' : 'none';
  });
});
```

For server-side search, use a pipeline with `$regex`:

```json
"pipelines": {
  "search": [
    { "$match": {
      "status": "published",
      "$or": [
        { "title": { "$regex": "QUERY", "$options": "i" } },
        { "body": { "$regex": "QUERY", "$options": "i" } }
      ]
    }},
    { "$sort": { "created_at": -1 } },
    { "$limit": 20 }
  ]
}
```

### 12.9 Infinite Scroll / Pagination

Replace the single `loadFeed()` call with paginated loading:

```javascript
let feedPage = 0;
const PAGE_SIZE = 10;

async function loadFeedPage(reset = false) {
  if (reset) { feedPage = 0; $('#feed').innerHTML = '<div class="feed"></div>'; }
  const skip = feedPage * PAGE_SIZE;
  const r = await api('GET',
    `/api/posts?scope=published&sort=-created_at&limit=${PAGE_SIZE}&skip=${skip}&computed=comment_count`);
  const posts = r.data?.data || [];
  if (!posts.length && feedPage === 0) {
    $('#feed').innerHTML = '<div class="feed-empty"><p>No posts yet.</p></div>';
    return;
  }
  const container = $('#feed .feed') || $('#feed');
  posts.forEach(p => {
    const card = document.createElement('div');
    card.className = 'card';
    card.onclick = () => openPost(p._id);
    card.innerHTML = `...`; // card template
    container.appendChild(card);
  });
  feedPage++;
  if (posts.length < PAGE_SIZE) $('#loadMore')?.remove();
}
```

Add a "Load more" button or use `IntersectionObserver` for true infinite scroll:

```javascript
const observer = new IntersectionObserver(entries => {
  if (entries[0].isIntersecting) loadFeedPage();
}, { rootMargin: '200px' });

// After initial load, observe a sentinel element at the bottom
const sentinel = document.createElement('div');
sentinel.id = 'sentinel';
$('#feed').appendChild(sentinel);
observer.observe(sentinel);
```

### 12.10 Toast Notifications (Customizing)

Change toast position, animation, or duration:

```css
/* Top-center instead of bottom-right */
.toasts {
  position: fixed;
  top: 72px;
  left: 50%;
  transform: translateX(-50%);
  bottom: auto;
  right: auto;
}
```

Change the display duration in JavaScript:

```javascript
function toast(m, t = 'ok', duration = 3500) {
  const e = document.createElement('div');
  e.className = 'toast toast-' + t;
  e.textContent = m;
  $('#toasts').appendChild(e);
  setTimeout(() => {
    e.style.opacity = '0';
    e.style.transition = 'opacity .3s';
    setTimeout(() => e.remove(), 300);
  }, duration);
}
```

---

## Appendix A -- Manifest Diff Recipes

Quick copy-paste diffs for common customizations. Apply these to the base
`manifest.json`.

### A.1 Make All Posts Require Login to Read

```diff
 "posts": {
-  "auth": { "public_read": true, "write_roles": ["editor"] },
+  "auth": { "required": true, "write_roles": ["editor"] },
 }
```

### A.2 Add Editor Role (with Role Hierarchy)

```diff
 "auth": {
   "users": {
+    "role_hierarchy": {
+      "admin": ["editor", "moderator", "reader"],
+      "editor": ["reader"],
+      "moderator": ["reader"]
+    },
     "demo_users": [
-      { "email": "{{env.ADMIN_EMAIL}}", "password": "{{env.ADMIN_PASSWORD}}", "role": "admin" }
+      { "email": "{{env.ADMIN_EMAIL}}", "password": "{{env.ADMIN_PASSWORD}}", "role": "admin" },
+      { "email": "{{env.EDITOR_EMAIL}}", "password": "{{env.EDITOR_PASSWORD}}", "role": "editor" }
     ]
   }
 }

 "posts": {
-  "auth": { "public_read": true, "write_roles": ["admin"] },
+  "auth": { "public_read": true, "write_roles": ["editor"] },
 }
```

Admin inherits editor via `role_hierarchy` — no need to list both.

### A.3 Close Registration (Invite Only)

```diff
 "users": {
-  "allow_registration": true,
-  "registration_role": "reader",
+  "allow_registration": "invite_only",
+  "registration_role": "reader",
+  "invite_codes": ["{{env.INVITE_CODE}}"],
 }
```

### A.4 Add Visibility Field to Posts

```diff
 "posts": {
   "schema": {
     "properties": {
+      "visibility": { "type": "string", "enum": ["public", "members", "premium"] },
       "title": { "type": "string" },
     }
   },
-  "writable_fields": {
-    "editor": ["title", "body", "author", "status", "tags"],
-    "moderator": ["status", "tags"]
-  },
+  "writable_fields": {
+    "editor": ["title", "body", "author", "status", "tags", "visibility"],
+    "moderator": ["status", "tags"]
+  },
   "defaults": {
     "status": "draft",
     "tags": [],
-    "author": "{{user.email}}"
+    "author": "{{user.email}}",
+    "visibility": "public"
   },
   "scopes": {
     "published": { "status": "published" },
+    "public_feed": { "status": "published", "visibility": "public" },
+    "members_feed": {
+      "filter": { "status": "published", "visibility": { "$in": ["public", "members"] } },
+      "auth": { "required": true }
+    },
   }
 }
```

### A.5 Add Reactions Collection

```diff
 "collections": {
   "posts": { ... },
   "comments": { ... },
+  "reactions": {
+    "auto_crud": true,
+    "auth": { "required": true },
+    "owner_field": "user_id",
+    "schema": {
+      "type": "object",
+      "properties": {
+        "post_id": { "type": "string", "x-references": { "collection": "posts", "field": "_id" } },
+        "user_id": { "type": "string" },
+        "type": { "type": "string", "enum": ["like", "love", "fire", "think"] }
+      },
+      "required": ["post_id", "type"]
+    },
+    "defaults": { "user_id": "{{user._id}}" },
+    "immutable_fields": ["post_id", "user_id"]
+  },
 }
```

### A.6 Add Cover Image Support

```diff
 "posts": {
   "schema": {
     "properties": {
+      "cover_image": { "type": "string", "format": "uri" },
+      "cover_alt": { "type": "string" },
       "title": { "type": "string" },
     }
   },
-  "writable_fields": {
-    "editor": ["title", "body", "author", "status", "tags"],
-    "moderator": ["status", "tags"]
-  },
+  "writable_fields": {
+    "editor": ["title", "body", "author", "status", "tags", "cover_image", "cover_alt"],
+    "moderator": ["status", "tags"]
+  },
 }
```

### A.7 90-Day Audit Log to 365-Day

```diff
 "audit_log": {
   "ttl": {
     "field": "timestamp",
-    "expire_after": "90d"
+    "expire_after": "365d"
   }
 }
```

### A.8 Add Cascade Delete to Posts

```diff
 "posts": {
+  "soft_delete": true,
+  "cascade": {
+    "on_delete": [
+      { "collection": "comments", "match_field": "post_id", "action": "delete" }
+    ],
+    "on_soft_delete": [
+      { "collection": "comments", "match_field": "post_id", "action": "soft_delete" }
+    ]
+  },
 }
```

### A.9 Add Cache Directives to Posts

```diff
 "posts": {
+  "cache": {
+    "scope:published": { "ttl": "5m", "stale_while_revalidate": "30s" },
+    "default": { "ttl": "0s" }
+  },
 }
```

### A.10 Add an SSR Route

```diff
 "ssr": {
   "routes": {
+    "/s/tags/{tag}": {
+      "template": "index.html",
+      "data": {
+        "posts": {
+          "collection": "posts",
+          "filter": { "status": "published", "tags": "{{params.tag}}" },
+          "sort": { "created_at": -1 },
+          "limit": 20
+        }
+      },
+      "seo": {
+        "title": "Posts tagged '{{params.tag}}' — blog-zero",
+        "description": "All posts tagged with {{params.tag}}."
+      },
+      "cache": { "ttl": "10m" }
+    },
   }
 }
```

### A.11 Add a Scheduled Job

```diff
+"jobs": {
+  "archive_stale_drafts": {
+    "schedule": "@daily",
+    "action": "update",
+    "collection": "posts",
+    "filter": {
+      "status": "draft",
+      "updated_at": { "$lt": "$$NOW_MINUS_90D" }
+    },
+    "update": { "$set": { "status": "archived" } }
+  }
+}
```

---

## Appendix B -- CSS Variable Reference

Complete reference for all CSS custom properties used in `public/index.html`.

### Colors

| Variable | Default (Dark) | Purpose |
|---|---|---|
| `--bg` | `#0a0a0b` | Page background |
| `--surface` | `#111113` | Card, nav, panel backgrounds |
| `--surface2` | `#18181b` | Input backgrounds, hover states |
| `--surface3` | `#1f1f23` | Code backgrounds, tags |
| `--border` | `#27272a` | Borders, dividers |
| `--border-h` | `#3f3f46` | Border hover state |
| `--text` | `#fafafa` | Primary text |
| `--text2` | `#a1a1aa` | Secondary text, body copy |
| `--text3` | `#71717a` | Tertiary text, metadata |
| `--accent` | `#8b5cf6` | Primary accent (buttons, focus rings) |
| `--accent2` | `#c4b5fd` | Secondary accent (links, active nav) |
| `--accent-bg` | `rgba(139,92,246,.08)` | Accent background tint |
| `--green` | `#22c55e` | Success color |
| `--green-bg` | `rgba(34,197,94,.08)` | Success background |
| `--red` | `#ef4444` | Error/danger color |
| `--red-bg` | `rgba(239,68,68,.08)` | Error background |
| `--amber` | `#f59e0b` | Warning/draft color |
| `--amber-bg` | `rgba(245,158,11,.08)` | Warning background |

### Sizing

| Variable | Default | Purpose |
|---|---|---|
| `--r` | `8px` | Border radius (small elements) |
| `--rl` | `12px` | Border radius (large elements, cards) |
| `--max` | `820px` | Max content width |

### Typography

| Variable | Default | Purpose |
|---|---|---|
| `--sans` | `system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif` | UI text |
| `--serif` | `'Georgia', 'Times New Roman', serif` | Article body |
| `--mono` | `ui-monospace, 'SF Mono', Consolas, monospace` | Code, textarea |

---

## Appendix C -- Frontend Extension Patterns

### Pattern: Role-Based View Switching

Extend the existing `isAdmin()` pattern for multiple roles:

```javascript
function hasRole(...roles) {
  return roles.includes(state.session?.user?.role);
}

// Use in nav:
if (hasRole('editor', 'admin')) $$('.editor-only').forEach(el => el.classList.remove('hidden'));
if (hasRole('moderator', 'admin')) $$('.mod-only').forEach(el => el.classList.remove('hidden'));
```

### Pattern: Dynamic Scope Selector

Let readers pick how they filter the feed:

```html
<div style="display:flex;gap:4px;margin-bottom:16px">
  <button class="btn btn-sm btn-o scope-btn on" data-scope="published">All</button>
  <button class="btn btn-sm btn-o scope-btn" data-scope="featured">Featured</button>
  <button class="btn btn-sm btn-o scope-btn" data-scope="series">Series</button>
</div>
```

```javascript
$$('.scope-btn').forEach(btn => {
  btn.onclick = () => {
    $$('.scope-btn').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    loadFeed(btn.dataset.scope);
  };
});

async function loadFeed(scope = 'published') {
  const r = await api('GET', `/api/posts?scope=${scope}&sort=-created_at&limit=50`);
  // ... render ...
}
```

### Pattern: Tag Filter from Feed

Click a tag to filter posts:

```javascript
function filterByTag(tag) {
  loadFeed(null, { tags: `in:${tag}` });
}

async function loadFeed(scope = 'published', extraFilters = {}) {
  const params = new URLSearchParams({
    scope,
    sort: '-created_at',
    limit: '50',
    computed: 'comment_count',
    ...extraFilters,
  });
  const r = await api('GET', '/api/posts?' + params);
  // ... render ...
}
```

### Pattern: Persistent Dark/Light Toggle

```javascript
function toggleTheme() {
  const isDark = document.documentElement.classList.toggle('light');
  localStorage.setItem('theme', isDark ? 'light' : 'dark');
}

// On boot:
if (localStorage.getItem('theme') === 'light') {
  document.documentElement.classList.add('light');
}
```

```css
:root { /* dark theme variables */ }

:root.light {
  --bg: #ffffff;
  --surface: #f8f9fa;
  --surface2: #f1f3f5;
  --surface3: #e9ecef;
  --border: #dee2e6;
  --border-h: #ced4da;
  --text: #212529;
  --text2: #495057;
  --text3: #868e96;
  --accent: #7c3aed;
  --accent2: #6d28d9;
  --accent-bg: rgba(124,58,237,.06);
  --green: #16a34a;
  --green-bg: rgba(22,163,74,.06);
  --red: #dc2626;
  --red-bg: rgba(220,38,38,.06);
  --amber: #d97706;
  --amber-bg: rgba(217,119,6,.06);
}
```

Add a toggle button to the nav:

```html
<button class="btn-icon" onclick="toggleTheme()" title="Toggle theme">◐</button>
```

### Pattern: Copy Link / Share Button

Add to the article view:

```javascript
function sharePost(id, title) {
  const url = `${BASE}/api/posts/${id}`;
  if (navigator.share) {
    navigator.share({ title, url });
  } else {
    navigator.clipboard.writeText(window.location.origin + `#post-${id}`);
    toast('Link copied!', 'info');
  }
}
```

### Pattern: Keyboard Navigation

```javascript
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'Escape' && state.currentView === 'article') go('feed');
  if (e.key === '/' && state.currentView === 'feed') {
    e.preventDefault();
    $('#searchInput')?.focus();
  }
});
```

---

*See also: [MDB_ENGINE_101.md](MDB_ENGINE_101.md) for the full framework
reference, [BLOG_101.md](BLOG_101.md) for the blog walkthrough,
[blog.md](blog.md) for the architecture overview,
[EXEC_SUMMARY.md](EXEC_SUMMARY.md) for the executive summary,
[LIMITS.md](LIMITS.md) for known limitations and workarounds.*
