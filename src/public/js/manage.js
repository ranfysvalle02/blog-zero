import { $, $$, state, setState, esc, fmtDate, toast, api, isAdmin, go } from "./utils.js";

export function handleManageRoute() {
  loadStats();
  loadManage();
  loadPendingComments();
  loadAuditLog();
}

async function loadStats() {
  const [t, p, d, a] = await Promise.all([
    api("countPosts"),
    api("countPosts", { params: { scope: "published" } }),
    api("countPosts", { params: { scope: "drafts" } }),
    api("countPosts", { params: { scope: "archived" } }),
  ]);
  $("#manage-stats").innerHTML =
    `<div class="stat"><div class="n">${t.data?.count ?? 0}</div><div class="l">Total</div></div>` +
    `<div class="stat"><div class="n">${p.data?.count ?? 0}</div><div class="l">Published</div></div>` +
    `<div class="stat"><div class="n">${d.data?.count ?? 0}</div><div class="l">Drafts</div></div>` +
    `<div class="stat"><div class="n">${a.data?.count ?? 0}</div><div class="l">Archived</div></div>`;
}

async function loadManage() {
  if (!isAdmin()) return;
  const isTrash = state.manageScope === "trash";
  const r = isTrash
    ? await api("listTrash")
    : await api("listPosts", { params: { sort: "-created_at", limit: "100", scope: state.manageScope === "all" ? null : state.manageScope, computed: null } });
  const posts = r.data?.data || [];
  state.postCache.clear();
  posts.forEach((p) => state.postCache.set(p._id, p));

  if (!posts.length) {
    $("#manage-list").innerHTML = `<div class="notice">${isTrash ? "Trash is empty." : "No posts in this view."}</div>`;
    return;
  }

  $("#manage-list").innerHTML = posts.map((p) => {
    const st = isTrash ? "deleted" : (p.status || "draft");
    let actions = "";
    if (isTrash) {
      actions = `<button class="btn btn-success btn-sm" data-action="restore" data-id="${p._id}">Restore</button>`;
    } else {
      if (st === "draft") actions += `<button class="btn btn-success btn-sm" data-action="publish" data-id="${p._id}">Publish</button>`;
      if (st === "published") actions += `<button class="btn btn-outline btn-sm" data-action="archive" data-id="${p._id}">Archive</button>`;
      if (st === "archived") actions += `<button class="btn btn-outline btn-sm" data-action="to-draft" data-id="${p._id}">To Draft</button>`;
      actions += `<button class="btn-icon" data-action="edit" data-id="${p._id}" title="Edit">✎</button><button class="btn-icon" data-action="delete" data-id="${p._id}" title="Delete">✕</button>`;
    }
    return `<div class="m-row"><span class="tag tag-${st === "deleted" ? "archived" : st}">${st}</span><div class="m-info"><div class="m-title">${esc(p.title || "Untitled")}</div><div class="m-meta">${esc(p.author || "Anonymous")} · ${fmtDate(isTrash ? p.deleted_at : p.created_at)}</div></div><div class="m-actions">${actions}</div></div>`;
  }).join("");
}

async function setPostStatus(id, status) {
  const r = await api("updatePost", { pathParams: { id }, body: { status } });
  if (r.ok) { toast("Updated"); loadStats(); loadManage(); }
  else toast(r.data?.detail || "Failed", "err");
}

async function deletePost(id) {
  const r = await api("deletePost", { pathParams: { id } });
  if (r.ok) { toast("Moved to trash"); loadStats(); loadManage(); }
  else toast(r.data?.detail || "Failed", "err");
}

async function restorePost(id) {
  const r = await api("restorePost", { pathParams: { id }, body: {} });
  if (r.ok) { toast("Restored"); loadStats(); loadManage(); }
  else toast(r.data?.detail || "Failed", "err");
}

async function loadPendingComments() {
  if (!isAdmin()) return;
  const r = await api("listComments", { params: { scope: "pending", sort: "-created_at", limit: "50" } });
  const items = r.data?.data || [];
  if (!items.length) {
    $("#pending-comments").innerHTML = '<div class="notice">No comments pending approval.</div>';
    return;
  }
  $("#pending-comments").innerHTML = items.map((c) =>
    `<div class="m-row"><div class="m-info"><div class="m-title">${esc(c.author || "Guest")} on post ${esc(c.post_id || "")}</div><div class="m-meta">${fmtDate(c.created_at)}</div><div style="margin-top:4px;color:var(--text-muted);font-size:.85rem">${esc(c.body || "")}</div></div><div class="m-actions"><button class="btn btn-success btn-sm" data-action="approve" data-id="${c._id}">Approve</button><button class="btn btn-outline btn-sm" data-action="keep-pending" data-id="${c._id}">Keep pending</button></div></div>`
  ).join("");
}

async function approveComment(id, approved) {
  const r = await api("updateComment", { pathParams: { id }, body: { approved } });
  if (r.ok) { toast(approved ? "Approved" : "Updated"); loadPendingComments(); }
  else toast(r.data?.detail || "Action failed", "err");
}

async function loadAuditLog() {
  if (!isAdmin()) return;
  const r = await api("listAuditLog", { params: { sort: "-timestamp", limit: "20" } });
  const items = r.data?.data || [];
  if (!items.length) {
    $("#audit-log").innerHTML = '<div class="notice">No audit entries yet. Create, edit or delete a post to see hooks in action.</div>';
    return;
  }
  $("#audit-log").innerHTML = items.map((e) =>
    `<div class="m-row"><div class="m-info"><div class="m-title"><span class="tag" style="background:var(--surface-3);color:var(--text-muted)">${esc(e.event || "")}</span> &nbsp; ${esc(e.entity || "")} <span style="color:var(--text-faint)">${esc(e.entity_id || "").slice(0, 8)}...</span></div><div class="m-meta">${esc(e.actor || "system")} · ${fmtDate(e.timestamp)}</div></div></div>`
  ).join("");
}

export function bindManageEvents() {
  $("#manage-tabs").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-scope]");
    if (!btn) return;
    $$("#manage-tabs button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    setState("manageScope", btn.dataset.scope);
    loadManage();
  });

  $("#manage-list").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.action === "edit") go(`compose/${id}`);
    if (btn.dataset.action === "delete") deletePost(id);
    if (btn.dataset.action === "publish") setPostStatus(id, "published");
    if (btn.dataset.action === "archive") setPostStatus(id, "archived");
    if (btn.dataset.action === "to-draft") setPostStatus(id, "draft");
    if (btn.dataset.action === "restore") restorePost(id);
  });

  $("#pending-comments").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.action === "approve") approveComment(id, true);
    if (btn.dataset.action === "keep-pending") approveComment(id, false);
  });
}
