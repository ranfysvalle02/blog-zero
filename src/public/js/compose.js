import { $, UI_CONFIG, state, esc, md, toast, api, isAdmin, go, readTime, showConfirm } from "./utils.js";
import { processImage, extractImageFiles } from "./image-util.js";

const AUTOSAVE_KEY = "blog-zero-draft";
const AUTOSAVE_IMGS_KEY = "blog-zero-draft-imgs";
const AUTOSAVE_COVER_KEY = "blog-zero-draft-cover";
const AUTOSAVE_DELAY = 2000;
const MAX_INLINE_IMAGES = 4;
const WARN_INLINE = 3;
const DEFAULT_TAGS = ["Technology", "Design", "Life", "Tutorial", "Opinion", "News", "Engineering", "Product"];
const IMG_TOKEN_RE = /!\[([^\]]*)\]\(img:(\d+)\)/g;
const DATA_URI_IMG_RE = /!\[([^\]]*)\]\((data:image\/[^)]+)\)/g;
const FIRST_IMG_RE = /^!\[([^\]]*)\]\(([^)]+)\)/;

let _autosaveTimer = null;
let _previewTimer = null;
let _currentMode = "write";
let _selectedTags = new Set();
let _popularTags = [];

let _coverImageId = null;
let _coverAlt = "";
let _replacingCover = false;

/* ================================================================
   Image Store — tokens in the textarea, data in memory
   ================================================================
   The textarea shows:    ![photo](img:1)
   The actual data URI lives in _imageStore.
   On preview/submit, tokens are resolved back to data URIs.
   ================================================================ */

const _imageStore = new Map();
let _imgCounter = 0;

function storeImage(dataUri) {
  const id = ++_imgCounter;
  _imageStore.set(id, dataUri);
  return id;
}

function resolveTokens(body) {
  return body.replace(IMG_TOKEN_RE, (full, alt, id) => {
    const data = _imageStore.get(Number(id));
    return data ? `![${alt}](${data})` : full;
  });
}

function tokenizeDataUris(body) {
  return body.replace(DATA_URI_IMG_RE, (full, alt, dataUri) => {
    const id = storeImage(dataUri);
    return `![${alt}](img:${id})`;
  });
}

function getResolvedBody() {
  let body = resolveTokens($("#compose-body").value.trim());
  if (_coverImageId) {
    const src = _imageStore.get(_coverImageId);
    if (src) body = `![${_coverAlt}](${src})\n\n${body}`;
  }
  return body;
}

function resetImageStore() {
  _imageStore.clear();
  _imgCounter = 0;
  _coverImageId = null;
  _coverAlt = "";
}

function setCoverFromInline(imgIndex) {
  const ta = $("#compose-body");
  const images = parseImageTokens(ta.value);
  if (imgIndex < 0 || imgIndex >= images.length) return;
  const img = images[imgIndex];

  const stripped = (ta.value.substring(0, img.index) + ta.value.substring(img.index + img.markdown.length))
    .replace(/\n{3,}/g, "\n\n").trim();

  if (_coverImageId && _imageStore.has(_coverImageId)) {
    const oldToken = `![${_coverAlt}](img:${_coverImageId})`;
    ta.value = stripped ? stripped + "\n\n" + oldToken : oldToken;
  } else {
    ta.value = stripped;
  }

  _coverImageId = img.id;
  _coverAlt = img.alt;
  onBodyInput();
}

function removeCover() {
  if (!_coverImageId) return;
  const ta = $("#compose-body");
  const token = `![${_coverAlt}](img:${_coverImageId})`;
  const body = ta.value.trim();
  ta.value = body ? token + "\n\n" + body : token;
  _coverImageId = null;
  _coverAlt = "";
  onBodyInput();
}

function setCoverDirect(dataUri, alt) {
  if (_coverImageId) {
    const ta = $("#compose-body");
    const token = `![${_coverAlt}](img:${_coverImageId})`;
    const body = ta.value.trim();
    ta.value = body ? token + "\n\n" + body : token;
  }
  const id = storeImage(dataUri);
  _coverImageId = id;
  _coverAlt = alt || "Cover";
  onBodyInput();
}

