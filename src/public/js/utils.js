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
export const go = (path) => { location.hash = path; };
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

export function excerpt(body, len = UI_CONFIG.layout.excerptLength) {
  if (!body) return "";
  const plain = body.replace(/[#*>`_\[\]()~|]/g, "").replace(/\n+/g, " ").trim();
  return plain.length > len ? plain.slice(0, len) + "\u2026" : plain;
}

export function isAdmin() { return state.session?.user?.role === "admin"; }
export function isAuthed() { return !!state.session?.authenticated; }

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

  const fetchOpts = { method: ep.method, headers: {} };
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
