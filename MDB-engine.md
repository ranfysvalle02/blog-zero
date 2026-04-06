# Proposed mdb-engine Fixes: Base64 Image Leaks

## Problem

When a post body contains inline base64-encoded images (e.g. pasted from clipboard),
several mdb-engine behaviors cause them to leak into places that are harmful:

1. **`og:image` / `twitter:image` meta tags** rendered with multi-hundred-KB `data:` URIs
   that social media crawlers cannot use and that bloat every HTML response.
2. **SSR JSON payloads** that serialize the full post document (including body and
   computed `cover_image`) into `<script id="ssr-data">`, ballooning page weight.
3. **Computed `cover_image` field** stores the raw data URI extracted by the
   `first_image` transform, propagating the blob everywhere the field is referenced.

### What blog-zero already fixed (client-side workarounds)

| Fix | File | Effect |
|-----|------|--------|
| Removed `{{post.cover_image}}` from `og_image` fallback | `manifest.json` | Server no longer resolves cover_image into og:image |
| Skip `data:` URIs in `updateSeo()` | `seo.js` | Client JS never sets a data URI on meta tags |
| Inline `<script>` strips leftover `data:` meta tags | `app-shell.html` | Belt-and-suspenders DOM cleanup |
| `extractCover()` returns `null` for data URIs | `utils.js` | Card covers and article banners skip data URI images |

These are **workarounds**. The root causes live in mdb-engine.

---

## Proposed mdb-engine Changes

### 1. `first_image` computed transform: skip data URIs

**Current behavior:** Extracts the first `![alt](src)` from the body regardless of scheme.

**Proposed behavior:** Skip any image whose `src` starts with `data:`. Return the first
image that has an `http://`, `https://`, or `/` scheme. Return `null` if none qualifies.

```python
# pseudocode for the transform
def first_image(body: str) -> str | None:
    for match in IMAGE_RE.finditer(body):
        src = match.group("src")
        if src.startswith("data:"):
            continue
        return src
    return None
```

**Impact:** `cover_image` will be `null` (or a real URL) instead of a base64 blob.
Any manifest config referencing `{{post.cover_image}}` in OG tags or elsewhere becomes safe.

### 2. OG meta rendering in `mdb_base.html`: guard against data URIs

Even after fixing `first_image`, users could craft a manifest that directly templates
a field containing a data URI into `og_image`. mdb-engine should defensively skip
`data:` URIs when rendering `og:image` and `twitter:image` meta tags.

```python
# in the template rendering logic
if og_image and not og_image.startswith("data:"):
    emit_meta("og:image", og_image)
    emit_meta("twitter:image", og_image)
```

### 3. Jinja2 filter: `strip_data_uris`

Expose a filter that app templates can use to sanitize any field:

```jinja2
{{ post.cover_image | strip_data_uris }}
```

This returns `""` (or `None`) if the value is a `data:` URI, and passes through
otherwise. Useful as a general-purpose safety valve.

### 4. SSR data projection (field selection)

Allow manifest SSR route configs to specify which fields to include/exclude in the
data passed to `tojson`:

```json
"data": {
  "post": {
    "collection": "posts",
    "id_param": "id",
    "exclude_fields": ["cover_image"]
  }
}
```

This lets apps drop computed fields that are redundant for client hydration.
`cover_image` is already re-derived client-side by `extractCover()`, so including
it in the SSR payload is pure waste.

### 5. Image upload endpoint / file storage (longer-term)

The root of the problem is that images are stored as inline base64 in the Markdown body.
This means:

- Every read of the document transfers the full image data.
- Every SSR render embeds it in HTML.
- `body`-derived computed fields (`excerpt`, `cover_image`, `reading_time`) all process
  it unnecessarily.

**Proposed:** mdb-engine provides an image upload endpoint that:

1. Accepts multipart uploads (or base64 POST bodies).
2. Stores images in a configurable backend (local filesystem, S3, GridFS).
3. Returns a stable URL (e.g. `/uploads/{hash}.{ext}`).
4. The compose editor replaces inline base64 with the returned URL before saving.

This eliminates base64 from `body` entirely and makes `cover_image`, OG tags,
and SSR payloads all naturally lightweight.

Manifest config sketch:

```json
"uploads": {
  "enabled": true,
  "backend": "gridfs",
  "max_size": "5MB",
  "allowed_types": ["image/jpeg", "image/png", "image/gif", "image/webp"],
  "path_prefix": "/uploads"
}
```

---

## Priority

| # | Change | Effort | Impact |
|---|--------|--------|--------|
| 1 | `first_image` skip data URIs | Small | Fixes OG tags and cover_image everywhere |
| 2 | Guard data URIs in `mdb_base.html` | Small | Defense-in-depth for all apps |
| 3 | `strip_data_uris` filter | Small | Template-level escape hatch |
| 4 | SSR field projection | Medium | Reduces payload size for any large computed field |
| 5 | Image upload + file storage | Large | Eliminates the root cause entirely |

Items 1-3 are quick wins that could ship together. Item 4 is a nice-to-have.
Item 5 is the proper long-term solution.
