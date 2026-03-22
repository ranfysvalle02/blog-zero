import { $, $$, BLOG_CONFIG, UI_CONFIG, esc, api, go, renderSkeleton, renderError, applyBgImages } from "./utils.js";
import { renderCard } from "./feed.js";

let allPosts = [];
let tagList = [];
let activeTag = null;
let searchQuery = "";
let sortDir = "newest";
const PAGE_SIZE = BLOG_CONFIG.meta.postsPerPage;
let visibleCount = PAGE_SIZE;

export async function loadBlog() {
  const container = $("#blog-list");
  if (!container) return;
  visibleCount = PAGE_SIZE;
  container.innerHTML = renderSkeleton(4);

  const [postsRes, tagsRes] = await Promise.all([
    api("listPosts", { params: { limit: "200" } }),
    api("tagStats"),
  ]);

  if (postsRes.networkError) {
    container.innerHTML = renderError("Could not reach the server. Is the API running?", loadBlog);
    return;
  }

  allPosts = postsRes.data?.data || [];
  tagList = (tagsRes.ok ? tagsRes.data?.data || tagsRes.data || [] : [])
    .filter((t) => t._id)
    .sort((a, b) => b.count - a.count);

  renderTagChips();
  renderPosts();
}

function renderTagChips() {
  const el = $("#blog-tags");
  if (!el) return;
  if (!tagList.length) { el.innerHTML = ""; return; }
  el.innerHTML = tagList.map((t) =>
    `<button class="tag-chip${activeTag === t._id ? " active" : ""}" data-tag="${esc(t._id)}">${esc(t._id)} <span class="tag-count">${t.count}</span></button>`
  ).join("") + (activeTag ? '<button class="tag-chip tag-chip-clear" data-tag="">Clear</button>' : "");
}

function getFiltered() {
  let filtered = allPosts;
  if (activeTag) filtered = filtered.filter((p) => (p.tags || []).includes(activeTag));
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter((p) =>
      (p.title || "").toLowerCase().includes(q) || (p.body || "").toLowerCase().includes(q)
    );
  }
  if (sortDir === "oldest") filtered = [...filtered].reverse();
  return filtered;
}

function renderPosts() {
  const filtered = getFiltered();
  const container = $("#blog-list");

  if (!filtered.length) {
    container.innerHTML = `<div class="feed-empty"><p>${activeTag || searchQuery ? "No posts match your filters." : esc(UI_CONFIG.labels.noPostsYet)}</p></div>`;
    return;
  }

  const page = filtered.slice(0, visibleCount);
  const hasMore = filtered.length > visibleCount;
  const remaining = filtered.length - page.length;
  const pct = Math.round((page.length / filtered.length) * 100);

  container.innerHTML =
    `<div class="feed">${page.map((p) => renderCard(p)).join("")}</div>` +
    `<div class="feed-pagination">` +
      `<div class="feed-pag-bar"><div class="feed-pag-fill" style="width:${pct}%"></div></div>` +
      `<p class="post-count">${page.length} of ${filtered.length} post${filtered.length === 1 ? "" : "s"}</p>` +
      (hasMore ? `<button class="btn btn-outline" id="load-more-btn">Show ${Math.min(remaining, PAGE_SIZE)} more</button>` : "") +
    `</div>`;

  applyBgImages(container);
}

export function bindBlogEvents() {
  const searchEl = $("#blog-search");
  const tagsEl = $("#blog-tags");
  const sortEl = $("#blog-sort");
  const listEl = $("#blog-list");
  if (!searchEl || !tagsEl || !sortEl || !listEl) return;

  let searchTimer;
  searchEl.addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searchQuery = e.target.value.trim();
      visibleCount = PAGE_SIZE;
      renderPosts();
    }, 200);
  });

  tagsEl.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-tag]");
    if (!btn) return;
    activeTag = btn.dataset.tag || null;
    visibleCount = PAGE_SIZE;
    renderTagChips();
    renderPosts();
  });

  sortEl.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-sort]");
    if (!btn) return;
    sortDir = btn.dataset.sort;
    $$("#blog-sort button").forEach((b) => b.classList.toggle("active", b.dataset.sort === sortDir));
    visibleCount = PAGE_SIZE;
    renderPosts();
  });

  listEl.addEventListener("click", (e) => {
    if (e.target.closest("#load-more-btn")) {
      visibleCount += PAGE_SIZE;
      renderPosts();
      return;
    }
    const card = e.target.closest("[data-post-id]");
    if (card) go(`article/${card.dataset.postId}`);
  });
  listEl.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const card = e.target.closest("[data-post-id]");
    if (card) go(`article/${card.dataset.postId}`);
  });
}