function parseImageTokens(body) {
  const images = [];
  let m;
  const re = new RegExp(IMG_TOKEN_RE.source, "g");
  while ((m = re.exec(body)) !== null) {
    images.push({ alt: m[1], id: Number(m[2]), markdown: m[0], index: m.index });
  }
  return images;
}

/* ================================================================
   Route handler
   ================================================================ */

export function handleComposeRoute(editId) {
  initAuthor();
  loadPopularTags();

  if (editId) {
    clearAutoSave();
    const cached = state.postCache.get(editId);
    if (cached) { populateForm(cached); return; }
    api("getPost", { pathParams: { id: editId } }).then((r) => {
      if (r.data?.data) populateForm(r.data.data);
      else { toast("Post not found", "err"); go("feed"); }
    });
    return;
  }

  const saved = loadAutoSave();
  if (saved && (saved.title || saved.body)) {
    populateFromObj(saved);
    setSaveStatus("Draft recovered");
  } else {
    clearForm();
  }
  autoGrow();
  setTimeout(() => { const t = $("#compose-post-title"); if (t) t.focus(); }, 100);
}

/* ================================================================
   Author auto-fill from session
   ================================================================ */

function initAuthor() {
  const input = $("#compose-author");
  if (!input) return;
  if (input.value) return;
  const user = state.session?.user;
  if (user) input.value = user.name || user.email?.split("@")[0] || "";
}

/* ================================================================
   Tag picker
   ================================================================ */

async function loadPopularTags() {
  try {
    const res = await api("tagStats");
    if (res.ok) {
      const fromApi = (res.data?.data || res.data || [])
        .filter((t) => t._id)
        .sort((a, b) => b.count - a.count)
        .slice(0, 12)
        .map((t) => t._id);
      _popularTags = [...new Set([...fromApi, ...DEFAULT_TAGS])].slice(0, 14);
    } else {
      _popularTags = [...DEFAULT_TAGS];
    }
  } catch {
    _popularTags = [...DEFAULT_TAGS];
  }
  renderTagPills();
}

function renderTagPills() {
  const container = $("#compose-tag-pills");
  if (!container) return;
  const allTags = [...new Set([..._popularTags, ..._selectedTags])];
  container.innerHTML = allTags.map((tag) => {
    const sel = _selectedTags.has(tag) ? " selected" : "";
    return `<button type="button" class="ev-tag${sel}" data-tag="${esc(tag)}">${esc(tag)}<span class="ev-tag-x">\u00d7</span></button>`;
  }).join("");
}

function toggleTag(tag) {
  _selectedTags.has(tag) ? _selectedTags.delete(tag) : _selectedTags.add(tag);
  renderTagPills();
  scheduleAutoSave();
}

function addCustomTag(raw) {
  const tag = raw.trim().replace(/,/g, "");
  if (!tag) return;
  _selectedTags.add(tag);
  renderTagPills();
  scheduleAutoSave();
}

function setTagsFromArray(tags) {
  _selectedTags = new Set(tags.filter(Boolean));
  renderTagPills();
}

function getTagsArray() { return [..._selectedTags]; }

/* ================================================================
   Form state
   ================================================================ */

function populateForm(post) {
  resetImageStore();
  $("#compose-post-title").value = post.title || "";
  $("#compose-author").value = post.author || "";
  setTagsFromArray(post.tags || []);

  let body = post.body || "";
  const coverMatch = body.match(FIRST_IMG_RE);
  if (coverMatch) {
    const src = coverMatch[2];
    _coverAlt = coverMatch[1];
    if (src.startsWith("data:")) {
      _coverImageId = storeImage(src);
    } else {
      _coverImageId = storeImage(src);
    }
    body = body.slice(coverMatch[0].length).replace(/^\s*\n/, "");
  }

  $("#compose-body").value = tokenizeDataUris(body);
  updatePreview();
  updateImageManager();
  $("#compose-edit-id").value = post._id;
  $("#compose-edit-hint").textContent = "Editing \u2022 " + (post.title || "untitled");
  autoGrow();
  updateStats();
}

