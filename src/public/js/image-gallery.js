/**
 * Image Gallery System
 *
 * Every inline image becomes a numbered <figure> with caption.
 * Authors reference figures with #fig-N links or plain-text mentions.
 * A compact image-index strip sits at the end of the article.
 * The lightbox is the gallery — full-screen, keyboard-navigable,
 * with a thumbnail rail for quick jumping.
 *
 * Public API:
 *   enhanceArticleImages(articleEl)
 */

/* ── State ──────────────────────────────────────────── */

let _lightbox = null;
let _figures = [];  // [{ src, alt, figNum:number|null, isCover:bool }]
let _lbIdx = 0;

/* ── Helpers ────────────────────────────────────────── */

function esc(text) {
  const d = document.createElement("div");
  d.textContent = text;
  return d.innerHTML;
}

const IMG_ICON = `<svg class="fig-ref-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>`;

/* ── Public Entry Point ─────────────────────────────── */

export function enhanceArticleImages(articleEl) {
  const prose = articleEl.querySelector(".prose");
  if (!prose) return;

  _figures = [];

  const coverImg = articleEl.querySelector(".article-cover img");
  if (coverImg) {
    _figures.push({ src: coverImg.src, alt: coverImg.alt || "", figNum: null, isCover: true });
    coverImg.style.cursor = "zoom-in";
    coverImg.addEventListener("click", () => openLightbox(0));
  }

  const imgs = [...prose.querySelectorAll("img")];
  imgs.forEach((img, i) => {
    const figNum = i + 1;
    _figures.push({ src: img.src, alt: img.alt || "", figNum, isCover: false });
    wrapFigure(img, figNum);
  });

  if (_figures.length === 0) return;

  linkFigureRefs(prose);
  if (_figures.length >= 2) injectImageIndex(articleEl);
  initLightbox();
}

/* ── Figure Wrapping ────────────────────────────────── */

function wrapFigure(img, figNum) {
  const figure = document.createElement("figure");
  figure.className = "article-figure";
  figure.id = `fig-${figNum}`;

  const frame = document.createElement("div");
  frame.className = "figure-frame";

  const clone = img.cloneNode(true);
  clone.className = "figure-img";
  clone.removeAttribute("loading");
  frame.appendChild(clone);

  const hint = document.createElement("span");
  hint.className = "figure-expand";
  hint.innerHTML =
    `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">` +
    `<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>`;
  frame.appendChild(hint);

  figure.appendChild(frame);

  const cap = document.createElement("figcaption");
  cap.className = "figure-caption";
  cap.innerHTML =
    `<span class="figure-num">Fig ${figNum}</span>` +
    (img.alt ? `<span class="figure-text"> — ${esc(img.alt)}</span>` : "");
  figure.appendChild(cap);

  const p = img.parentElement;
  if (p?.tagName === "P" && p.childNodes.length === 1) {
    p.replaceWith(figure);
  } else {
    img.replaceWith(figure);
  }

  frame.addEventListener("click", () => {
    const idx = _figures.findIndex((f) => f.figNum === figNum);
    openLightbox(idx >= 0 ? idx : 0);
  });
}

/* ── Figure References ──────────────────────────────── */

const FIG_LINK_RE = /^#fig-(\d+)$/;
const FIG_TEXT_RE = /#fig-(\d+)/gi;

