import { $, $$, BLOG_CONFIG, UI_CONFIG, state, setState, esc, hasRole, isAuthed } from "./utils.js";
import { bindAuthEvents, refreshSession, showAuthPanel } from "./auth.js";
import { bindArticleEvents, handleArticleRoute } from "./feed.js";
import { bindHomeEvents, loadHome } from "./home.js";
import { bindBlogEvents, loadBlog } from "./blog.js";
import { bindComposeEvents, handleComposeRoute } from "./compose.js";
import { bindManageEvents, handleManageRoute } from "./manage.js";
import { updateSeo } from "./seo.js";

// --- Legacy /s/ URL migration: rewrite to clean path before anything runs ---
(function migrateLegacyUrl() {
  const m = location.pathname.match(/^\/s\/posts\/([^/]+)$/);
  if (m) {
    history.replaceState(null, "", "/posts/" + m[1] + location.hash);
    return;
  }
  if (location.pathname === "/s" || location.pathname === "/s/") {
    history.replaceState(null, "", "/" + location.hash);
  }
})();

// --- SSR data: consumed once on first boot, then discarded ---
let ssrData = null;
(function consumeSSRData() {
  const el = document.getElementById("ssr-data");
  if (!el) return;
  try { ssrData = JSON.parse(el.textContent); } catch { /* ignore */ }
  el.remove();
})();

const HASH_ROUTES = new Set(["blog", "compose", "manage", "feed"]);

function getCurrentRoute() {
  const hash = location.hash.slice(1);
  if (hash) {
    const [view, ...rest] = hash.split("/");
    if (HASH_ROUTES.has(view)) return { view, param: rest.join("/") };
  }
  const m = location.pathname.match(/^\/posts\/([^/]+)$/);
  if (m) return { view: "article", param: decodeURIComponent(m[1]) };
  return { view: "home", param: "" };
}

export function navigate(pathOrView, param) {
  if (pathOrView === "home" || pathOrView === "/") {
    if (location.pathname !== "/") {
      history.pushState(null, "", "/");
    } else if (location.hash) {
      history.pushState(null, "", "/");
    }
    handleRoute().catch(() => {});
    return;
  }

  if (pathOrView === "article" || pathOrView.startsWith("/posts/")) {
    const id = param || pathOrView.replace(/^\/posts\//, "");
    const target = "/posts/" + encodeURIComponent(id);
    if (location.pathname !== target) {
      history.pushState(null, "", target);
    }
    handleRoute().catch(() => {});
    return;
  }

  if (HASH_ROUTES.has(pathOrView)) {
    if (location.pathname !== "/") {
      location.href = "/#" + pathOrView + (param ? "/" + param : "");
      return;
    }
    location.hash = pathOrView + (param ? "/" + param : "");
    return;
  }

  location.hash = pathOrView + (param ? "/" + param : "");
}

function roleGuard(view) {
  if (view === "compose" && !hasRole("editor")) {
    showAuthPanel("login");
    navigate("home");
    return false;
  }
  if (view === "manage" && !hasRole("editor") && !hasRole("moderator")) {
    showAuthPanel("login");
    navigate("home");
    return false;
  }
  return true;
}

let initialLoad = true;

function updateRouteUi(view) {
  $$("#nav-links [data-route]").forEach((btn) => {
    const on = btn.dataset.route === view;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-selected", on);
  });
  $$(".view").forEach((v) => v.classList.remove("active"));
  const target = $(`#view-${view}`);
  if (target) {
    target.classList.add("active");
    if (!initialLoad) {
      const heading = target.querySelector("[tabindex='-1']");
      if (heading) heading.focus();
    }
  }
}

let lastProcessedUrl = "";

async function handleRoute() {
  const url = location.pathname + location.hash;
  if (url === lastProcessedUrl && !initialLoad) return;
  lastProcessedUrl = url;

  const { view, param } = getCurrentRoute();
  if (!roleGuard(view)) return;
  setState("currentView", view);

  if (!initialLoad && document.startViewTransition) {
    const t = document.startViewTransition(() => updateRouteUi(view));
    t.finished.catch(() => {});
  } else {
    updateRouteUi(view);
  }

  let data = null;
  if (view === "home") {
    const ssrPosts = ssrData?.route === "home" ? ssrData.posts : null;
    const ssrTags = ssrData?.route === "home" ? ssrData.tag_stats : null;
    data = await loadHome(ssrPosts);
    ssrData = null;
  } else if (view === "article") {
    const ssrPost = ssrData?.route === "article" ? ssrData.post : null;
    const ssrComments = ssrData?.route === "article" ? ssrData.comments : null;
    data = await handleArticleRoute(param, ssrPost, ssrComments);
    ssrData = null;
  } else if (view === "blog") {
    data = await loadBlog();
  } else if (view === "feed") {
    navigate("blog");
    return;
  } else if (view === "compose") {
    data = await handleComposeRoute(param);
  } else if (view === "manage") {
    data = await handleManageRoute(param);
  }

  updateSeo(view, data);
  if (!initialLoad) window.scrollTo(0, 0);
  initialLoad = false;
}

function bindNav() {
  $("#nav-links").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-route]");
    if (!btn) return;
    navigate(btn.dataset.route);
  });
}