function populateFromObj(obj) {
  $("#compose-post-title").value = obj.title || "";
  $("#compose-author").value = obj.author || "";
  if (obj.tags) {
    const tags = typeof obj.tags === "string"
      ? obj.tags.split(",").map((t) => t.trim()).filter(Boolean) : obj.tags;
    setTagsFromArray(tags);
  }
  restoreImageStore();
  restoreCover();
  const bodyRaw = obj.body || "";
  const hasDataUris = DATA_URI_IMG_RE.test(bodyRaw);
  DATA_URI_IMG_RE.lastIndex = 0;
  $("#compose-body").value = hasDataUris ? tokenizeDataUris(bodyRaw) : bodyRaw;

  $("#compose-edit-id").value = obj.editId || "";
  if (obj.editId) {
    $("#compose-edit-hint").textContent = "Editing \u2022 " + (obj.title || "untitled");
  }
  updatePreview();
  updateImageManager();
  autoGrow();
  updateStats();
}

function clearForm() {
  resetImageStore();
  togglePreview("write");
  $("#compose-post-title").value = "";
  initAuthor();
  _selectedTags.clear();
  renderTagPills();
  $("#compose-body").value = "";
  $("#compose-preview").innerHTML = '<span class="placeholder-text">Start writing to see a live preview...</span>';
  $("#compose-edit-id").value = "";
  $("#compose-edit-hint").textContent = "";
  setSaveStatus("");
  updateImageManager();
  autoGrow();
  updateStats();
}

function getFormData() {
  return {
    title: $("#compose-post-title").value,
    author: $("#compose-author").value,
    tags: getTagsArray(),
    body: $("#compose-body").value,
    editId: $("#compose-edit-id").value,
  };
}

/* ================================================================
   Submit — resolve tokens before sending
   ================================================================ */

async function submitPost(status) {
  if (!isAdmin()) { toast("Admin access required", "err"); return; }
  const title = $("#compose-post-title").value.trim();
  if (!title) { toast("Title is required", "err"); return; }

  const payload = { title, status };
  const author = $("#compose-author").value.trim();
  const body = getResolvedBody();
  const tags = getTagsArray();
  if (author) payload.author = author;
  if (body) payload.body = body;
  if (tags.length) payload.tags = tags;

  const editId = $("#compose-edit-id").value;
  const r = editId
    ? await api("updatePost", { pathParams: { id: editId }, body: payload })
    : await api("createPost", { body: payload });
  if (!r.ok) { toast(r.data?.detail || "Save failed", "err"); return; }

  toast(editId ? "Post updated" : status === "published" ? "Published!" : "Draft saved");
  clearAutoSave();
  clearForm();
  go("feed");
  window.dispatchEvent(new Event("feed:refresh"));
}

/* ================================================================
   Preview — resolve tokens before rendering
   ================================================================ */

function updatePreview() {
  const raw = $("#compose-body").value;
  const resolved = resolveTokens(raw);

  let coverHtml = "";
  if (_coverImageId) {
    const src = _imageStore.get(_coverImageId);
    if (src) {
      coverHtml = `<div class="preview-cover"><img src="${src}" alt="${esc(_coverAlt || "Cover")}" /><span class="preview-cover-badge">Cover</span></div>`;
    }
  }

  const proseHtml = resolved ? md(resolved) : "";
  $("#compose-preview").innerHTML = coverHtml + proseHtml ||
    '<span class="placeholder-text">Start writing to see a live preview...</span>';
  updateImageManager();
}

/* ================================================================
   Image Manager — reads tokens + store for thumbnails
   ================================================================ */