function linkFigureRefs(prose) {
  prose.querySelectorAll('a[href^="#fig-"]').forEach((a) => {
    const m = a.getAttribute("href").match(FIG_LINK_RE);
    if (!m) return;
    const n = parseInt(m[1]);
    const fig = _figures.find((f) => f.figNum === n);
    if (!fig) return;

    a.classList.add("fig-ref");
    a.dataset.fig = n;
    if (!a.querySelector(".fig-ref-icon")) {
      a.innerHTML = IMG_ICON + ` <span>Figure ${n}</span>`;
    }
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const idx = _figures.indexOf(fig);
      openLightbox(idx >= 0 ? idx : 0);
    });
  });

  const walker = document.createTreeWalker(prose, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let node;
  while ((node = walker.nextNode())) {
    if (FIG_TEXT_RE.test(node.textContent)) nodes.push(node);
    FIG_TEXT_RE.lastIndex = 0;
  }

  nodes.forEach((textNode) => {
    if (textNode.parentElement?.closest(".fig-ref, a")) return;
    const frag = document.createDocumentFragment();
    const parts = textNode.textContent.split(/(#fig-\d+)/gi);
    parts.forEach((part) => {
      const m2 = part.match(/^#fig-(\d+)$/i);
      if (m2) {
        const n = parseInt(m2[1]);
        const fig = _figures.find((f) => f.figNum === n);
        if (fig) {
          const a = document.createElement("a");
          a.href = `#fig-${n}`;
          a.className = "fig-ref";
          a.dataset.fig = n;
          a.innerHTML = IMG_ICON + ` <span>Figure ${n}</span>`;
          a.addEventListener("click", (e) => {
            e.preventDefault();
            const idx = _figures.indexOf(fig);
            openLightbox(idx >= 0 ? idx : 0);
          });
          frag.appendChild(a);
        } else {
          frag.appendChild(document.createTextNode(part));
        }
      } else if (part) {
        frag.appendChild(document.createTextNode(part));
      }
    });
    textNode.replaceWith(frag);
  });
}

/* ── Image Index (compact strip at end of article) ─── */

function injectImageIndex(articleEl) {
  const section = document.createElement("section");
  section.className = "image-index";
  section.setAttribute("aria-label", "Image index");

  const count = _figures.length;
  const label = count === 1 ? "1 image" : `${count} images`;

  let html =
    `<div class="ii-header">` +
    `<svg class="ii-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>` +
    `<span class="ii-count">${label} in this article</span>` +
    `</div>` +
    `<div class="ii-strip">`;

  _figures.forEach((fig, idx) => {
    const tag = fig.isCover ? "Cover" : `Fig ${fig.figNum}`;
    const altAttr = esc(tag + (fig.alt ? ": " + fig.alt : ""));
    html +=
      `<button class="ii-thumb" data-idx="${idx}" aria-label="${altAttr}">` +
      `<img src="${fig.src}" alt="" draggable="false" />` +
      `<span class="ii-tag">${tag}</span>` +
      (fig.alt ? `<span class="ii-alt">${esc(fig.alt)}</span>` : "") +
      `</button>`;
  });

  html += `</div>`;
  section.innerHTML = html;

  section.querySelectorAll(".ii-thumb").forEach((btn) => {
    btn.addEventListener("click", () => openLightbox(parseInt(btn.dataset.idx)));
  });

  const prose = articleEl.querySelector(".prose");
  if (prose) prose.after(section);
  else articleEl.appendChild(section);
}

/* ── Lightbox ───────────────────────────────────────── */

function initLightbox() {
  if (_lightbox) return;

  _lightbox = document.createElement("div");
  _lightbox.className = "image-lightbox";
  _lightbox.innerHTML = `
    <div class="lightbox-backdrop"></div>
    <div class="lightbox-content">
      <button class="lightbox-close" aria-label="Close lightbox">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
      <div class="lightbox-counter"></div>
      <button class="lightbox-nav lightbox-nav-prev" aria-label="Previous image">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M15 18l-6-6 6-6"/>
        </svg>
      </button>
      <button class="lightbox-nav lightbox-nav-next" aria-label="Next image">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M9 18l6-6-6-6"/>
        </svg>
      </button>
      <div class="lightbox-stage">
        <img class="lightbox-img" src="" alt="" />
        <div class="lightbox-info">
          <span class="lightbox-fig-label"></span>
          <span class="lightbox-divider">—</span>
          <span class="lightbox-caption"></span>
        </div>
      </div>
      <div class="lightbox-thumbs"></div>
    </div>
  `;
  document.body.appendChild(_lightbox);

  const close = () => {
    _lightbox.classList.remove("active");
    document.body.style.overflow = "";
  };

  _lightbox.querySelector(".lightbox-backdrop").addEventListener("click", close);
  _lightbox.querySelector(".lightbox-close").addEventListener("click", close);
  _lightbox.querySelector(".lightbox-nav-prev").addEventListener("click", () => navigateLB(-1));
  _lightbox.querySelector(".lightbox-nav-next").addEventListener("click", () => navigateLB(1));
  _lightbox.querySelector(".lightbox-img").addEventListener("click", (e) => e.stopPropagation());

  document.addEventListener("keydown", (e) => {
    if (!_lightbox.classList.contains("active")) return;
    if (e.key === "Escape") close();
    if (e.key === "ArrowLeft") navigateLB(-1);
    if (e.key === "ArrowRight") navigateLB(1);
  });

  let touchX = 0;
  const stage = _lightbox.querySelector(".lightbox-stage");
  stage.addEventListener("touchstart", (e) => { touchX = e.touches[0].clientX; }, { passive: true });
  stage.addEventListener("touchend", (e) => {
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 50) navigateLB(dx < 0 ? 1 : -1);
  });
}

function openLightbox(idx) {
  initLightbox();
  if (_figures.length === 0) return;
  _lbIdx = Math.max(0, Math.min(idx, _figures.length - 1));

  buildLBThumbs();
  showLBImage(true);

  _lightbox.classList.add("active");
  document.body.style.overflow = "hidden";
}

function navigateLB(dir) {
  if (_figures.length <= 1) return;
  _lbIdx += dir;
  if (_lbIdx < 0) _lbIdx = _figures.length - 1;
  if (_lbIdx >= _figures.length) _lbIdx = 0;
  showLBImage(false);
}

function showLBImage(instant) {
  const fig = _figures[_lbIdx];
  if (!fig) return;

  const img = _lightbox.querySelector(".lightbox-img");
  const figLabel = _lightbox.querySelector(".lightbox-fig-label");
  const caption = _lightbox.querySelector(".lightbox-caption");
  const counter = _lightbox.querySelector(".lightbox-counter");
  const prevBtn = _lightbox.querySelector(".lightbox-nav-prev");
  const nextBtn = _lightbox.querySelector(".lightbox-nav-next");

  const divider = _lightbox.querySelector(".lightbox-divider");
  const infoEl = _lightbox.querySelector(".lightbox-info");
  const stage = _lightbox.querySelector(".lightbox-stage");

  const apply = () => {
    img.src = fig.src;
    img.alt = fig.alt;

    const label = fig.isCover ? "Cover Image" : (fig.figNum ? `Figure ${fig.figNum}` : "");
    figLabel.textContent = label;
    caption.textContent = fig.alt || "";
    divider.style.display = (label && fig.alt) ? "" : "none";

    const hasInfo = !!(label || fig.alt);
    infoEl.style.display = hasInfo ? "" : "none";
    stage.classList.toggle("no-caption", !hasInfo);

    img.style.opacity = "";
    img.style.transform = "";
  };

  if (instant) {
    apply();
  } else {
    img.style.opacity = "0";
    img.style.transform = "scale(0.97)";
    setTimeout(apply, 100);
  }

  const multi = _figures.length > 1;
  counter.textContent = multi ? `${_lbIdx + 1} / ${_figures.length}` : "";
  counter.style.display = multi ? "" : "none";
  prevBtn.style.display = multi ? "" : "none";
  nextBtn.style.display = multi ? "" : "none";

  _lightbox.querySelectorAll(".lb-thumb").forEach((t, i) => {
    t.classList.toggle("active", i === _lbIdx);
    if (i === _lbIdx) t.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  });
}

function buildLBThumbs() {
  const container = _lightbox.querySelector(".lightbox-thumbs");
  if (_figures.length < 2) { container.innerHTML = ""; return; }

  container.innerHTML = _figures
    .map(
      (fig, i) =>
        `<button class="lb-thumb${i === _lbIdx ? " active" : ""}" data-idx="${i}">` +
        `<img src="${fig.src}" alt="" draggable="false" />` +
        `</button>`
    )
    .join("");

  container.querySelectorAll(".lb-thumb").forEach((btn) => {
    btn.addEventListener("click", () => {
      _lbIdx = parseInt(btn.dataset.idx);
      showLBImage(false);
    });
  });
}
