import { $, UI_CONFIG, esc, safeAttr, fmtDate, readTime, excerpt, api, renderSkeleton, renderError, extractCover, stripCover, applyBgImages } from "./utils.js";
import { initHero } from "./hero.js";

let heroInitialized = false;

function renderHeadlineCard(p) {
  const cover = extractCover(p.body);
  const coverAttr = cover ? `data-bg="${safeAttr(cover.src)}"` : "";
  const body = cover ? stripCover(p.body) : p.body;
  const tags = (p.tags || []).slice(0, 3).map((t) => `<span class="tag tag-neutral">${esc(t)}</span>`).join(" ");
  const rt = readTime(p.body);

  return (
    `<a href="/posts/${encodeURIComponent(p._id)}" class="card-headline">` +
      `<div class="card-headline-cover${cover ? "" : " card-headline-cover--empty"}" ${coverAttr}>` +
        `<div class="card-headline-overlay">` +
          `<div class="card-headline-meta"><span>${esc(p.author || "Anonymous")}</span><span class="dot"></span><span>${fmtDate(p.created_at)}</span><span class="dot"></span><span>${rt}</span></div>` +
          `<h2 class="card-headline-title">${esc(p.title)}</h2>` +
          `<p class="card-headline-excerpt">${esc(excerpt(body, 180))}</p>` +
          (tags ? `<div class="card-headline-tags">${tags}</div>` : "") +
        `</div>` +
      `</div>` +
    `</a>`
  );
}

function renderSecondaryCard(p) {
  const cover = extractCover(p.body);
  const body = cover ? stripCover(p.body) : p.body;
  const rt = readTime(p.body);

  return (
    `<a href="/posts/${encodeURIComponent(p._id)}" class="card-secondary">` +
      (cover ? `<div class="card-secondary-cover" data-bg="${safeAttr(cover.src)}"></div>` : "") +
      `<div class="card-secondary-content">` +
        `<div class="meta"><span>${fmtDate(p.created_at)}</span><span class="dot"></span><span>${rt}</span></div>` +
        `<h3>${esc(p.title)}</h3>` +
        `<p class="excerpt">${esc(excerpt(body, 100))}</p>` +
      `</div>` +
    `</a>`
  );
}

function renderCompactCard(p) {
  return (
    `<a href="/posts/${encodeURIComponent(p._id)}" class="card-compact">` +
      `<h4>${esc(p.title)}</h4>` +
      `<div class="meta"><span>${fmtDate(p.created_at)}</span><span class="dot"></span><span>${readTime(p.body)}</span></div>` +
    `</a>`
  );
}

export async function loadHome(ssrPosts) {
  if (!heroInitialized) {
    initHero();
    heroInitialized = true;
  }

  const container = $("#home-recent");

  let posts;
  if (ssrPosts) {
    posts = Array.isArray(ssrPosts) ? ssrPosts : (ssrPosts?.data || []);
  } else {
    container.innerHTML = renderSkeleton(3);
    const r = await api("listPosts", { params: { limit: "200" } });
    if (r.networkError) {
      container.innerHTML = renderError("Could not reach the server. Is the API running?", loadHome);
      return;
    }
    posts = r.data?.data || [];
  }
  if (!posts.length) {
    container.innerHTML = `<div class="feed-empty"><p>${esc(UI_CONFIG.labels.noPostsYet)}</p></div>`;
    return;
  }

  const headline = posts[0];
  const secondaries = posts.slice(1, 3);
  const compacts = posts.slice(3);

  let html = "";

  html += `<section class="home-section home-section--headline">${renderHeadlineCard(headline)}</section>`;

  if (secondaries.length) {
    html += `<section class="home-section"><h3 class="home-section-label">More Stories</h3><div class="home-secondary-grid">${secondaries.map(renderSecondaryCard).join("")}</div></section>`;
  }

  if (compacts.length) {
    html += `<section class="home-section"><h3 class="home-section-label">Latest</h3><div class="home-compact-grid">${compacts.map(renderCompactCard).join("")}</div></section>`;
  }

  html += `<div class="home-browse"><a href="#blog" class="btn btn-outline">Browse all posts &rarr;</a></div>`;

  container.innerHTML = html;
  applyBgImages(container);
}

export function bindHomeEvents() {
}