function updateImageManager() {
  const body = $("#compose-body").value;
  const inlineImages = parseImageTokens(body);
  const hasCover = _coverImageId && _imageStore.has(_coverImageId);
  const totalImages = inlineImages.length + (hasCover ? 1 : 0);

  const slot = $("#compose-image-manager-slot");
  if (!slot) return;

  if (totalImages === 0) {
    slot.innerHTML = `
      <div class="cim cim-empty">
        <div class="cim-header">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
          Images
        </div>
        <p class="cim-empty-text">Paste, drag, or use the toolbar to add images.<br>The first image automatically becomes the cover.</p>
      </div>`;
    return;
  }

  const coverSrc = hasCover ? _imageStore.get(_coverImageId) : "";
  const coverSection = hasCover
    ? `<div class="cim-cover">
        <div class="cim-section-label">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          Cover Image
        </div>
        <div class="cim-cover-card">
          <img src="${esc(coverSrc)}" alt="${esc(_coverAlt)}" />
          <div class="cim-cover-meta">
            <span class="cim-cover-alt">${esc(_coverAlt || "Cover")}</span>
            <div class="cim-cover-actions">
              <button class="cim-btn cim-btn-swap" id="cim-cover-swap" title="Replace cover" type="button">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2v6h-6M3 12a9 9 0 0115.36-6.36L21 8M3 22v-6h6M21 12a9 9 0 01-15.36 6.36L3 16"/></svg>
                Replace
              </button>
              <button class="cim-btn cim-btn-remove" id="cim-cover-remove" title="Remove cover" type="button">&times; Remove</button>
            </div>
          </div>
        </div>
      </div>`
    : `<div class="cim-cover cim-cover--empty">
        <div class="cim-section-label">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          Cover Image
        </div>
        <p class="cim-cover-hint">Click <span class="cim-star-hint">&#9733;</span> on any image below to set it as cover, or add a new image.</p>
      </div>`;

  const budgetClass = inlineImages.length >= MAX_INLINE_IMAGES ? "budget-full" : inlineImages.length >= WARN_INLINE ? "budget-warn" : "";
  const inlineCards = inlineImages.map((img, idx) => {
    const src = _imageStore.get(img.id) || "";
    const label = (img.alt || `Image ${idx + 1}`).slice(0, 28);
    return `
      <div class="cim-card" data-img-index="${idx}" draggable="true">
        <img src="${esc(src)}" alt="${esc(img.alt)}" />
        <div class="cim-card-bar">
          <span class="cim-card-label" title="${esc(img.alt)}">${esc(label)}</span>
          <div class="cim-card-btns">
            <button class="cim-star" data-img-index="${idx}" title="Set as cover">&#9733;</button>
            <button class="cim-remove" data-img-index="${idx}" title="Remove">&times;</button>
          </div>
        </div>
      </div>`;
  }).join("");

  const inlineSection = `
    <div class="cim-inline">
      <div class="cim-section-label">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
        Post Images <span class="cim-budget ${budgetClass}">(${inlineImages.length}/${MAX_INLINE_IMAGES})</span>
      </div>
      ${inlineImages.length
        ? `<div class="cim-grid">${inlineCards}</div>`
        : `<p class="cim-empty-text">No inline images yet. Add images to your story.</p>`
      }
    </div>`;

  slot.innerHTML = `<div class="cim" id="compose-image-manager">${coverSection}${inlineSection}</div>`;
  bindImageManagerEvents();
}

function bindImageManagerEvents() {
  const mgr = document.getElementById("compose-image-manager");
  if (!mgr) return;

  const coverRemoveBtn = mgr.querySelector("#cim-cover-remove");
  if (coverRemoveBtn) coverRemoveBtn.addEventListener("click", removeCover);

  const coverSwapBtn = mgr.querySelector("#cim-cover-swap");
  if (coverSwapBtn) coverSwapBtn.addEventListener("click", () => { _replacingCover = true; $("#compose-file-input")?.click(); });

  mgr.querySelectorAll(".cim-star").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      setCoverFromInline(parseInt(btn.dataset.imgIndex));
    });
  });

  mgr.querySelectorAll(".cim-remove").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      removeImageByIndex(parseInt(btn.dataset.imgIndex));
    });
  });

  const grid = mgr.querySelector(".cim-grid");
  if (!grid) return;
  let draggedIdx = null;
  grid.querySelectorAll(".cim-card").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target.closest(".cim-star, .cim-remove")) return;
      focusImageInEditor(parseInt(card.dataset.imgIndex, 10));
    });
    card.addEventListener("dragstart", () => { draggedIdx = parseInt(card.dataset.imgIndex); card.style.opacity = "0.4"; });
    card.addEventListener("dragend", () => { card.style.opacity = "1"; });
    card.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (draggedIdx !== null && draggedIdx !== parseInt(card.dataset.imgIndex)) card.style.borderColor = "var(--accent-soft)";
    });
    card.addEventListener("dragleave", () => { card.style.borderColor = ""; });
    card.addEventListener("drop", (e) => {
      e.preventDefault();
      card.style.borderColor = "";
      const dropIdx = parseInt(card.dataset.imgIndex);
      if (draggedIdx !== null && draggedIdx !== dropIdx) reorderImages(draggedIdx, dropIdx);
      draggedIdx = null;
    });
  });
}

