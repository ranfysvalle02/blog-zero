import { $, BLOG_CONFIG, UI_CONFIG, esc, excerpt, api, go, renderSkeleton, renderError } from "./utils.js";
import { renderCard } from "./feed.js";
import { initHero } from "./hero.js";

let heroInitialized = false;

export async function loadHome() {
  if (!heroInitialized) {
    initHero();
    heroInitialized = true;
  }

  const cfg = BLOG_CONFIG.landing;
  const container = $("#home-recent");
  container.innerHTML = renderSkeleton(3);

  const r = await api("listPosts", { params: { limit: cfg.recentCount } });

  if (r.networkError) {
    container.innerHTML = renderError("Could not reach the server. Is the API running?", loadHome);
    return;
  }

  const posts = r.data?.data || [];
  if (!posts.length) {
    container.innerHTML = `<div class="feed-empty"><p>${esc(UI_CONFIG.labels.noPostsYet)}</p></div>`;
    return;
  }

  let featuredHtml = "";
  let gridPosts = posts;

  if (cfg.featuredPostId) {
    const featured = posts.find((p) => p._id === cfg.featuredPostId);
    if (featured) {
      gridPosts = posts.filter((p) => p._id !== cfg.featuredPostId);
      featuredHtml =
        `<div class="featured-banner" data-post-id="${esc(featured._id)}">` +
        `<div class="featured-label">Featured</div>` +
        `<h2>${esc(featured.title)}</h2>` +
        `<div class="excerpt">${esc(excerpt(featured.body))}</div>` +
        `</div>`;
    }
  }

  container.innerHTML =
    featuredHtml +
    `<div class="recent-grid">${gridPosts.map((p) => renderCard(p, "card-featured")).join("")}</div>`;
}

export function bindHomeEvents() {
  $("#home-recent").addEventListener("click", (e) => {
    const card = e.target.closest("[data-post-id]");
    if (card) go(`article/${card.dataset.postId}`);
  });
  $("#home-recent").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const card = e.target.closest("[data-post-id]");
    if (card) go(`article/${card.dataset.postId}`);
  });
}
