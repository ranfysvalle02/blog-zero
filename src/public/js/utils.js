import { marked } from "https://cdn.jsdelivr.net/npm/marked/lib/marked.esm.js";
import DOMPurify from "https://cdn.jsdelivr.net/npm/dompurify/dist/purify.es.mjs";

export const BLOG_CONFIG = {
  brand: { text: "blog-zero", logo: "/public/zero-logo.png" },
  tagline: "A real blog flow: public reading, authenticated comments, admin publishing.",
  footer: { text: "Powered by blog-zero", showSource: true },
  hero: {
    enabled: true,
    images: [
      "https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=1600&auto=format&fit=crop",
      "https://images.unsplash.com/photo-1765445666167-277747f28045?q=80&w=3169&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
      "https://images.unsplash.com/photo-1558459654-c430be5b0a44?q=80&w=2340&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
      "https://images.unsplash.com/photo-1629654297299-c8506221ca97?w=1600&auto=format&fit=crop",
    ],
    headline: "zero-code blog",
    caption: "Stories from the edge of code and creativity.",
    interval: 6000,
    overlay: "linear-gradient(180deg, rgba(10,10,10,0.15) 0%, rgba(10,10,10,0.45) 100%)",
  },
  landing: {
    recentCount: 6,
    layout: "grid",
    ctaText: "Browse all posts",
    ctaRoute: "blog",
    featuredPostId: null,
  },
  seo: {
    siteName: "zero-code blog",
    defaultDescription: "A full-featured blog built from a single JSON manifest.",
    defaultImage: "",
  },
  meta: {
    postsPerPage: 12,
    dateLocale: undefined,
    dateFormat: { month: "long", day: "numeric", year: "numeric" },
  },
};

export const API_CONFIG = {
  base: location.origin,
  endpoints: {
    session: { method: "GET", path: "/auth/me" },
    login: { method: "POST", path: "/auth/login" },
    register: { method: "POST", path: "/auth/register" },
    logout: { method: "POST", path: "/auth/logout" },
    listPosts: { method: "GET", path: "/api/posts", defaults: { scope: "published", sort: "-created_at", computed: "comment_count" } },
    getPost: { method: "GET", path: "/api/posts/:id" },
    createPost: { method: "POST", path: "/api/posts" },
    updatePost: { method: "PATCH", path: "/api/posts/:id" },
    deletePost: { method: "DELETE", path: "/api/posts/:id" },
    restorePost: { method: "POST", path: "/api/posts/:id/_restore" },
    countPosts: { method: "GET", path: "/api/posts/_count" },
    listTrash: { method: "GET", path: "/api/posts/_trash", defaults: { sort: "-created_at", limit: "100" } },
    listComments: { method: "GET", path: "/api/comments" },
    createComment: { method: "POST", path: "/api/comments" },
    updateComment: { method: "PATCH", path: "/api/comments/:id" },
    listAuditLog: { method: "GET", path: "/api/audit_log" },
    createUploadTracking: { method: "POST", path: "/api/upload_tracking" },
    updateUploadTracking: { method: "PATCH", path: "/api/upload_tracking/:id" },
    listUploadTracking: { method: "GET", path: "/api/upload_tracking" },
    listFeatured: { method: "GET", path: "/api/posts", defaults: { scope: "featured", sort: "-created_at", limit: "3" } },
    tagStats: { method: "GET", path: "/api/posts/_agg/by_tag" },
  },
};

export const UI_CONFIG = {
  features: { comments: true, auth: true, admin: true, auditLog: true, tags: true, readTime: true, softDelete: true },
  layout: { showTagline: true, showAuthorInCard: true, excerptLength: 210 },
  labels: {
    signIn: "Sign in",
    register: "Register",
    logout: "Logout",
    feedTitle: "Latest Posts",
    noPostsYet: "No published posts yet.",
    backToPosts: "Back to posts",
    postNotFound: "Post not found.",
    commentsTitle: "Comments",
    postComment: "Post comment",
    commentPrompt: "Write a thoughtful comment...",
    commentPending: "All comments require admin approval. Please follow our community guidelines.",
    signInToComment: "Register or sign in to leave a comment.",
    noComments: "No approved comments yet.",
    newPost: "New Post",
    editPost: "Edit Post",
    publish: "Publish",
    saveDraft: "Save Draft",
    manageTitle: "Manage",
    manageSub: "Admin area for posts and comment moderation.",
  },
};