function focusImageInEditor(imgIndex) {
  const ta = $("#compose-body");
  if (!ta) return;
  const images = parseImageTokens(ta.value);
  if (imgIndex < 0 || imgIndex >= images.length) return;
  const target = images[imgIndex];
  ta.focus();
  ta.selectionStart = target.index;
  ta.selectionEnd = target.index + target.markdown.length;
}

function removeImageByIndex(imgIndex) {
  const ta = $("#compose-body");
  const images = parseImageTokens(ta.value);
  if (imgIndex < 0 || imgIndex >= images.length) return;
  const img = images[imgIndex];
  _imageStore.delete(img.id);
  ta.value = ta.value.substring(0, img.index) + ta.value.substring(img.index + img.markdown.length);
  onBodyInput();
}

function reorderImages(fromIdx, toIdx) {
  const body = $("#compose-body").value;
  const images = parseImageTokens(body);
  if (fromIdx < 0 || fromIdx >= images.length || toIdx < 0 || toIdx >= images.length) return;

  let parts = [];
  let last = 0;
  images.forEach((img) => {
    parts.push({ type: "t", content: body.substring(last, img.index) });
    parts.push({ type: "i", content: img.markdown });
    last = img.index + img.markdown.length;
  });
  parts.push({ type: "t", content: body.substring(last) });

  const imgParts = parts.filter((p) => p.type === "i");
  const [moved] = imgParts.splice(fromIdx, 1);
  imgParts.splice(toIdx, 0, moved);

  let newBody = "";
  let ic = 0;
  parts.forEach((p) => { newBody += p.type === "i" ? imgParts[ic++].content : p.content; });

  $("#compose-body").value = newBody;
  onBodyInput();
}

/* ================================================================
   Image budget
   ================================================================ */

function countInlineImages() {
  return parseImageTokens($("#compose-body").value).length;
}

function canAddInlineImages(count = 1) {
  return countInlineImages() + count <= MAX_INLINE_IMAGES;
}

function updateStats() {
  const val = $("#compose-body").value;
  const words = val.trim() ? val.trim().split(/\s+/).length : 0;
  $("#compose-wordcount").textContent = words + " word" + (words !== 1 ? "s" : "");
  $("#compose-readtime").textContent = readTime(val);
}

/* ================================================================
   Auto-grow
   ================================================================ */

function autoGrow() {
  const ta = $("#compose-body");
  if (!ta) return;
  ta.style.height = "auto";
  ta.style.height = Math.max(400, ta.scrollHeight) + "px";
}

/* ================================================================
   Auto-save — saves both form data and image store
   ================================================================ */

function scheduleAutoSave() {
  clearTimeout(_autosaveTimer);
  _autosaveTimer = setTimeout(() => {
    const data = getFormData();
    if (!data.title && !data.body) return;
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(data));
    persistImageStore();
    setSaveStatus("Auto-saved");
  }, AUTOSAVE_DELAY);
}

function persistImageStore() {
  const entries = [..._imageStore.entries()];
  if (entries.length) {
    localStorage.setItem(AUTOSAVE_IMGS_KEY, JSON.stringify(entries));
  } else {
    localStorage.removeItem(AUTOSAVE_IMGS_KEY);
  }
  if (_coverImageId) {
    localStorage.setItem(AUTOSAVE_COVER_KEY, JSON.stringify({ id: _coverImageId, alt: _coverAlt }));
  } else {
    localStorage.removeItem(AUTOSAVE_COVER_KEY);
  }
}

function restoreImageStore() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_IMGS_KEY);
    if (!raw) return;
    const entries = JSON.parse(raw);
    resetImageStore();
    for (const [id, data] of entries) {
      _imageStore.set(id, data);
      if (id >= _imgCounter) _imgCounter = id;
    }
  } catch { /* ignore corrupt data */ }
}

function restoreCover() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_COVER_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.id && _imageStore.has(data.id)) {
      _coverImageId = data.id;
      _coverAlt = data.alt || "";
    }
  } catch { /* ignore corrupt data */ }
}

function loadAutoSave() {
  try { return JSON.parse(localStorage.getItem(AUTOSAVE_KEY)); } catch { return null; }
}

