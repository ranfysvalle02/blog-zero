import { $, UI_CONFIG, state, esc, md, toast, api, isAdmin, go, readTime, showConfirm } from "./utils.js";
import { processCoverImage, extractImageFiles } from "./image-util.js";

const AUTOSAVE_KEY = "blog-zero-draft";
const AUTOSAVE_IMGS_KEY = "blog-zero-draft-imgs";
const AUTOSAVE_COVER_KEY = "blog-zero-draft-cover";
const AUTOSAVE_DELAY = 2000;
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

function removeCover() {
  if (!_coverImageId) return;
  _imageStore.delete(_coverImageId);
  _coverImageId = null;
  _coverAlt = "";
  updateCoverZone();
  scheduleAutoSave();
  setSaveStatus("Unsaved changes");
}

function setCoverDirect(dataUri, alt) {
  if (_coverImageId && _imageStore.has(_coverImageId)) {
    _imageStore.delete(_coverImageId);
  }
  const id = storeImage(dataUri);
  _coverImageId = id;
  _coverAlt = alt || "Cover";
  updateCoverZone();
  scheduleAutoSave();
  setSaveStatus("Unsaved changes");
}

function setCoverFromUrl(url, alt) {
  if (_coverImageId && _imageStore.has(_coverImageId)) {
    _imageStore.delete(_coverImageId);
  }
  const id = storeImage(url);
  _coverImageId = id;
  _coverAlt = alt || "Cover";
  updateCoverZone();
  scheduleAutoSave();
  setSaveStatus("Unsaved changes");
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
  updateCoverZone();
  updatePreview();
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
  updateCoverZone();
  updatePreview();
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
  updateCoverZone();
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

const MAX_PAYLOAD_BYTES = 950 * 1024;

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

  const payloadSize = new Blob([JSON.stringify(payload)]).size;
  if (payloadSize > MAX_PAYLOAD_BYTES) {
    const sizeMB = (payloadSize / (1024 * 1024)).toFixed(1);
    toast(`Post too large (${sizeMB} MB). Remove an image or use smaller images.`, "err");
    return;
  }

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
  updateCoverZone();
}

/* ================================================================
   Cover Zone — dedicated UI above the title
   ================================================================ */

function updateCoverZone() {
  const emptyEl = $("#compose-cover-empty");
  const previewEl = $("#compose-cover-preview");
  const imgEl = $("#compose-cover-img");
  const captionEl = $("#compose-cover-caption");
  if (!emptyEl || !previewEl) return;

  const hasCover = _coverImageId && _imageStore.has(_coverImageId);
  if (hasCover) {
    emptyEl.classList.add("hidden");
    previewEl.classList.remove("hidden");
    const src = _imageStore.get(_coverImageId);
    if (imgEl) { imgEl.src = src; imgEl.alt = _coverAlt || "Cover"; }
    if (captionEl && captionEl !== document.activeElement) {
      captionEl.value = _coverAlt || "";
    }
  } else {
    emptyEl.classList.remove("hidden");
    previewEl.classList.add("hidden");
    if (imgEl) imgEl.src = "";
    if (captionEl) captionEl.value = "";
  }
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
      toast("Use the Cover Image zone above to add an image", "info"); return;
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

async function handleCoverFile(file) {
  if (!file) return;
  try {
    const altText = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
    const { dataUri } = await processCoverImage(file);
    setCoverDirect(dataUri, altText);
  } catch (err) {
    toast(err.message || "Image processing failed", "err");
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
    const shiftCmds = { e: "codeblock", ".": "quote" };
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

  const coverZone = $("#compose-cover-zone");
  const coverFile = $("#compose-cover-file");
  const coverChangeBtn = $("#compose-cover-change");
  const coverRemoveBtn2 = $("#compose-cover-remove-btn");

  if (coverZone && coverFile) {
    const openPicker = () => coverFile.click();
    $("#compose-cover-empty")?.addEventListener("click", openPicker);
    coverZone.addEventListener("keydown", (e) => {
      if (e.target.closest("input, textarea, [contenteditable]")) return;
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPicker(); }
    });
    if (coverChangeBtn) coverChangeBtn.addEventListener("click", (e) => { e.stopPropagation(); openPicker(); });
    if (coverRemoveBtn2) coverRemoveBtn2.addEventListener("click", (e) => { e.stopPropagation(); removeCover(); });

    coverFile.addEventListener("change", () => {
      if (coverFile.files.length) handleCoverFile(coverFile.files[0]);
      coverFile.value = "";
    });

    coverZone.addEventListener("dragover", (e) => { e.preventDefault(); coverZone.classList.add("dragover"); });
    coverZone.addEventListener("dragleave", () => { coverZone.classList.remove("dragover"); });
    coverZone.addEventListener("drop", (e) => {
      e.preventDefault();
      coverZone.classList.remove("dragover");
      const files = extractImageFiles(e);
      if (files.length) handleCoverFile(files[0]);
    });

    const coverCaption = $("#compose-cover-caption");
    if (coverCaption) {
      coverCaption.addEventListener("input", () => {
        _coverAlt = coverCaption.value;
        scheduleAutoSave();
        setSaveStatus("Unsaved changes");
      });
      coverCaption.addEventListener("click", (e) => e.stopPropagation());
      coverCaption.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Escape") coverCaption.blur();
      });
    }
  }

  const coverUrlInput = $("#compose-cover-url");
  const coverUrlBtn = $("#compose-cover-url-go");
  if (coverUrlInput && coverUrlBtn) {
    const applyCoverUrl = () => {
      const url = coverUrlInput.value.trim();
      if (!url) return;
      if (!/^https?:\/\/.+/i.test(url)) { toast("Enter a valid image URL (https://...)", "err"); return; }
      setCoverFromUrl(url, "Cover");
      coverUrlInput.value = "";
    };
    coverUrlBtn.addEventListener("click", (e) => { e.stopPropagation(); applyCoverUrl(); });
    coverUrlInput.addEventListener("click", (e) => e.stopPropagation());
    coverUrlInput.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); applyCoverUrl(); }
    });
  }

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

  body.addEventListener("paste", (e) => {
    const files = extractImageFiles(e);
    if (files.length) {
      e.preventDefault();
      if (_coverImageId) { toast("Cover image already set — remove it first to paste a new one", "info"); return; }
      handleCoverFile(files[0]);
    }
  });

  $("#compose-post-title").addEventListener("input", () => { scheduleAutoSave(); setSaveStatus("Unsaved changes"); });
  $("#compose-author").addEventListener("input", scheduleAutoSave);
}
