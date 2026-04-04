# blog-zero

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![mdb-engine](https://img.shields.io/pypi/v/mdb-engine?label=mdb-engine&color=blue)](https://pypi.org/project/mdb-engine/)
[![GitHub](https://img.shields.io/github/stars/ranfysvalle02/blog-zero?style=social)](https://github.com/ranfysvalle02/blog-zero)

A full-featured blog from a single JSON file. No backend code.

**[GitHub](https://github.com/ranfysvalle02/blog-zero)** · **[mdb-engine on PyPI](https://pypi.org/project/mdb-engine/)**

---

## Quick Start

```bash
cd src
docker compose up --build
```

Open **http://localhost:8000** — your blog is live.
SSR preview at **http://localhost:8000/s** — crawlable, SEO-ready pages.

**Default admin:** `admin@example.com` / `admin123`

## What You Get

- **Landing page** with animated hero slideshow and recent posts grid
- **Blog browser** with search, tag filtering, and sort
- **About page** — standalone static page (`/public/about.html`)
- **Community guidelines** — standalone page (`/public/community.html`)
- **Markdown editor** with live split-pane preview (powered by [marked](https://github.com/markedjs/marked) + [DOMPurify](https://github.com/cure53/DOMPurify))
- **User registration** and authenticated comments
- **Comment moderation** with admin approval workflow
- **Admin dashboard** — write, manage, trash/restore, audit log
- **SEO** — dynamic meta tags, Open Graph, JSON-LD structured data
- **SSR pages** — server-rendered home and article views for crawlers (`/s`, `/s/posts/{id}`)
- **Auto-generated sitemap** at `/sitemap.xml`
- **Hero slideshow** — GSAP-powered Ken Burns transitions with nav controls
- **Dark / Light mode** with toggle switch
- **Responsive** — hamburger nav on mobile

### What's New in 0.8.7

- **SSR templates** — Jinja2-rendered pages for crawlers and social previews (`/s`, `/s/posts/{id}`)
- **Dual frontend** — SPA at `/#home` for interactive/admin, SSR at `/s` for SEO/crawlers
- **Role hierarchy** with per-role writable fields
- **Conditional hooks** and atomic hook operators
- **Cascade deletes** and referential integrity
- **Tag validation** and a dedicated tags collection
- **Cache directives** for fine-grained HTTP caching
- **Scheduled jobs** defined in the manifest
- **Managed indexes** — engine auto-creates MongoDB indexes from manifest
- **Notifications collection** for in-app alerts
- **CLI tools** — `mdb-engine diff`, `mdb-engine dry-run`, `mdb-engine codegen`

## Architecture

Everything is defined in [`src/manifest.json`](src/manifest.json). The engine
([mdb-engine >=0.11.2](https://pypi.org/project/mdb-engine/)) reads it and generates:

- REST API with auth, CRUD, scopes, and hooks
- MongoDB storage with validation, managed indexes, and referential integrity
- SSR pages via Jinja2 templates in `src/templates/`
- Static file serving for the SPA frontend

The SPA frontend is vanilla ES modules in `src/public/` — no build step, no bundler.
The SSR frontend uses Jinja2 templates in `src/templates/` for crawlable, SEO-optimized pages.

```
src/
├── manifest.json
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── templates/
│   ├── index.html         # SSR home (server-rendered for crawlers)
│   ├── post.html          # SSR article (JSON-LD, OG tags)
│   ├── 404.html           # custom not-found
│   └── 500.html           # custom server error
└── public/
    ├── index.html         # SPA shell (hash-routed)
    ├── about.html         # standalone about page
    ├── community.html     # community guidelines
    ├── style.css
    ├── favicon.svg
    └── js/
        ├── app.js
        ├── home.js
        ├── blog.js
        ├── feed.js
        ├── compose.js
        ├── manage.js
        ├── hero.js
        ├── auth.js
        ├── seo.js
        ├── page-shell.js
        └── utils.js
```

## Routes

| Route | View |
|-------|------|
| `/#home` | Landing page with hero slideshow + recent posts grid |
| `/#blog` | Browse all posts with search, tag chips, sort |
| `/#article/:id` | Single post with comments |
| `/public/about.html` | Static about page |
| `/public/community.html` | Community guidelines & terms |
| `/#compose` | Markdown editor (admin only) |
| `/#manage` | Admin dashboard (admin only) |
| `/s` | SSR home (crawlers, SEO) |
| `/s/posts/{id}` | SSR article (crawlers, SEO, JSON-LD) |
| `/sitemap.xml` | Auto-generated sitemap |

## CLI Tools

```bash
mdb-engine diff manifest.json      # show what changed since last deploy
mdb-engine dry-run manifest.json   # validate without applying
mdb-engine codegen manifest.json   # generate client SDK stubs
```

## Customization

All user-facing config lives at the top of `src/public/js/utils.js`:

- **`BLOG_CONFIG`** — brand name, logo, tagline, hero images, landing layout, SEO defaults, footer
- **`API_CONFIG`** — endpoint map (swap backends by editing this object)
- **`UI_CONFIG`** — feature flags, layout options, all UI labels (mini i18n)

Theme colors are CSS custom properties at the top of `src/public/style.css`.

## Deploy

```bash
ADMIN_EMAIL=you@company.com \
ADMIN_PASSWORD=strong-secret \
MDB_JWT_SECRET=$(openssl rand -hex 32) \
MDB_ENGINE_MASTER_KEY=$(openssl rand -hex 32) \
docker compose up --build
```

See [`src/.env.example`](src/.env.example) for all available environment variables.

### Cloud (Render, Railway, Fly, etc.)

The `src/Dockerfile` is a standalone, cloud-ready container. Point your platform
at the `src/` directory and set these env vars:

| Variable | Required | Example |
|----------|----------|---------|
| `MONGODB_URI` | Yes | Your MongoDB Atlas connection string |
| `MDB_DB_NAME` | Yes | `blog_zero` |
| `ADMIN_EMAIL` | Yes | `you@company.com` |
| `ADMIN_PASSWORD` | Yes | Strong password |
| `MDB_JWT_SECRET` | Yes | Random 32+ char string |
| `MDB_ENGINE_MASTER_KEY` | Yes | Random 32+ char string |

### Run Locally (no Docker)

```bash
pip install "mdb-engine>=0.11.2" uvicorn httpx jinja2
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=admin123 \
  mdb-engine serve manifest.json --reload
```

## Deep Dive

See [`src/README.md`](src/README.md) for the full architecture walkthrough:
access control model, data flows, manifest reference, and API examples with curl.

## Links

- [mdb-engine on PyPI](https://pypi.org/project/mdb-engine/)
- [blog-zero on GitHub](https://github.com/ranfysvalle02/blog-zero)

## License

MIT
