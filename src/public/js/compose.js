import { $, UI_CONFIG, state, esc, md, toast, api, isAdmin, go, readTime } from "./utils.js";
import { processImage, extractImageFiles } from "./image-util.js";

const AUTOSAVE_KEY = "blog-zero-draft";
const AUTOSAVE_DELAY = 2000;
let _autosaveTimer = null;
let _previewTimer = null;
let _currentMode = "write";
let _focusMode = false;

/* ================================================================
   Route handler
   ================================================================ */

export function handleComposeRoute(editId) {
  if (editId) {
    clearAutoSave();
    const cached = state.postCache.get(editId);
    if (cached) { populateForm(cached); return; }
    api("getPost", { pathParams: { id: editId } }).then((r) => {
      if (r.data?.data) populateForm(r.data.data);
      else { toast("Post not found", "err"); go("manage"); }
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
}

/* ================================================================
   Form state
   ================================================================ */

function populateForm(post) {
  $("#compose-post-title").value = post.title || "";
  $("#compose-author").value = post.author || "";
  $("#compose-tags").value = (post.tags || []).join(", ");
  const body = $("#compose-body");
  body.value = post.body || "";
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
  $("#compose-tags").value = obj.tags || "";
  $("#compose-body").value = obj.body || "";
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
  $("#compose-post-title").value = "";
  $("#compose-author").value = "";
  $("#compose-tags").value = "";
  $("#compose-body").value = "";
  $("#compose-preview").innerHTML = '<span class="placeholder-text">Start writing to see a live preview...</span>';
  $("#compose-edit-id").value = "";
  $("#compose-edit-hint").textContent = "";
  setSaveStatus("");
  autoGrow();
  updateStats();
}

function getFormData() {
  return {
    title: $("#compose-post-title").value,
    author: $("#compose-author").value,
    tags: $("#compose-tags").value,
    body: $("#compose-body").value,
    editId: $("#compose-edit-id").value,
  };
}

/* ================================================================
   Submit
   ================================================================ */

async function submitPost(status) {
  if (!isAdmin()) { toast("Admin access required", "err"); return; }
  const title = $("#compose-post-title").value.trim();
  if (!title) { toast("Title is required", "err"); return; }

  const payload = { title, status };
  const author = $("#compose-author").value.trim();
  const body = $("#compose-body").value.trim();
  const tags = $("#compose-tags").value.split(",").map((t) => t.trim()).filter(Boolean);
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
   Preview + stats
   ================================================================ */

function updatePreview() {
  const val = $("#compose-body").value;
  $("#compose-preview").innerHTML = val
    ? md(val)
    : '<span class="placeholder-text">Start writing to see a live preview...</span>';
  updateImageManager();
}

/* ================================================================
   Image Manager (Visual image organization)
   ================================================================ */

function updateImageManager() {
  const body = $("#compose-body").value;
  const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const images = [];
  let match;

  while ((match = imageRegex.exec(body)) !== null) {
    images.push({
      alt: match[1],
      src: match[2],
      markdown: match[0],
      index: match.index
    });
  }

  let managerEl = $("#compose-image-manager");

  if (images.length === 0) {
    if (managerEl) managerEl.remove();
    return;
  }

  if (!managerEl) {
    managerEl = document.createElement("div");
    managerEl.id = "compose-image-manager";
    managerEl.className = "compose-image-manager";
    const writePane = $("#compose-write-pane");
    writePane.insertBefore(managerEl, writePane.firstChild);
  }

  const gridHtml = images.map((img, idx) => {
    const safeSrc = img.src.length > 100 ? img.src.substring(0, 100) + "..." : img.src;
    return `
      <div class="compose-image-preview" data-img-index="${idx}" draggable="true">
        <img src="${esc(img.src)}" alt="${esc(img.alt)}" />
        <button class="compose-image-preview-remove" data-img-index="${idx}" title="Remove image">×</button>
      </div>
    `;
  }).join("");

  managerEl.innerHTML = `
    <div class="compose-image-manager-title">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <circle cx="8.5" cy="8.5" r="1.5"/>
        <path d="M21 15l-5-5L5 21"/>
      </svg>
      Images in Post (${images.length})
    </div>
    <div class="compose-image-grid" id="compose-image-grid">
      ${gridHtml}
    </div>
  `;

  bindImageManagerEvents();
}

function bindImageManagerEvents() {
  const grid = $("#compose-image-grid");
  if (!grid) return;

  // Remove image
  grid.querySelectorAll(".compose-image-preview-remove").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.imgIndex);
      removeImageFromMarkdown(idx);
    });
  });

  // Drag and drop reordering
  let draggedIdx = null;

  grid.querySelectorAll(".compose-image-preview").forEach((preview) => {
    preview.addEventListener("dragstart", (e) => {
      draggedIdx = parseInt(preview.dataset.imgIndex);
      preview.style.opacity = "0.5";
    });

    preview.addEventListener("dragend", (e) => {
      preview.style.opacity = "1";
    });

    preview.addEventListener("dragover", (e) => {
      e.preventDefault();
      const dropIdx = parseInt(preview.dataset.imgIndex);
      if (draggedIdx !== null && draggedIdx !== dropIdx) {
        preview.style.borderColor = "var(--accent)";
      }
    });

    preview.addEventListener("dragleave", (e) => {
      preview.style.borderColor = "";
    });

    preview.addEventListener("drop", (e) => {
      e.preventDefault();
      preview.style.borderColor = "";
      const dropIdx = parseInt(preview.dataset.imgIndex);
      if (draggedIdx !== null && draggedIdx !== dropIdx) {
        reorderImages(draggedIdx, dropIdx);
      }
      draggedIdx = null;
    });
  });
}

