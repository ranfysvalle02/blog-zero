import { $, BLOG_CONFIG, esc } from "./utils.js";

const gsap = window.gsap;

const CHEVRON_LEFT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4l-8 8 8 8"/></svg>';
const CHEVRON_RIGHT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4l8 8-8 8"/></svg>';

export function initHero() {
  const cfg = BLOG_CONFIG.hero;
  const el = $("#hero");
  if (!cfg?.enabled || !el) {
    if (el) el.remove();
    return;
  }

  const images = cfg.images || [];
  if (!images.length) { el.remove(); return; }

  if (images[0]) new Image().src = images[0];

  const headline = $("#hero-headline");
  const caption = $("#hero-caption");
  const slideA = $("#hero-slide-a");
  const slideB = $("#hero-slide-b");
  const dotsEl = $("#hero-dots");

  if (cfg.overlay) $("#hero-overlay").style.background = cfg.overlay;

  const words = (cfg.headline || "").split(/\s+/).filter(Boolean);
  headline.innerHTML = words
    .map((w) => `<span class="hero-word"><span class="hero-word-inner">${esc(w)}</span></span>`)
    .join(" ");
  caption.textContent = cfg.caption || "";

  slideA.style.backgroundImage = `url(${images[0]})`;

  const interval = cfg.interval || 6000;

  if (gsap) {
    initGsap(el, slideA, slideB, caption, images, dotsEl, interval);
  } else {
    slideA.style.opacity = "1";
    slideB.style.opacity = "0";
    setupSlideshow(el, slideA, slideB, images, dotsEl, interval, (incoming, outgoing) => {
      outgoing.style.opacity = "0";
      incoming.style.opacity = "1";
    });
  }
}

function initGsap(el, slideA, slideB, caption, images, dotsEl, interval) {
  gsap.set(slideA, { opacity: 1, scale: 1, xPercent: 0, yPercent: 0 });
  gsap.set(slideB, { opacity: 0 });

  function randomKB() {
    return {
      scale: 1.04 + Math.random() * 0.06,
      xPercent: (Math.random() - 0.5) * 4,
      yPercent: (Math.random() - 0.5) * 3,
    };
  }

  gsap.to(slideA, { ...randomKB(), duration: interval / 1000, ease: "none" });

  const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
  tl.from(".hero-word-inner", {
    yPercent: 120, rotateX: -40, opacity: 0,
    duration: 1, stagger: 0.07,
  })
  .from(caption, { y: 20, opacity: 0, duration: 0.8 }, "-=0.5");

  const result = setupSlideshow(el, slideA, slideB, images, dotsEl, interval, (incoming, outgoing) => {
    gsap.killTweensOf(incoming);
    const kb = randomKB();
    gsap.set(incoming, { scale: 1, xPercent: 0, yPercent: 0 });
    gsap.to(outgoing, { opacity: 0, duration: 1.4, ease: "power2.inOut" });
    gsap.to(incoming, { opacity: 1, duration: 1.4, ease: "power2.inOut" });
    gsap.to(incoming, { ...kb, duration: interval / 1000, ease: "none" });
  });

  if (result?.dots) {
    tl.from(result.dots, {
      opacity: 0, scale: 0, duration: 0.35,
      stagger: 0.06, ease: "back.out(2)",
    }, "-=0.4");
  }
}

function setupSlideshow(el, slideA, slideB, images, dotsEl, interval, transition) {
  if (images.length <= 1) { if (dotsEl) dotsEl.remove(); return null; }

  images.forEach((_, i) => {
    const dot = document.createElement("button");
    dot.className = `hero-dot${i === 0 ? " active" : ""}`;
    dot.setAttribute("aria-label", `Slide ${i + 1}`);
    dotsEl.appendChild(dot);
  });
  const dots = [...dotsEl.querySelectorAll(".hero-dot")];

  const nav = document.createElement("div");
  nav.className = "hero-nav";
  nav.innerHTML =
    `<button class="hero-arrow hero-prev" aria-label="Previous slide">${CHEVRON_LEFT}</button>` +
    `<button class="hero-arrow hero-next" aria-label="Next slide">${CHEVRON_RIGHT}</button>`;
  el.appendChild(nav);

  let current = 0;
  let active = "a";

  function goTo(idx) {
    if (idx === current) return;
    current = ((idx % images.length) + images.length) % images.length;
    dots.forEach((d, i) => d.classList.toggle("active", i === current));

    const incoming = active === "a" ? slideB : slideA;
    const outgoing = active === "a" ? slideA : slideB;

    incoming.style.backgroundImage = `url(${images[current]})`;
    transition(incoming, outgoing);
    active = active === "a" ? "b" : "a";
  }

  let timer = setInterval(() => goTo(current + 1), interval);

  function resetTimer() {
    clearInterval(timer);
    timer = setInterval(() => goTo(current + 1), interval);
  }

  dotsEl.addEventListener("click", (e) => {
    const dot = e.target.closest(".hero-dot");
    if (!dot) return;
    const idx = dots.indexOf(dot);
    if (idx < 0 || idx === current) return;
    goTo(idx);
    resetTimer();
  });

  nav.addEventListener("click", (e) => {
    const btn = e.target.closest(".hero-arrow");
    if (!btn) return;
    goTo(current + (btn.classList.contains("hero-prev") ? -1 : 1));
    resetTimer();
  });

  return { dots };
}
