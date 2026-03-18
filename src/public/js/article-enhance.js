import { shareUrl, esc, safeAttr } from "./utils.js";
import { enhanceImagesWithGallery, markStandaloneImagesZoomable } from "./image-gallery.js";

let _progressBar = null;
let _scrollHandler = null;
let _selToolbar = null;
let _selMousedownBound = false;
let _observers = [];

export function enhanceArticle(postId) {
  const prose = document.querySelector("#article-content .prose");
  if (!prose) return;

  initProgressBar(prose);
  injectTOC(prose);
  injectHeadingAnchors(prose, postId);
  injectCodeCopyButtons(prose);
  injectReferences(prose);
  initScrollReveal(prose);
  enhanceImagesWithGallery(prose);
  markStandaloneImagesZoomable(prose);
  initSelectionShare(prose, postId);
}

export function cleanupArticleEnhancements() {
  if (_scrollHandler) {
    window.removeEventListener("scroll", _scrollHandler);
    _scrollHandler = null;
  }
  if (_progressBar) {
    _progressBar.remove();
    _progressBar = null;
  }
  _observers.forEach((o) => o.disconnect());
  _observers = [];
}

/* ---- Reading Progress Bar ---- */

function initProgressBar(prose) {
  cleanupArticleEnhancements();
  _progressBar = document.createElement("div");
  _progressBar.className = "reading-progress";
  document.body.prepend(_progressBar);

  _scrollHandler = () => {
    const rect = prose.getBoundingClientRect();
    const scrollable = rect.height - window.innerHeight;
    if (scrollable <= 0) {
      _progressBar.style.transform = "scaleX(1)";
      return;
    }
    const progress = Math.min(1, Math.max(0, -rect.top / scrollable));
    _progressBar.style.transform = `scaleX(${progress})`;
  };
  window.addEventListener("scroll", _scrollHandler, { passive: true });
  _scrollHandler();
}

/* ---- Table of Contents ---- */

function injectTOC(prose) {
  const headings = prose.querySelectorAll("h1, h2, h3");
  if (headings.length < 3) return;

  const items = [...headings].map((h, i) => {
    const id = `s-${i}`;
    h.id = id;
    const depth = h.tagName === "H3" ? " toc-sub" : "";
    return `<li class="${depth}"><a href="#${id}">${esc(h.textContent)}</a></li>`;
  });

  const toc = document.createElement("nav");
  toc.className = "toc";
  toc.innerHTML =
    `<button class="toc-toggle" aria-expanded="true">` +
    `<span class="toc-label">In this article</span>` +
    `<svg class="toc-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6l4 4 4-4"/></svg>` +
    `</button>` +
    `<ol class="toc-list">${items.join("")}</ol>`;
  prose.parentElement.insertBefore(toc, prose);

  const toggle = toc.querySelector(".toc-toggle");
  toggle.addEventListener("click", () => {
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!expanded));
    toc.querySelector(".toc-list").classList.toggle("collapsed", expanded);
    toc.querySelector(".toc-chevron").classList.toggle("rotated", expanded);
  });

  const tocLinks = toc.querySelectorAll("a");
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          tocLinks.forEach((a) => a.classList.remove("active"));
          const active = toc.querySelector(`a[href="#${e.target.id}"]`);
          if (active) active.classList.add("active");
        }
      });
    },
    { rootMargin: "-20% 0px -60% 0px" }
  );
  headings.forEach((h) => observer.observe(h));
  _observers.push(observer);

  toc.addEventListener("click", (e) => {
    const a = e.target.closest("a");
    if (!a) return;
    e.preventDefault();
    const target = document.getElementById(a.getAttribute("href").slice(1));
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

/* ---- Heading Anchor Links ---- */

function injectHeadingAnchors(prose, postId) {
  prose.querySelectorAll("h1[id], h2[id], h3[id]").forEach((h) => {
    const anchor = document.createElement("a");
    anchor.className = "heading-anchor";
    anchor.href = `#${h.id}`;
    anchor.setAttribute("aria-label", "Link to section");
    anchor.innerHTML =
      `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">` +
      `<path d="M6.5 8.5a3 3 0 004.243 0l2-2a3 3 0 00-4.243-4.243l-1 1"/>` +
      `<path d="M9.5 7.5a3 3 0 00-4.243 0l-2 2a3 3 0 004.243 4.243l1-1"/></svg>`;
    h.classList.add("has-anchor");
    h.appendChild(anchor);
    anchor.addEventListener("click", (e) => {
      e.preventDefault();
      h.scrollIntoView({ behavior: "smooth", block: "start" });
      const url = shareUrl(postId) + `#${h.id}`;
      navigator.clipboard?.writeText(url).catch(() => {});
    });
  });
}

/* ---- Code Block Copy Buttons ---- */

function injectCodeCopyButtons(prose) {
  prose.querySelectorAll("pre").forEach((pre) => {
    pre.classList.add("has-copy");
    const btn = document.createElement("button");
    btn.className = "code-copy";
    btn.textContent = "Copy";
    btn.addEventListener("click", () => {
      navigator.clipboard.writeText(pre.textContent.replace(/Copy$/, "").trim()).then(() => {
        btn.textContent = "Copied!";
        btn.classList.add("copied");
        setTimeout(() => {
          btn.textContent = "Copy";
          btn.classList.remove("copied");
        }, 1500);
      });
    });
    pre.appendChild(btn);
  });
}

/* ---- Auto-Extracted References Panel ---- */

function injectReferences(prose) {
  const seen = new Set();
  const links = [];
  prose.querySelectorAll('a[href^="http"]').forEach((a) => {
    const href = a.href;
    if (seen.has(href)) return;
    seen.add(href);
    try {
      const url = new URL(href);
      links.push({
        href,
        text: a.textContent.trim() || url.hostname,
        domain: url.hostname.replace(/^www\./, ""),
      });
    } catch {
      /* skip malformed URLs */
    }
  });
  if (!links.length) return;

  const section = document.createElement("div");
  section.className = "references";
  section.innerHTML =
    `<h3>References &amp; Links</h3>` +
    `<ul>${links
      .map(
        (l) =>
          `<li>` +
          `<a href="${safeAttr(l.href)}" target="_blank" rel="noopener noreferrer">` +
          `<svg class="ref-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">` +
          `<path d="M6.5 8.5a3 3 0 004.243 0l2-2a3 3 0 00-4.243-4.243l-1 1"/>` +
          `<path d="M9.5 7.5a3 3 0 00-4.243 0l-2 2a3 3 0 004.243 4.243l1-1"/></svg>` +
          `<span class="ref-text">${esc(l.text)}</span>` +
          `<span class="ref-domain">${esc(l.domain)}</span>` +
          `</a></li>`
      )
      .join("")}</ul>`;

  section.querySelectorAll("li").forEach((li, i) => {
    li.style.animationDelay = `${i * 50}ms`;
  });
  prose.after(section);
}

/* ---- Scroll-Reveal Animations ---- */

function initScrollReveal(prose) {
  const targets = prose.querySelectorAll(
    "p, blockquote, pre, img, ul, ol, table"
  );
  targets.forEach((el) => el.classList.add("reveal"));

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("revealed");
          io.unobserve(e.target);
        }
      });
    },
    { threshold: 0.08, rootMargin: "0px 0px -30px 0px" }
  );
  targets.forEach((el) => io.observe(el));
  _observers.push(io);

  const refs = prose.parentElement.querySelector(".references");
  if (refs) {
    refs.classList.add("reveal");
    io.observe(refs);
  }
}