function removeImageFromMarkdown(imgIndex) {
  const body = $("#compose-body").value;
  const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const images = [];
  let match;

  while ((match = imageRegex.exec(body)) !== null) {
    images.push({
      markdown: match[0],
      index: match.index
    });
  }

  if (imgIndex < 0 || imgIndex >= images.length) return;

  const imgToRemove = images[imgIndex];
  const newBody = body.substring(0, imgToRemove.index) + body.substring(imgToRemove.index + imgToRemove.markdown.length);

  $("#compose-body").value = newBody;
  onBodyInput();
}

function reorderImages(fromIdx, toIdx) {
  const body = $("#compose-body").value;
  const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const images = [];
  let match;

  while ((match = imageRegex.exec(body)) !== null) {
    images.push({
      markdown: match[0],
      index: match.index
    });
  }

  if (fromIdx < 0 || fromIdx >= images.length || toIdx < 0 || toIdx >= images.length) return;

  // Extract non-image content and images separately
  let bodyParts = [];
  let lastIndex = 0;

  images.forEach((img) => {
    bodyParts.push({
      type: "text",
      content: body.substring(lastIndex, img.index)
    });
    bodyParts.push({
      type: "image",
      content: img.markdown
    });
    lastIndex = img.index + img.markdown.length;
  });
  bodyParts.push({
    type: "text",
    content: body.substring(lastIndex)
  });

  // Find image parts and reorder
  const imageParts = bodyParts.filter(p => p.type === "image");
  const [movedImage] = imageParts.splice(fromIdx, 1);
  imageParts.splice(toIdx, 0, movedImage);

  // Rebuild markdown with reordered images
  let newBody = "";
  let imgCounter = 0;

  bodyParts.forEach((part) => {
    if (part.type === "image") {
      newBody += imageParts[imgCounter].content;
      imgCounter++;
    } else {
      newBody += part.content;
    }
  });

  $("#compose-body").value = newBody;
  onBodyInput();
}

function updateStats() {
  const val = $("#compose-body").value;
  const words = val.trim() ? val.trim().split(/\s+/).length : 0;
  $("#compose-wordcount").textContent = words + " word" + (words !== 1 ? "s" : "");
  $("#compose-readtime").textContent = readTime(val);
}

/* ================================================================
   Auto-grow textarea
   ================================================================ */

function autoGrow() {
  const ta = $("#compose-body");
  if (!ta) return;
  ta.style.height = "auto";
  ta.style.height = Math.max(400, ta.scrollHeight) + "px";
}