function clearAutoSave() {
  localStorage.removeItem(AUTOSAVE_KEY);
  localStorage.removeItem(AUTOSAVE_IMGS_KEY);
  localStorage.removeItem(AUTOSAVE_COVER_KEY);
  clearTimeout(_autosaveTimer);
}

function setSaveStatus(text) {
  const el = $("#compose-save-status");
  if (el) el.textContent = text ? ` \u00b7 ${text}` : "";
}

/* ================================================================
   Preview toggle
   ================================================================ */

function togglePreview(forceMode) {
  const next = forceMode || (_currentMode === "write" ? "preview" : "write");
  _currentMode = next;

  const surface = $("#compose-editor");
  const root = $("#compose-root");
  const btn = $("#compose-preview-toggle");
  const label = $("#compose-preview-label");
  if (surface) surface.dataset.mode = next;
  if (root) root.dataset.mode = next;

  const isPrev = next === "preview";
  if (btn) btn.classList.toggle("active", isPrev);
  if (label) label.textContent = isPrev ? "Edit" : "Preview";
  btn?.querySelector(".ev-icon-eye")?.classList.toggle("hidden", isPrev);
  btn?.querySelector(".ev-icon-pen")?.classList.toggle("hidden", !isPrev);

  if (isPrev) {
    updatePreview();
    $("#compose-canvas")?.scrollTo(0, 0);
  } else {
    const ta = $("#compose-body");
    if (ta) { ta.focus(); autoGrow(); }
  }
}

function $$(sel) { return [...document.querySelectorAll(sel)]; }

/* ================================================================
   Markdown toolbar
   ================================================================ */

function execCommand(cmd) {
  const ta = $("#compose-body");
  if (!ta) return;
  ta.focus();
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const sel = ta.value.substring(start, end);
  const before = ta.value.substring(0, start);
  const after = ta.value.substring(end);
  let insert, sS, sE;

  switch (cmd) {
    case "bold":
      insert = sel ? `**${sel}**` : "****";
      sS = start + 2; sE = start + 2 + (sel ? sel.length : 0); break;
    case "italic":
      insert = sel ? `*${sel}*` : "**";
      sS = start + 1; sE = start + 1 + (sel ? sel.length : 0); break;
    case "heading": {
      const lineStart = before.lastIndexOf("\n") + 1;
      const lineBefore = before.substring(lineStart);
      if (lineBefore.startsWith("### ")) {
        ta.value = before.substring(0, lineStart) + lineBefore.substring(4) + (sel || "") + after;
        ta.selectionStart = ta.selectionEnd = start - 4 + (sel ? sel.length : 0);
        onBodyInput(); return;
      } else if (lineBefore.startsWith("## ")) {
        ta.value = before.substring(0, lineStart) + "### " + lineBefore.substring(3) + (sel || "") + after;
        ta.selectionStart = ta.selectionEnd = start + 1 + (sel ? sel.length : 0);
        onBodyInput(); return;
      }
      insert = `## ${sel || "Heading"}`;
      const prefix = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
      ta.value = before + prefix + insert + after;
      const base = before.length + prefix.length;
      ta.selectionStart = base + 3; ta.selectionEnd = base + insert.length;
      onBodyInput(); return;
    }
    case "quote": {
      const lines = (sel || "Quote").split("\n").map((l) => "> " + l).join("\n");
      insert = lines; sS = start; sE = start + insert.length; break;
    }
    case "code":
      insert = sel ? `\`${sel}\`` : "``";
      sS = start + 1; sE = start + 1 + (sel ? sel.length : 0); break;
    case "codeblock": {
      const block = sel || "";
      insert = "\n```\n" + block + "\n```\n";
      sS = start + 5; sE = start + 5 + block.length; break;
    }
    case "link":
      if (sel) {
        insert = `[${sel}](url)`; sS = start + sel.length + 3; sE = start + sel.length + 6;
      } else {
        insert = "[](url)"; sS = start + 1; sE = start + 1;
      } break;
    case "image":
      $("#compose-file-input").click(); return;
    case "ul": {
      const items = (sel || "Item").split("\n").map((l) => "- " + l).join("\n");
      insert = items; sS = start; sE = start + insert.length; break;
    }
    case "ol": {
      const items = (sel || "Item").split("\n").map((l, i) => `${i + 1}. ${l}`).join("\n");
      insert = items; sS = start; sE = start + insert.length; break;
    }
    case "hr":
      insert = "\n---\n"; sS = sE = start + insert.length; break;
    default: return;
  }

  ta.value = before + insert + after;
  ta.selectionStart = sS; ta.selectionEnd = sE;
  onBodyInput();
}

