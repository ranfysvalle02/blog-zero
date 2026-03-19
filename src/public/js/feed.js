import { $, UI_CONFIG, state, setState, esc, safeAttr, fmtDate, readTime, excerpt, md, toast, api, isAuthed, go, renderShareBar, extractCover, stripCover, applyBgImages } from "./utils.js";
import { showAuthPanel } from "./auth.js";
import { enhanceArticle } from "./article-enhance.js";

export function renderCard(p, extraClass = "") {
  const tags = UI_CONFIG.features.tags ? (p.tags || []).map((t) => `<span>${esc(t)}</span>`).join("") : "";
  const cc = (typeof p.comment_count === "number" && UI_CONFIG.features.comments)
    ? `<span class="dot"></span><span>${p.comment_count} comment${p.comment_count === 1 ? "" : "s"}</span>`
    : "";
  const author = UI_CONFIG.layout.showAuthorInCard ? `<span>${esc(p.author || "Anonymous")}</span><span class="dot"></span>` : "";
  const rt = UI_CONFIG.features.readTime ? `<span class="dot"></span><span>${readTime(p.body)}</span>` : "";

  const imageCount = (p.body.match(/!\[([^\]]*)\]\(([^)]+)\)/g) || []).length;
  const imageIndicator = imageCount > 0
    ? `<span class="dot"></span><span class="card-image-count"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg> ${imageCount}</span>`
    : "";

  const cover = extractCover(p.body);
  const coverHtml = cover
    ? `<div class="card-cover" data-bg="${safeAttr(cover.src)}"></div>`
    : "";
  const bodyExcerpt = cover ? excerpt(stripCover(p.body)) : excerpt(p.body);

  return (
    `<div class="card ${cover ? "card-has-cover" : ""} ${esc(extraClass)}" role="article" tabindex="0" data-post-id="${safeAttr(p._id)}">` +
    coverHtml +
    `<div class="card-body">` +
    `<div class="meta">${author}<span>${fmtDate(p.created_at)}</span>${rt}${cc}${imageIndicator}</div>` +
    `<h2>${esc(p.title)}</h2>` +
    `<div class="excerpt">${esc(bodyExcerpt)}</div>` +
    (tags ? `<div class="tags">${tags}</div>` : "") +
    `</div>` +
    "</div>"
  );
}

export async function handleArticleRoute(id) {
  if (!id) { go("home"); return; }
  setState("currentPostId", id);
  const contentEl = $("#article-content");
  if (!contentEl) return;
  contentEl.innerHTML = '<span class="loading-text">Loading...</span>';
  const r = await api("getPost", { pathParams: { id } });
  const p = r.data?.data;
  if (!p) {
    contentEl.innerHTML = `<a href="#blog" class="back">\u2190 ${esc(UI_CONFIG.labels.backToPosts)}</a><p>${esc(UI_CONFIG.labels.postNotFound)}</p>`;
    return;
  }

  const tags = UI_CONFIG.features.tags
    ? (p.tags || []).map((t) => `<span class="tag tag-neutral">${esc(t)}</span>`).join(" ")
    : "";
  const rt = UI_CONFIG.features.readTime ? `<span class="dot"></span><span>${readTime(p.body)}</span>` : "";
  let commentSection = "";
  if (UI_CONFIG.features.comments) {
    const composer = !isAuthed()
      ? `<div class="notice">${esc(UI_CONFIG.labels.signInToComment)} <a href="#" data-action="show-register">${esc(UI_CONFIG.labels.register)}</a> \u00b7 <a href="#" data-action="show-login">${esc(UI_CONFIG.labels.signIn)}</a></div>`
      : `<div class="comment-composer"><textarea id="comment-body" placeholder="${safeAttr(UI_CONFIG.labels.commentPrompt)}"></textarea><div><button class="btn btn-primary btn-sm" data-action="post-comment">${esc(UI_CONFIG.labels.postComment)}</button></div></div><div class="notice">${esc(UI_CONFIG.labels.commentPending)} <a href="/public/community.html" target="_blank">Read guidelines</a></div>`;
    commentSection = `<div class="comments"><h3>${esc(UI_CONFIG.labels.commentsTitle)}</h3>${composer}<div id="comment-list"><span class="loading-text">Loading comments...</span></div></div>`;
  }

  const cover = extractCover(p.body || "");
  const coverBanner = cover
    ? `<div class="article-cover"><img src="${safeAttr(cover.src)}" alt="${esc(cover.alt || p.title)}" /></div>`
    : "";
  const proseBody = cover ? stripCover(p.body || "") : (p.body || "");

  contentEl.innerHTML =
    `<a href="#blog" class="back">\u2190 ${esc(UI_CONFIG.labels.backToPosts)}</a>` +
    coverBanner +
    "<header>" +
    `<h1 tabindex="-1">${esc(p.title)}</h1>` +
    `<div class="meta"><span>${esc(p.author || "Anonymous")}</span><span class="dot"></span><span>${fmtDate(p.created_at)}</span>${rt}${tags ? ` \u00a0 ${tags}` : ""}</div>` +
    "</header>" +
    renderShareBar(id, p.title) +
    `<div class="prose">${md(proseBody)}</div>` +
    commentSection;

  applyBgImages(contentEl);
  enhanceArticle(id);
  if (UI_CONFIG.features.comments) loadComments(id);
  return p;
}

async function loadComments(postId) {
  const r = await api("listComments", { params: { filter: `post_id:${postId}`, scope: "approved", sort: "-created_at", limit: "100" } });
  const cmts = r.data?.data || [];
  const el = $("#comment-list");
  if (!el) return;
  if (!cmts.length) {
    el.innerHTML = `<p class="loading-text">${esc(UI_CONFIG.labels.noComments)}</p>`;
    return;
  }
  el.innerHTML = cmts.map((c) =>
    `<div class="cmt"><div class="cmt-meta"><strong>${esc(c.author || "Anonymous")}</strong><span>${fmtDate(c.created_at)}</span></div><div class="cmt-body">${esc(c.body)}</div></div>`
  ).join("");
}

async function postComment() {
  if (!isAuthed()) { showAuthPanel("login"); return; }
  const bodyEl = $("#comment-body");
  const body = bodyEl?.value.trim();
  if (!body) { toast("Write something first", "err"); return; }
  const r = await api("createComment", { body: { post_id: state.currentPostId, body } });
  if (!r.ok) { toast(r.data?.detail || "Could not submit comment", "err"); return; }
  bodyEl.value = "";
  toast(r.data?.data?.approved ? "Comment posted and visible" : "Comment submitted for approval", "info");
  loadComments(state.currentPostId);
}

export function bindArticleEvents() {
  const el = $("#article-content");
  if (!el) return;
  el.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    e.preventDefault();
    if (btn.dataset.action === "post-comment") postComment();
    if (btn.dataset.action === "show-login") showAuthPanel("login");
    if (btn.dataset.action === "show-register") showAuthPanel("register");
    if (btn.dataset.action === "copy-link") {
      navigator.clipboard.writeText(btn.dataset.url).then(
        () => toast("Link copied!"),
        () => toast("Could not copy link", "err")
      );
    }
    if (btn.dataset.action === "native-share") {
      navigator.share({ title: btn.dataset.title, url: btn.dataset.url }).catch(() => {});
    }
  });
}
