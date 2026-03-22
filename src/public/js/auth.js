import { $, $$, UI_CONFIG, state, setState, esc, toast, api, isAuthed, isAdmin, go } from "./utils.js";

let backdrop;

function ensureBackdrop() {
  if (backdrop) return;
  backdrop = document.createElement("div");
  backdrop.className = "auth-backdrop";
  backdrop.id = "auth-backdrop";
  document.body.appendChild(backdrop);
  backdrop.addEventListener("click", hideAuthPanel);
}

function updateSwitchLink() {
  const el = $("#auth-switch");
  if (!el) return;
  if (state.authMode === "register") {
    el.innerHTML = `Already have an account? <a href="#" data-action="switch-to-login">Sign in</a>`;
  } else {
    el.innerHTML = `Don\u2019t have an account? <a href="#" data-action="switch-to-register">Register</a>`;
  }
}

export function renderAuthArea() {
  const area = $("#auth-area");
  if (!isAuthed()) {
    area.innerHTML =
      `<button class="btn btn-outline btn-sm" data-action="sign-in">${esc(UI_CONFIG.labels.signIn)}</button>` +
      `<button class="btn btn-primary btn-sm" data-action="register">${esc(UI_CONFIG.labels.register)}</button>`;
    $$(".admin-only").forEach((el) => el.classList.add("hidden"));
    return;
  }
  const u = state.session?.user || {};
  area.innerHTML =
    `<span class="auth-user">${esc(u.email)} (${esc(u.role || "guest")})</span>` +
    `<button class="btn btn-outline btn-sm" data-action="logout">${esc(UI_CONFIG.labels.logout)}</button>`;
  if (isAdmin()) $$(".admin-only").forEach((el) => el.classList.remove("hidden"));
  else $$(".admin-only").forEach((el) => el.classList.add("hidden"));
}

export function showAuthPanel(mode) {
  ensureBackdrop();
  setState("authMode", mode);
  const panel = $("#auth-panel");
  backdrop.classList.add("active");
  panel.classList.add("active");
  panel.inert = false;
  panel.removeAttribute("aria-hidden");
  document.body.style.overflow = "hidden";

  const isRegister = mode === "register";
  $("#auth-panel-title").textContent = isRegister ? "Create account" : "Sign in";
  const subtitle = $("#auth-subtitle");
  if (isRegister) {
    subtitle.innerHTML = 'Join blog-zero \u00b7 By registering you agree to our <a href="/public/community.html" target="_blank">community guidelines</a>';
  } else {
    subtitle.textContent = "Welcome back to blog-zero";
  }
  $("#auth-name-row").classList.toggle("hidden", !isRegister);
  $("#auth-submit").textContent = isRegister ? "Create account" : "Sign in";
  updateSwitchLink();

  setTimeout(() => (isRegister ? $("#auth-name") : $("#auth-email")).focus(), 80);
}

export function hideAuthPanel() {
  if (document.activeElement?.closest("#auth-panel")) document.activeElement.blur();
  const panel = $("#auth-panel");
  panel.classList.remove("active");
  panel.inert = true;
  document.body.style.overflow = "";
  if (backdrop) backdrop.classList.remove("active");
}

export async function refreshSession() {
  const r = await api("session");
  setState("session", r.data || { authenticated: false, user: null });
  renderAuthArea();
}

export async function handleAuthSubmit() {
  const email = $("#auth-email").value.trim().toLowerCase();
  const password = $("#auth-password").value.trim();
  const name = $("#auth-name").value.trim();
  if (!email || !password) { toast("Email and password required", "err"); return; }

  const mode = state.authMode;
  const body = mode === "register" ? { email, password, name } : { email, password };
  const r = await api(mode === "register" ? "register" : "login", { body });
  if (!r.ok) { toast(r.data?.detail || "Auth failed", "err"); return; }

  await refreshSession();
  hideAuthPanel();
  $("#auth-email").value = "";
  $("#auth-password").value = "";
  $("#auth-name").value = "";
  toast(mode === "register" ? "Welcome!" : "Signed in");
  window.dispatchEvent(new Event("feed:refresh"));
}

export async function logout() {
  await api("logout", { body: {} });
  await refreshSession();
  toast("Signed out", "info");
  go("feed");
}

export function bindAuthEvents() {
  $("#auth-area").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    if (btn.dataset.action === "sign-in") showAuthPanel("login");
    if (btn.dataset.action === "register") showAuthPanel("register");
    if (btn.dataset.action === "logout") logout().catch(() => {});
  });

  $("#auth-submit").addEventListener("click", () => handleAuthSubmit().catch(() => {}));

  const closeBtn = $("#auth-close");
  if (closeBtn) closeBtn.addEventListener("click", hideAuthPanel);

  $("#auth-panel").addEventListener("click", (e) => {
    const link = e.target.closest("[data-action]");
    if (!link) return;
    e.preventDefault();
    if (link.dataset.action === "switch-to-login") showAuthPanel("login");
    if (link.dataset.action === "switch-to-register") showAuthPanel("register");
  });

  $("#auth-password").addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleAuthSubmit().catch(() => {});
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && $("#auth-panel").classList.contains("active")) hideAuthPanel();
  });
}