/* ---- Image Lightbox (replaced by image-gallery.js) ---- */

/* ---- Text Selection Share Toolbar ---- */

function initSelectionShare(prose, postId) {
  if (!_selToolbar) {
    _selToolbar = document.createElement("div");
    _selToolbar.className = "sel-toolbar";
    _selToolbar.innerHTML =
      `<button data-sel-action="tweet" title="Tweet this">` +
      `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>` +
      `</button>` +
      `<button data-sel-action="copy" title="Copy quote">` +
      `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">` +
      `<rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M5 11H3.5A1.5 1.5 0 012 9.5v-7A1.5 1.5 0 013.5 1h7A1.5 1.5 0 0112 2.5V5"/></svg>` +
      `</button>`;
    document.body.appendChild(_selToolbar);

    _selToolbar.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-sel-action]");
      if (!btn) return;
      const text = _selToolbar.dataset.text;
      if (!text) return;

      if (btn.dataset.selAction === "tweet") {
        const url = shareUrl(_selToolbar.dataset.postId);
        window.open(
          `https://x.com/intent/tweet?text=${encodeURIComponent(`\u201c${text}\u201d\n\n`)}${encodeURIComponent(url)}`,
          "_blank"
        );
      } else if (btn.dataset.selAction === "copy") {
        navigator.clipboard.writeText(text).catch(() => {});
        btn.innerHTML =
          `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="var(--success)" stroke-width="2"><path d="M3 8.5l3 3 7-7"/></svg>`;
        setTimeout(() => {
          btn.innerHTML =
            `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">` +
            `<rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M5 11H3.5A1.5 1.5 0 012 9.5v-7A1.5 1.5 0 013.5 1h7A1.5 1.5 0 0112 2.5V5"/></svg>`;
        }, 1500);
      }
      _selToolbar.classList.remove("visible");
    });
  }

  _selToolbar.dataset.postId = postId;

  prose.addEventListener("mouseup", () => {
    setTimeout(() => {
      const sel = window.getSelection();
      const text = sel?.toString().trim();
      if (!text || text.length < 15) {
        _selToolbar.classList.remove("visible");
        return;
      }
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      _selToolbar.style.top = `${rect.top + window.scrollY - 44}px`;
      _selToolbar.style.left = `${rect.left + rect.width / 2}px`;
      _selToolbar.dataset.text = text.slice(0, 280);
      _selToolbar.classList.add("visible");
    }, 10);
  });

  if (!_selMousedownBound) {
    _selMousedownBound = true;
    document.addEventListener("mousedown", (e) => {
      if (!e.target.closest(".sel-toolbar")) {
        _selToolbar?.classList.remove("visible");
      }
    });
  }
}