export const state = {
  session: null,
  currentView: "home",
  manageScope: "all",
  authMode: "login",
  currentPostId: null,
  postCache: new Map(),
};

export const $ = (s) => document.querySelector(s);
export const $$ = (s) => [...document.querySelectorAll(s)];
export function go(path) { import("./app.js").then((m) => m.navigate(path)); }
export const setState = (k, v) => { state[k] = v; };

const _escDiv = document.createElement("div");
export function esc(s) {
  _escDiv.textContent = s ?? "";
  return _escDiv.innerHTML;
}

export function safeAttr(s) {
  return esc(s).replace(/"/g, "&quot;");
}

export function fmtDate(iso) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleDateString(BLOG_CONFIG.meta.dateLocale, BLOG_CONFIG.meta.dateFormat); }
  catch { return iso; }
}

export function readTime(body) {
  if (!body) return "1 min read";
  return Math.max(1, Math.round(body.split(/\s+/).length / 200)) + " min read";
}

export function shareUrl(postId) {
  return `${location.origin}/posts/${encodeURIComponent(postId)}`;
}

export function renderShareBar(postId, title) {
  const url = shareUrl(postId);
  const encodedUrl = encodeURIComponent(url);
  const encodedTitle = encodeURIComponent(title);
  return (
    `<div class="share-bar">` +
    `<span class="share-label">Share</span>` +
    `<button class="share-btn" data-action="copy-link" data-url="${safeAttr(url)}" aria-label="Copy link" title="Copy link">` +
    `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6.5 8.5a3 3 0 004.243 0l2-2a3 3 0 00-4.243-4.243l-1 1"/><path d="M9.5 7.5a3 3 0 00-4.243 0l-2 2a3 3 0 004.243 4.243l1-1"/></svg>` +
    `<span>Copy link</span></button>` +
    `<a class="share-btn" href="https://x.com/intent/tweet?url=${encodedUrl}&text=${encodedTitle}" target="_blank" rel="noopener noreferrer" aria-label="Share on X" title="Share on X">` +
    `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>` +
    `<span>X</span></a>` +
    `<a class="share-btn" href="https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}" target="_blank" rel="noopener noreferrer" aria-label="Share on LinkedIn" title="Share on LinkedIn">` +
    `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>` +
    `<span>LinkedIn</span></a>` +
    (navigator.share ? `<button class="share-btn" data-action="native-share" data-url="${safeAttr(url)}" data-title="${safeAttr(title)}" aria-label="More sharing options" title="More sharing options">` +
    `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 8h8M8 4v8"/><circle cx="8" cy="8" r="7"/></svg>` +
    `<span>More</span></button>` : "") +
    `</div>`
  );
}

export function excerpt(body, len = UI_CONFIG.layout.excerptLength) {
  if (!body) return "";
  const plain = body
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/data:[a-z/+]+;base64,[A-Za-z0-9+/=]+/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/[#*>`_\[\]()~|]/g, "")
    .replace(/---+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > len ? plain.slice(0, len) + "\u2026" : plain;
}

const ROLE_GRANTS = {
  admin:     new Set(["admin", "editor", "moderator", "reader"]),
  editor:    new Set(["editor", "reader"]),
  moderator: new Set(["moderator", "reader"]),
  reader:    new Set(["reader"]),
};

export function hasRole(required) {
  const userRole = state.session?.user?.role;
  return ROLE_GRANTS[userRole]?.has(required) ?? false;
}

export function isAdmin() { return hasRole("admin"); }
export function isAuthed() { return !!state.session?.authenticated; }

export function showConfirm({ title = "Are you sure?", message = "", okLabel = "Confirm", cancelLabel = "Cancel" } = {}) {
  return new Promise((resolve) => {
    const overlay = $("#confirm-overlay");
    if (!overlay) { resolve(window.confirm(message || title)); return; }

    $("#confirm-title").textContent = title;
    $("#confirm-msg").textContent = message;
    $("#confirm-ok").textContent = okLabel;
    $("#confirm-cancel").textContent = cancelLabel;
    overlay.classList.add("active");
    overlay.setAttribute("aria-hidden", "false");
    overlay.inert = false;
    $("#confirm-cancel").focus();

    function cleanup(result) {
      overlay.classList.remove("active");
      overlay.setAttribute("aria-hidden", "true");
      overlay.inert = true;
      $("#confirm-ok").removeEventListener("click", onOk);
      $("#confirm-cancel").removeEventListener("click", onCancel);
      $("#confirm-backdrop").removeEventListener("click", onCancel);
      resolve(result);
    }
    function onOk() { cleanup(true); }
    function onCancel() { cleanup(false); }

    $("#confirm-ok").addEventListener("click", onOk);
    $("#confirm-cancel").addEventListener("click", onCancel);
    $("#confirm-backdrop").addEventListener("click", onCancel);
  });
}

export function toast(msg, type = "ok") {
  const el = document.createElement("div");
  el.className = `toast toast-${esc(type)}`;
  el.textContent = msg;
  $("#toasts").appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transition = "opacity 0.3s";
    setTimeout(() => el.remove(), 300);
  }, 2600);
}

