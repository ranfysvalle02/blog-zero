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

**Default admin:** `admin@example.com` / `admin123`

## What You Get

- **Landing page** with animated hero slideshow and recent posts grid
- **Blog browser** with search, tag filtering, and sort
- **About page** — standalone static page (`/public/about.html`)
- **Markdown editor** with live split-pane preview (powered by [marked](https://github.com/markedjs/marked) + [DOMPurify](https://github.com/cure53/DOMPurify))
- **User registration** and authenticated comments
- **Comment moderation** with admin approval workflow
- **Admin dashboard** — write, manage, trash/restore, audit log
- **SEO** — dynamic meta tags, Open Graph, JSON-LD structured data
- **Hero slideshow** — GSAP-powered Ken Burns transitions with nav controls
- **Dark / Light mode** with toggle switch
- **Responsive** — hamburger nav on mobile

## Architecture

Everything is defined in [`src/manifest.json`](src/manifest.json). The engine
([mdb-engine](https://pypi.org/project/mdb-engine/)) reads it and generates:

- REST API with auth, CRUD, scopes, and hooks
- MongoDB storage with validation and indexes
- Static file serving for the frontend

The frontend is vanilla ES modules in `src/public/` — no build step, no bundler.

```
src/
├── manifest.json          # the entire backend
├── Dockerfile             # cloud-ready container
├── docker-compose.yml     # one-command local setup
├── .env.example           # available env vars
└── public/
    ├── index.html         # SPA shell
    ├── about.html         # standalone about page
    ├── zero-logo.png      # brand logo
    ├── style.css          # all styles (Inter font, dark/light themes)
    ├── favicon.svg        # browser tab icon
    └── js/
        ├── app.js         # boot + hash router + theme toggle + hamburger
        ├── home.js        # landing page (hero + recent posts)
        ├── blog.js        # browse, search, tag filter
        ├── feed.js        # article view + comments
        ├── compose.js     # markdown post editor
        ├── manage.js      # admin dashboard
        ├── hero.js        # GSAP slideshow with Ken Burns effect
        ├── auth.js        # auth modal + session management
        ├── seo.js         # dynamic meta/OG/JSON-LD
        └── utils.js       # config, API adapter, markdown, helpers
```

## Routes

| Route | View |
|-------|------|
| `#home` | Landing page with hero slideshow + recent posts grid |
| `#blog` | Browse all posts with search, tag chips, sort |
| `#article/:id` | Single post with comments |
| `/public/about.html` | Static about page |
| `#compose` | Markdown editor (admin only) |
| `#manage` | Admin dashboard (admin only) |

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
pip install mdb-engine uvicorn
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
