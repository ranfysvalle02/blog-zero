(function () {
  var saved = localStorage.getItem("blog-zero-theme");
  if (!saved) localStorage.setItem("blog-zero-theme", "dark");
  if (saved === "light") document.documentElement.setAttribute("data-theme", "light");

  function toggleTheme() {
    var isLight = document.documentElement.getAttribute("data-theme") === "light";
    if (isLight) {
      document.documentElement.removeAttribute("data-theme");
      localStorage.setItem("blog-zero-theme", "dark");
    } else {
      document.documentElement.setAttribute("data-theme", "light");
      localStorage.setItem("blog-zero-theme", "light");
    }
    syncToggles();
  }

  function syncToggles() {
    var isLight = document.documentElement.getAttribute("data-theme") === "light";
    document.querySelectorAll(".theme-toggle").forEach(function (b) {
      b.setAttribute("aria-checked", !isLight);
      b.setAttribute("aria-label", isLight ? "Switch to dark mode" : "Switch to light mode");
    });
  }

  syncToggles();

  var desktopToggle = document.querySelector(".theme-toggle.desktop-only");
  if (desktopToggle) desktopToggle.addEventListener("click", toggleTheme);

  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-auth-redirect]");
    if (!btn) return;
    localStorage.setItem("blog-zero-auth", btn.dataset.authRedirect);
  });

  var hamburger = document.getElementById("hamburger");
  if (!hamburger) return;

  var backdrop = document.createElement("div");
  backdrop.className = "drawer-backdrop";
  document.body.appendChild(backdrop);

  var drawer = document.createElement("div");
  drawer.className = "mobile-drawer";
  document.body.appendChild(drawer);

  var activePath = location.pathname;

  function buildDrawer() {
    var isLight = document.documentElement.getAttribute("data-theme") === "light";
    var links = [
      { label: "Home", href: "/#home" },
      { label: "Blog", href: "/#blog" },
      { label: "About", href: "/public/about.html" },
      { label: "Write", href: "/#compose" },
    ];
    drawer.innerHTML =
      '<div class="drawer-header">' +
      '<a class="drawer-brand" href="/#home"><img src="/public/zero-logo.png" alt="">blog-zero</a>' +
      '<button class="drawer-close" aria-label="Close menu">&times;</button></div>' +
      '<nav class="drawer-nav">' +
      links.map(function (l) {
        var active = l.href === activePath ? " active" : "";
        return '<a class="drawer-link' + active + '" href="' + l.href + '">' + l.label + "</a>";
      }).join("") +
      "</nav>" +
      '<div class="drawer-footer">' +
      '<div class="drawer-auth">' +
      '<a href="/#home" class="btn btn-outline" data-auth-redirect="login">Sign in</a>' +
      '<a href="/#home" class="btn btn-primary" data-auth-redirect="register">Register</a>' +
      "</div>" +
      '<div class="drawer-theme"><span>Dark mode</span>' +
      '<button class="theme-toggle" aria-label="Toggle dark mode" role="switch" aria-checked="' + !isLight + '">' +
      '<span class="toggle-track"><span class="toggle-icon">&#9790;</span><span class="toggle-icon">&#9788;</span><span class="toggle-thumb"></span></span>' +
      "</button></div></div>";
  }

  function openDrawer() {
    buildDrawer();
    requestAnimationFrame(function () {
      drawer.classList.add("open");
      backdrop.classList.add("active");
      document.body.style.overflow = "hidden";
    });
  }

  function closeDrawer() {
    drawer.classList.remove("open");
    backdrop.classList.remove("active");
    document.body.style.overflow = "";
  }

  hamburger.addEventListener("click", function () {
    drawer.classList.contains("open") ? closeDrawer() : openDrawer();
  });

  backdrop.addEventListener("click", closeDrawer);

  drawer.addEventListener("click", function (e) {
    if (e.target.closest(".drawer-close")) { closeDrawer(); return; }
    if (e.target.closest("a")) { closeDrawer(); return; }
    if (e.target.closest(".theme-toggle")) {
      toggleTheme();
      buildDrawer();
      drawer.classList.add("open");
    }
  });
})();