function initLinkInterceptor() {
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[href]");
    if (!a) return;
    const href = a.getAttribute("href");
    if (!href) return;

    const postMatch = href.match(/^\/posts\/([^#?]+)/);
    if (postMatch) {
      e.preventDefault();
      navigate("article", decodeURIComponent(postMatch[1]));
      return;
    }

    if (href === "/") {
      e.preventDefault();
      navigate("home");
      return;
    }

    if (href.startsWith("/#")) {
      const route = href.slice(2);
      if (HASH_ROUTES.has(route)) {
        e.preventDefault();
        navigate(route);
        return;
      }
    }
  });
}

function initThemeToggle() {
  const saved = localStorage.getItem("blog-zero-theme");
  if (!saved) localStorage.setItem("blog-zero-theme", "dark");
  if (saved === "light") document.documentElement.setAttribute("data-theme", "light");

  const btn = $("#theme-toggle");
  if (!btn) return;

  function updateToggle() {
    const isLight = document.documentElement.getAttribute("data-theme") === "light";
    btn.setAttribute("aria-checked", !isLight);
    btn.setAttribute("aria-label", isLight ? "Switch to dark mode" : "Switch to light mode");
  }
  updateToggle();

  btn.addEventListener("click", () => {
    const isLight = document.documentElement.getAttribute("data-theme") === "light";
    if (isLight) {
      document.documentElement.removeAttribute("data-theme");
      localStorage.setItem("blog-zero-theme", "dark");
    } else {
      document.documentElement.setAttribute("data-theme", "light");
      localStorage.setItem("blog-zero-theme", "light");
    }
    updateToggle();
  });
}

function initHamburger() {
  const btn = $("#hamburger");
  if (!btn) return;

  const backdrop = document.createElement("div");
  backdrop.className = "drawer-backdrop";
  document.body.appendChild(backdrop);

  const drawer = document.createElement("div");
  drawer.className = "mobile-drawer";
  drawer.id = "mobile-drawer";
  document.body.appendChild(drawer);

  function buildDrawer() {
    const isLight = document.documentElement.getAttribute("data-theme") === "light";
    const logoSrc = BLOG_CONFIG.brand.logo || "/public/zero-logo.png";
    const brandText = esc(BLOG_CONFIG.brand.text || "blog-zero");
    const currentView = getCurrentRoute().view;

    const navItems = [
      { label: "Home", route: "home" },
      { label: "Blog", route: "blog" },
      { label: "About", href: "/about" },
    ];
    if (hasRole("editor")) navItems.push({ label: "Write", route: "compose" });
    if (hasRole("editor") || hasRole("moderator")) navItems.push({ label: "Manage", route: "manage" });

    const linksHtml = navItems.map((item) => {
      if (item.href) {
        return `<a class="drawer-link" href="${item.href}">${item.label}</a>`;
      }
      const active = item.route === currentView ? " active" : "";
      return `<button class="drawer-link${active}" data-route="${item.route}">${item.label}</button>`;
    }).join("");

    let authHtml = "";
    if (!isAuthed()) {
      authHtml =
        `<div class="drawer-auth">` +
        `<button class="btn btn-outline" data-action="sign-in">${esc(UI_CONFIG.labels.signIn)}</button>` +
        `<button class="btn btn-primary" data-action="register">${esc(UI_CONFIG.labels.register)}</button>` +
        `</div>`;
    } else {
      const u = state.session?.user || {};
      authHtml =
        `<div class="drawer-auth">` +
        `<span class="auth-user flex-1">${esc(u.email)}</span>` +
        `<button class="btn btn-outline btn-sm" data-action="logout">${esc(UI_CONFIG.labels.logout)}</button>` +
        `</div>`;
    }

    drawer.innerHTML =
      `<div class="drawer-header">` +
      `<a class="drawer-brand" href="/">${logoSrc ? `<img src="${logoSrc}" alt="">` : ""}${brandText}</a>` +
      `</div>` +
      `<nav class="drawer-nav">${linksHtml}</nav>` +
      `<div class="drawer-footer">` +
      `<div class="drawer-theme">` +
      `<span>Dark mode</span>` +
      `<button class="theme-toggle" aria-label="Toggle dark mode" role="switch" aria-checked="${!isLight}">` +
      `<span class="toggle-track"><span class="toggle-icon">&#9790;</span><span class="toggle-icon">&#9788;</span><span class="toggle-thumb"></span></span>` +
      `</button>` +
      `</div>` +
      authHtml +
      `</div>`;
  }

  function openDrawer() {
    buildDrawer();
    requestAnimationFrame(() => {
      drawer.classList.add("open");
      backdrop.classList.add("active");
      btn.classList.add("active");
      btn.setAttribute("aria-expanded", "true");
      document.body.style.overflow = "hidden";
    });
  }

  function closeDrawer() {
    drawer.classList.remove("open");
    backdrop.classList.remove("active");
    btn.classList.remove("active");
    btn.setAttribute("aria-expanded", "false");
    document.body.style.overflow = "";
  }

  btn.addEventListener("click", () => {
    drawer.classList.contains("open") ? closeDrawer() : openDrawer();
  });

  backdrop.addEventListener("click", closeDrawer);

  drawer.addEventListener("click", (e) => {
    if (e.target.closest(".drawer-close")) { closeDrawer(); return; }

    const routeBtn = e.target.closest("[data-route]");
    if (routeBtn) {
      navigate(routeBtn.dataset.route);
      closeDrawer();
      return;
    }

    if (e.target.closest("a.drawer-link, a.drawer-brand")) {
      closeDrawer();
      return;
    }

    const themeBtn = e.target.closest(".theme-toggle");
    if (themeBtn) {
      const isLight = document.documentElement.getAttribute("data-theme") === "light";
      if (isLight) {
        document.documentElement.removeAttribute("data-theme");
        localStorage.setItem("blog-zero-theme", "dark");
      } else {
        document.documentElement.setAttribute("data-theme", "light");
        localStorage.setItem("blog-zero-theme", "light");
      }
      const mainToggle = document.querySelector("nav.top #theme-toggle");
      if (mainToggle) {
        const nowLight = document.documentElement.getAttribute("data-theme") === "light";
        mainToggle.setAttribute("aria-checked", !nowLight);
        mainToggle.setAttribute("aria-label", nowLight ? "Switch to dark mode" : "Switch to light mode");
      }
      buildDrawer();
      drawer.classList.add("open");
      return;
    }

    const authBtn = e.target.closest("[data-action]");
    if (authBtn) {
      closeDrawer();
      if (authBtn.dataset.action === "sign-in") showAuthPanel("login");
      if (authBtn.dataset.action === "register") showAuthPanel("register");
      if (authBtn.dataset.action === "logout") {
        import("./auth.js").then((m) => m.logout()).catch(() => {});
      }
    }
  });
}

function injectConfig() {
  document.title = BLOG_CONFIG.seo?.siteName || BLOG_CONFIG.brand.text;

  const brand = $("#nav-brand");
  const logoHtml = BLOG_CONFIG.brand.logo
    ? `<img src="${BLOG_CONFIG.brand.logo}" alt="" class="brand-logo">`
    : "";
  brand.innerHTML = `${logoHtml}<span>${esc(BLOG_CONFIG.brand.text)}</span>`;

  $("#btn-publish").textContent = UI_CONFIG.labels.publish;
  $("#btn-draft").textContent = UI_CONFIG.labels.saveDraft;

  if (BLOG_CONFIG.footer?.text) {
    $("#footer-text").textContent = BLOG_CONFIG.footer.text;
  }
}

async function boot() {
  initThemeToggle();
  initHamburger();
  injectConfig();
  bindNav();
  initLinkInterceptor();
  bindAuthEvents();
  bindHomeEvents();
  bindBlogEvents();
  bindArticleEvents();
  bindComposeEvents();
  bindManageEvents();

  window.addEventListener("feed:refresh", () => {
    const v = getCurrentRoute().view;
    if (v === "home") loadHome().catch(() => {});
    else if (v === "blog") loadBlog().catch(() => {});
  });

  await refreshSession();

  window.addEventListener("hashchange", () => handleRoute().catch(() => {}));
  window.addEventListener("popstate", () => handleRoute().catch(() => {}));
  handleRoute().catch(() => {});

  const pendingAuth = localStorage.getItem("blog-zero-auth");
  if (pendingAuth) {
    localStorage.removeItem("blog-zero-auth");
    showAuthPanel(pendingAuth === "register" ? "register" : "login");
  }
}

boot();