/* ================================================================
   Image insertion — store data, insert clean token
   ================================================================ */

async function handleImageFiles(files) {
  const ta = $("#compose-body");
  if (!ta || !files.length) return;

  if (_replacingCover) {
    _replacingCover = false;
    try {
      const file = files[0];
      const altText = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
      const { dataUri } = await processImage(file);
      setCoverDirect(dataUri, altText);
      toast("Cover image replaced");
    } catch (err) { toast(err.message || "Image processing failed", "err"); }
    return;
  }

  const needsCover = !_coverImageId;
  const fileArr = Array.from(files);

  if (needsCover && fileArr.length === 1) {
    try {
      const file = fileArr[0];
      const altText = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
      const { dataUri } = await processImage(file);
      setCoverDirect(dataUri, altText);
      toast("Image set as cover");
      return;
    } catch (err) {
      toast(err.message || "Image processing failed", "err");
      return;
    }
  }

  let coverHandled = false;
  const inlineFiles = [];
  for (const f of fileArr) {
    if (needsCover && !coverHandled) { coverHandled = true; inlineFiles.push({ file: f, asCover: true }); }
    else inlineFiles.push({ file: f, asCover: false });
  }

  const inlineOnly = inlineFiles.filter((f) => !f.asCover);
  if (inlineOnly.length && !canAddInlineImages(inlineOnly.length)) {
    const remaining = MAX_INLINE_IMAGES - countInlineImages();
    if (remaining <= 0 && !needsCover) { toast(`Maximum ${MAX_INLINE_IMAGES} inline images per post`, "err"); return; }
    if (remaining < inlineOnly.length) toast(`Only ${remaining} inline slot${remaining > 1 ? "s" : ""} remaining`, "err");
  }

  for (const { file, asCover } of inlineFiles) {
    const altText = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");

    if (asCover) {
      try {
        const { dataUri } = await processImage(file);
        setCoverDirect(dataUri, altText);
      } catch (err) { toast(err.message || "Image processing failed", "err"); }
      continue;
    }

    if (!canAddInlineImages(1)) continue;

    const placeholder = `![Uploading ${esc(file.name)}...]()`;
    insertTextAtCursor(ta, placeholder);
    onBodyInput();

    try {
      const { dataUri } = await processImage(file);
      const id = storeImage(dataUri);
      const token = `![${altText}](img:${id})`;
      const pos = ta.value.indexOf(placeholder);
      if (pos !== -1) {
        ta.value = ta.value.substring(0, pos) + token + ta.value.substring(pos + placeholder.length);
        ta.selectionStart = ta.selectionEnd = pos + token.length;
      }
      onBodyInput();
    } catch (err) {
      ta.value = ta.value.replace(placeholder, "");
      toast(err.message || "Image processing failed", "err");
      onBodyInput();
    }
  }
}

function insertTextAtCursor(ta, text) {
  const start = ta.selectionStart;
  ta.value = ta.value.substring(0, start) + text + ta.value.substring(ta.selectionEnd);
  ta.selectionStart = ta.selectionEnd = start + text.length;
}

/* ================================================================
   Input handler
   ================================================================ */

function onBodyInput() {
  clearTimeout(_previewTimer);
  _previewTimer = setTimeout(() => {
    if (_currentMode === "preview") updatePreview();
    else updateImageManager();
  }, 150);
  updateStats();
  autoGrow();
  scheduleAutoSave();
  setSaveStatus("Unsaved changes");
}

/* ================================================================
   Keyboard shortcuts
   ================================================================ */

