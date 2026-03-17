import { $, UI_CONFIG, state, esc, md, toast, api, isAdmin, go } from "./utils.js";

export function handleComposeRoute(editId) {
  if (editId) {
    const cached = state.postCache.get(editId);
    if (cached) {
      populateComposeForm(cached);
      return;
    }
    api("getPost", { pathParams: { id: editId } }).then((r) => {
      if (r.data?.data) populateComposeForm(r.data.data);
      else { toast("Post not found", "err"); go("manage"); }
    });
    return;
  }
  clearComposeForm();
}

function populateComposeForm(post) {
  $("#compose-post-title").value = post.title || "";
  $("#compose-author").value = post.author || "";
  $("#compose-tags").value = (post.tags || []).join(", ");
  $("#compose-body").value = post.body || "";
  $("#compose-preview").innerHTML = md(post.body || "");
  $("#compose-edit-id").value = post._id;
  $("#compose-edit-hint").textContent = "Editing existing post";
  $("#compose-title").textContent = UI_CONFIG.labels.editPost;
}

function clearComposeForm() {
  $("#compose-post-title").value = "";
  $("#compose-author").value = "";
  $("#compose-tags").value = "";
  $("#compose-body").value = "";
  $("#compose-preview").innerHTML = '<span class="placeholder-text">Start typing to see a live preview...</span>';
  $("#compose-edit-id").value = "";
  $("#compose-edit-hint").textContent = "";
  $("#compose-title").textContent = UI_CONFIG.labels.newPost;
}

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
  clearComposeForm();
  go("feed");
  window.dispatchEvent(new Event("feed:refresh"));
}

export function bindComposeEvents() {
  $("#btn-publish").addEventListener("click", () => submitPost("published"));
  $("#btn-draft").addEventListener("click", () => submitPost("draft"));
  let previewTimer;
  $("#compose-body").addEventListener("input", () => {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      const val = $("#compose-body").value;
      $("#compose-preview").innerHTML = val ? md(val) : '<span class="placeholder-text">Start typing to see a live preview...</span>';
    }, 150);
  });
}