/* ================================================================
   Auto-save to localStorage
   ================================================================ */

function scheduleAutoSave() {
  clearTimeout(_autosaveTimer);
  _autosaveTimer = setTimeout(() => {
    const data = getFormData();
    if (!data.title && !data.body) return;
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(data));
    setSaveStatus("Auto-saved");
  }, AUTOSAVE_DELAY);
}

function loadAutoSave() {
  try { return JSON.parse(localStorage.getItem(AUTOSAVE_KEY)); }
  catch { return null; }
}

function clearAutoSave() {
  localStorage.removeItem(AUTOSAVE_KEY);
  clearTimeout(_autosaveTimer);
}

function setSaveStatus(text) {
  const el = $("#compose-save-status");
  if (el) el.textContent = text;
}

/* ================================================================
   Editor modes: write / split / preview
   ================================================================ */

function setMode(mode) {
  _currentMode = mode;
  const editor = $("#compose-editor");
  const root = $("#compose-root");
  if (!editor) return;
  editor.dataset.mode = mode;

  if (mode === "split") {
    root.setAttribute("data-has-split", "");
  } else {
    root.removeAttribute("data-has-split");
  }

  $$("#compose-modes [data-mode]").forEach((btn) => {
    const on = btn.dataset.mode === mode;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-selected", String(on));
  });

  if (mode === "preview" || mode === "split") updatePreview();
  if (mode === "write") {
    const ta = $("#compose-body");
    if (ta) { ta.focus(); autoGrow(); }
  }
}

function $$(sel) { return [...document.querySelectorAll(sel)]; }

/* ================================================================
   Focus mode
   ================================================================ */

function toggleFocusMode() {
  _focusMode = !_focusMode;
  document.body.classList.toggle("compose-focus-active", _focusMode);
  const btn = $("#compose-focus");
  if (_focusMode) {
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 14v6h6M20 10V4h-6M14 10l7-7M3 21l7-7"/></svg>';
    btn.title = "Exit focus mode (Esc)";
  } else {
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>';
    btn.title = "Focus mode";
  }
}

/* ================================================================
   Markdown toolbar commands
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
      sS = start + 2;
      sE = start + 2 + (sel ? sel.length : 0);
      break;
    case "italic":
      insert = sel ? `*${sel}*` : "**";
      sS = start + 1;
      sE = start + 1 + (sel ? sel.length : 0);
      break;
    case "heading": {
      const lineStart = before.lastIndexOf("\n") + 1;
      const lineBefore = before.substring(lineStart);
      if (lineBefore.startsWith("### ")) {
        ta.value = before.substring(0, lineStart) + lineBefore.substring(4) + (sel || "") + after;
        ta.selectionStart = ta.selectionEnd = start - 4 + (sel ? sel.length : 0);
        onBodyInput();
        return;
      } else if (lineBefore.startsWith("## ")) {
        ta.value = before.substring(0, lineStart) + "### " + lineBefore.substring(3) + (sel || "") + after;
        ta.selectionStart = ta.selectionEnd = start + 1 + (sel ? sel.length : 0);
        onBodyInput();
        return;
      }
      insert = `## ${sel || "Heading"}`;
      const prefix = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
      ta.value = before + prefix + insert + after;
      const base = before.length + prefix.length;
      ta.selectionStart = base + 3;
      ta.selectionEnd = base + insert.length;
      onBodyInput();
      return;
    }
    case "quote": {
      const lines = (sel || "Quote").split("\n").map((l) => "> " + l).join("\n");
      insert = lines;
      sS = start;
      sE = start + insert.length;
      break;
    }
    case "code":
      insert = sel ? `\`${sel}\`` : "``";
      sS = start + 1;
      sE = start + 1 + (sel ? sel.length : 0);
      break;
    case "codeblock": {
      const block = sel || "";
      insert = "\n```\n" + block + "\n```\n";
      sS = start + 5;
      sE = start + 5 + block.length;
      break;
    }
    case "link":
      if (sel) {
        insert = `[${sel}](url)`;
        sS = start + sel.length + 3;
        sE = start + sel.length + 6;
      } else {
        insert = "[](url)";
        sS = start + 1;
        sE = start + 1;
      }
      break;
    case "image":
      $("#compose-file-input").click();
      return;
    case "ul": {
      const items = (sel || "Item").split("\n").map((l) => "- " + l).join("\n");
      insert = items;
      sS = start;
      sE = start + insert.length;
      break;
    }
    case "ol": {
      const items = (sel || "Item").split("\n").map((l, i) => `${i + 1}. ${l}`).join("\n");
      insert = items;
      sS = start;
      sE = start + insert.length;
      break;
    }
    case "hr":
      insert = "\n---\n";
      sS = sE = start + insert.length;
      break;
    default:
      return;
  }

  ta.value = before + insert + after;
  ta.selectionStart = sS;
  ta.selectionEnd = sE;
  onBodyInput();
}

/* ================================================================
   Image insertion
   ================================================================ */