function handleKeydown(e) {
  if (e.key === "Escape") {
    showConfirm({
      title: "Close editor?",
      message: "Any unsaved changes will be lost.",
      okLabel: "Discard & close",
      cancelLabel: "Keep editing",
    }).then((yes) => { if (yes) go("feed"); });
    return;
  }

  if (e.key === "Tab") {
    e.preventDefault();
    insertTextAtCursor($("#compose-body"), "  ");
    onBodyInput();
    return;
  }

  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return;

  const key = e.key.toLowerCase();
  if (e.shiftKey) {
    const shiftCmds = { i: "image", e: "codeblock", ".": "quote" };
    if (shiftCmds[key]) { e.preventDefault(); execCommand(shiftCmds[key]); }
    return;
  }

  if (key === "p") { e.preventDefault(); togglePreview(); return; }
  const cmds = { b: "bold", i: "italic", e: "code", k: "link" };
  if (cmds[key]) { e.preventDefault(); execCommand(cmds[key]); return; }
  if (key === "s") { e.preventDefault(); submitPost("draft"); return; }
  if (key === "enter") { e.preventDefault(); submitPost("published"); }
}

/* ================================================================
   Bind all events
   ================================================================ */

export function bindComposeEvents() {
  const body = $("#compose-body");
  const toolbar = $("#compose-toolbar");
  const fileInput = $("#compose-file-input");
  const closeBtn = $("#compose-close");
  const previewBtn = $("#compose-preview-toggle");

  $("#btn-publish").addEventListener("click", () => submitPost("published"));
  $("#btn-draft").addEventListener("click", () => submitPost("draft"));

  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      showConfirm({
        title: "Close editor?",
        message: "Any unsaved changes will be lost.",
        okLabel: "Discard & close",
        cancelLabel: "Keep editing",
      }).then((yes) => { if (yes) go("feed"); });
    });
  }

  if (previewBtn) {
    previewBtn.addEventListener("click", () => togglePreview());
  }

  // Author alias: click pencil to focus the input
  const authorEdit = $("#compose-author-edit");
  if (authorEdit) {
    authorEdit.addEventListener("click", () => {
      const input = $("#compose-author");
      if (input) { input.focus(); input.select(); }
    });
  }

  body.addEventListener("input", onBodyInput);
  body.addEventListener("keydown", handleKeydown);

  toolbar.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-cmd]");
    if (btn) execCommand(btn.dataset.cmd);
  });

  fileInput.addEventListener("change", () => {
    if (fileInput.files.length) handleImageFiles([...fileInput.files]);
    fileInput.value = "";
  });

  const tagPicker = $("#compose-tagpicker");
  if (tagPicker) {
    tagPicker.addEventListener("click", (e) => {
      const pill = e.target.closest(".ev-tag");
      if (pill) toggleTag(pill.dataset.tag);
    });
  }

  const tagInput = $("#compose-tag-input");
  if (tagInput) {
    tagInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === ",") {
        e.preventDefault();
        addCustomTag(tagInput.value);
        tagInput.value = "";
      }
      if (e.key === "Backspace" && !tagInput.value && _selectedTags.size) {
        const last = [..._selectedTags].pop();
        _selectedTags.delete(last);
        renderTagPills();
        scheduleAutoSave();
      }
    });
    tagInput.addEventListener("blur", () => {
      if (tagInput.value.trim()) {
        addCustomTag(tagInput.value);
        tagInput.value = "";
      }
    });
  }

  const writePane = $("#compose-write-pane");
  const dropzone = $("#compose-dropzone");
  let dragCounter = 0;

  writePane.addEventListener("dragenter", (e) => { e.preventDefault(); dragCounter++; dropzone.classList.add("active"); });
  writePane.addEventListener("dragleave", (e) => { e.preventDefault(); dragCounter--; if (dragCounter <= 0) { dragCounter = 0; dropzone.classList.remove("active"); } });
  writePane.addEventListener("dragover", (e) => { e.preventDefault(); });
  writePane.addEventListener("drop", (e) => {
    e.preventDefault();
    dragCounter = 0;
    dropzone.classList.remove("active");
    const files = extractImageFiles(e);
    if (files.length) handleImageFiles(files);
  });

  body.addEventListener("paste", (e) => {
    const files = extractImageFiles(e);
    if (files.length) { e.preventDefault(); handleImageFiles(files); }
  });

  $("#compose-post-title").addEventListener("input", () => { scheduleAutoSave(); setSaveStatus("Unsaved changes"); });
  $("#compose-author").addEventListener("input", scheduleAutoSave);
}