export function renderSkeleton(count = 3) {
  let html = '<div class="skeleton">';
  for (let i = 0; i < count; i++) {
    html += '<div class="skeleton-card"><div class="skeleton-line skeleton-line-short"></div><div class="skeleton-line"></div><div class="skeleton-line skeleton-line-medium"></div></div>';
  }
  return html + "</div>";
}

const _retryFns = new Map();
let _retryCounter = 0;

export function renderError(message, retryFn) {
  if (!retryFn) return `<div class="error-state"><p>${esc(message)}</p></div>`;
  const id = `retry-${++_retryCounter}`;
  _retryFns.set(id, retryFn);
  return `<div class="error-state"><p>${esc(message)}</p><button class="btn btn-outline btn-sm" data-retry-id="${id}">Try again</button></div>`;
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-retry-id]");
  if (!btn) return;
  const fn = _retryFns.get(btn.dataset.retryId);
  if (fn) {
    _retryFns.delete(btn.dataset.retryId);
    fn();
  }
});

export async function api(name, opts = {}) {
  const ep = API_CONFIG.endpoints[name];
  if (!ep) throw new Error(`Unknown endpoint: ${name}`);

  let path = ep.path;
  if (opts.pathParams) {
    Object.entries(opts.pathParams).forEach(([k, v]) => {
      path = path.replace(`:${k}`, encodeURIComponent(v));
    });
  }

  const merged = Object.assign({}, ep.defaults, opts.params);
  const cleaned = {};
  for (const [k, v] of Object.entries(merged)) if (v != null && v !== "") cleaned[k] = v;
  const qs = new URLSearchParams(cleaned).toString();
  const url = API_CONFIG.base + path + (qs ? `?${qs}` : "");

  const fetchOpts = { method: ep.method, headers: {}, credentials: "include" };
  if (opts.body !== undefined) {
    fetchOpts.headers["Content-Type"] = "application/json";
    fetchOpts.body = JSON.stringify(opts.body);
  }

  try {
    const res = await fetch(url, fetchOpts);
    let data = null;
    try { data = await res.json(); } catch {}
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null, networkError: true };
  }
}

marked.setOptions({ gfm: true, breaks: true });

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A" && /^https?:\/\//i.test(node.getAttribute("href") || "")) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
  if (node.tagName === "IMG") node.setAttribute("loading", "lazy");
});

export function md(src) {
  if (!src) return "";
  return DOMPurify.sanitize(marked.parse(src));
}

export function applyBgImages(root = document) {
  root.querySelectorAll("[data-bg]").forEach((el) => {
    el.style.backgroundImage = `url(${el.dataset.bg})`;
    el.removeAttribute("data-bg");
  });
}

export function extractCover(body) {
  if (!body) return null;
  const m = body.match(/^!\[([^\]]*)\]\(([^)]+)\)/);
  if (!m) return null;
  return { alt: m[1], src: m[2] };
}

export function stripCover(body) {
  if (!body) return body;
  return body.replace(/^!\[([^\]]*)\]\(([^)]+)\)\s*\n?/, "");
}