async function handleImageFiles(files) {
  const ta = $("#compose-body");
  if (!ta || !files.length) return;

  for (const file of files) {
    const cursor = ta.selectionStart;
    const placeholder = `![Uploading ${esc(file.name)}...]()`;
    insertTextAtCursor(ta, placeholder);
    onBodyInput();

    try {
      const { dataUri } = await processImage(file);
      const altText = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
      const md = `![${altText}](${dataUri})`;
      const pos = ta.value.indexOf(placeholder);
      if (pos !== -1) {
        ta.value = ta.value.substring(0, pos) + md + ta.value.substring(pos + placeholder.length);
        ta.selectionStart = ta.selectionEnd = pos + md.length;
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
   Input handler (shared for preview, stats, autosave, autogrow)
   ================================================================ */

function onBodyInput() {
  clearTimeout(_previewTimer);
  _previewTimer = setTimeout(() => {
    if (_currentMode === "split" || _currentMode === "preview") updatePreview();
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
    if (_focusMode) { toggleFocusMode(); e.preventDefault(); }
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
  const modes = $("#compose-modes");
  const focusBtn = $("#compose-focus");
  const fileInput = $("#compose-file-input");

  $("#btn-publish").addEventListener("click", () => submitPost("published"));
  $("#btn-draft").addEventListener("click", () => submitPost("draft"));

  body.addEventListener("input", onBodyInput);
  body.addEventListener("keydown", handleKeydown);

  // Toolbar button clicks
  toolbar.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-cmd]");
    if (btn) execCommand(btn.dataset.cmd);
  });

  // Mode switching
  modes.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-mode]");
    if (btn) setMode(btn.dataset.mode);
  });

  // Focus mode
  focusBtn.addEventListener("click", toggleFocusMode);

  // File input for images
  fileInput.addEventListener("change", () => {
    if (fileInput.files.length) handleImageFiles([...fileInput.files]);
    fileInput.value = "";
  });

  // Drag and drop images
  const writePaneEl = $("#compose-write-pane");
  const dropzone = $("#compose-dropzone");
  let dragCounter = 0;

  writePaneEl.addEventListener("dragenter", (e) => {
    e.preventDefault();
    dragCounter++;
    dropzone.classList.add("active");
  });
  writePaneEl.addEventListener("dragleave", (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) { dragCounter = 0; dropzone.classList.remove("active"); }
  });
  writePaneEl.addEventListener("dragover", (e) => { e.preventDefault(); });
  writePaneEl.addEventListener("drop", (e) => {
    e.preventDefault();
    dragCounter = 0;
    dropzone.classList.remove("active");
    const files = extractImageFiles(e);
    if (files.length) handleImageFiles(files);
  });

  // Paste images
  body.addEventListener("paste", (e) => {
    const files = extractImageFiles(e);
    if (files.length) {
      e.preventDefault();
      handleImageFiles(files);
    }
  });

  // Auto-save on title/meta changes too
  $("#compose-post-title").addEventListener("input", () => {
    scheduleAutoSave();
    setSaveStatus("Unsaved changes");
  });
  $("#compose-author").addEventListener("input", scheduleAutoSave);
  $("#compose-tags").addEventListener("input", scheduleAutoSave);
}
