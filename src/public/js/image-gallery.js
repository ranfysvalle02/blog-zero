/**
 * Image Gallery System
 * Creates beautiful carousels/lightboxes for post images
 *
 * Features:
 * - Auto-groups images into galleries (2+ images close together)
 * - Carousel with dots, navigation arrows, and counter
 * - Full-screen lightbox with keyboard navigation (←/→/Esc)
 * - Standalone images become zoomable
 * - Smooth animations and transitions
 *
 * Usage:
 * - Called automatically by article-enhance.js
 * - enhanceImagesWithGallery(proseEl) - converts grouped images to carousels
 * - markStandaloneImagesZoomable(proseEl) - makes solo images zoomable
 */

let _lightbox = null;
let _currentImages = [];
let _currentIndex = 0;

/**
 * Extract all images from markdown content and create a gallery
 */
export function enhanceImagesWithGallery(proseEl) {
  const images = [...proseEl.querySelectorAll("img")];
  if (images.length === 0) return;

  // Group images that are close together (within 2 paragraphs) into galleries
  const galleries = [];
  let currentGallery = [];
  let lastImageIndex = -1;

  images.forEach((img, idx) => {
    const imgIndex = Array.from(proseEl.children).indexOf(img.closest("p") || img);

    if (lastImageIndex === -1 || imgIndex - lastImageIndex <= 3) {
      currentGallery.push(img);
    } else {
      if (currentGallery.length >= 2) {
        galleries.push([...currentGallery]);
      }
      currentGallery = [img];
    }
    lastImageIndex = imgIndex;
  });

  if (currentGallery.length >= 2) {
    galleries.push(currentGallery);
  }

  // Convert galleries to carousels
  galleries.forEach((galleryImages, gIdx) => {
    const container = document.createElement("div");
    container.className = "image-gallery";
    container.dataset.galleryId = `gallery-${gIdx}`;

    const carousel = document.createElement("div");
    carousel.className = "gallery-carousel";

    const track = document.createElement("div");
    track.className = "gallery-track";

    galleryImages.forEach((img, idx) => {
      const slide = document.createElement("div");
      slide.className = "gallery-slide";
      if (idx === 0) slide.classList.add("active");

      const imgClone = img.cloneNode();
      imgClone.classList.add("gallery-img");
      imgClone.dataset.slideIndex = idx;
      slide.appendChild(imgClone);

      const caption = img.alt ? `<div class="gallery-caption">${escapeHtml(img.alt)}</div>` : "";
      if (caption) slide.innerHTML += caption;

      track.appendChild(slide);

      // Remove original image
      const parent = img.parentElement;
      if (parent && parent.tagName === "P" && parent.childNodes.length === 1) {
        parent.remove();
      } else {
        img.remove();
      }
    });

    carousel.appendChild(track);

    // Add navigation dots
    if (galleryImages.length > 1) {
      const dots = document.createElement("div");
      dots.className = "gallery-dots";
      for (let i = 0; i < galleryImages.length; i++) {
        const dot = document.createElement("button");
        dot.className = "gallery-dot";
        if (i === 0) dot.classList.add("active");
        dot.setAttribute("aria-label", `View image ${i + 1}`);
        dot.dataset.index = i;
        dots.appendChild(dot);
      }
      carousel.appendChild(dots);

      // Add prev/next buttons
      const prevBtn = document.createElement("button");
      prevBtn.className = "gallery-nav gallery-nav-prev";
      prevBtn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg>';
      prevBtn.setAttribute("aria-label", "Previous image");

      const nextBtn = document.createElement("button");
      nextBtn.className = "gallery-nav gallery-nav-next";
      nextBtn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>';
      nextBtn.setAttribute("aria-label", "Next image");

      carousel.appendChild(prevBtn);
      carousel.appendChild(nextBtn);
    }

    // Add counter
    const counter = document.createElement("div");
    counter.className = "gallery-counter";
    counter.textContent = `1 / ${galleryImages.length}`;
    carousel.appendChild(counter);

    container.appendChild(carousel);

    // Insert gallery where first image was
    const firstImgParent = galleryImages[0].parentElement?.parentElement || proseEl;
    firstImgParent.insertBefore(container, firstImgParent.firstChild);
  });

  // Setup lightbox for ALL images (both gallery and standalone)
  initLightbox();

  // Bind carousel navigation
  bindCarouselEvents(proseEl);
}

/**
 * Navigate carousel
 */
function navigateCarousel(carousel, direction) {
  const slides = carousel.querySelectorAll(".gallery-slide");
  const dots = carousel.querySelectorAll(".gallery-dot");
  const counter = carousel.querySelector(".gallery-counter");
  const activeSlide = carousel.querySelector(".gallery-slide.active");
  const currentIdx = Array.from(slides).indexOf(activeSlide);
  let newIdx = currentIdx + direction;

  if (newIdx < 0) newIdx = slides.length - 1;
  if (newIdx >= slides.length) newIdx = 0;

  slides.forEach((s, i) => s.classList.toggle("active", i === newIdx));
  dots.forEach((d, i) => d.classList.toggle("active", i === newIdx));
  counter.textContent = `${newIdx + 1} / ${slides.length}`;
}

/**
 * Bind carousel navigation events
 */
function bindCarouselEvents(proseEl) {
  proseEl.addEventListener("click", (e) => {
    const nav = e.target.closest(".gallery-nav");
    if (nav) {
      const carousel = nav.closest(".gallery-carousel");
      const direction = nav.classList.contains("gallery-nav-prev") ? -1 : 1;
      navigateCarousel(carousel, direction);
      return;
    }

    const dot = e.target.closest(".gallery-dot");
    if (dot) {
      const carousel = dot.closest(".gallery-carousel");
      const slides = carousel.querySelectorAll(".gallery-slide");
      const dots = carousel.querySelectorAll(".gallery-dot");
      const counter = carousel.querySelector(".gallery-counter");
      const idx = parseInt(dot.dataset.index);

      slides.forEach((s, i) => s.classList.toggle("active", i === idx));
      dots.forEach((d, i) => d.classList.toggle("active", i === idx));
      counter.textContent = `${idx + 1} / ${slides.length}`;
      return;
    }

    const img = e.target.closest(".gallery-img, .zoomable");
    if (img) {
      openLightbox(img);
    }
  });

  // Keyboard navigation
  proseEl.addEventListener("keydown", (e) => {
    const carousel = e.target.closest(".gallery-carousel");
    if (!carousel) return;
    if (e.key === "ArrowLeft") {
      navigateCarousel(carousel, -1);
      e.preventDefault();
    } else if (e.key === "ArrowRight") {
      navigateCarousel(carousel, 1);
      e.preventDefault();
    }
  });
}

/**
 * Initialize lightbox for full-screen image viewing
 */
function initLightbox() {
  if (_lightbox) return;

  _lightbox = document.createElement("div");
  _lightbox.className = "image-lightbox";
  _lightbox.innerHTML = `
    <div class="lightbox-backdrop"></div>
    <div class="lightbox-content">
      <button class="lightbox-close" aria-label="Close">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
      <button class="lightbox-nav lightbox-nav-prev" aria-label="Previous">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M15 18l-6-6 6-6"/>
        </svg>
      </button>
      <button class="lightbox-nav lightbox-nav-next" aria-label="Next">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M9 18l6-6-6-6"/>
        </svg>
      </button>
      <img class="lightbox-img" src="" alt="">
      <div class="lightbox-caption"></div>
      <div class="lightbox-counter"></div>
    </div>
  `;
  document.body.appendChild(_lightbox);

  // Event handlers
  const close = () => {
    _lightbox.classList.remove("active");
    _currentImages = [];
    _currentIndex = 0;
  };

  _lightbox.querySelector(".lightbox-backdrop").addEventListener("click", close);
  _lightbox.querySelector(".lightbox-close").addEventListener("click", close);

  _lightbox.querySelector(".lightbox-nav-prev").addEventListener("click", () => {
    navigateLightbox(-1);
  });

  _lightbox.querySelector(".lightbox-nav-next").addEventListener("click", () => {
    navigateLightbox(1);
  });

  _lightbox.querySelector(".lightbox-img").addEventListener("click", (e) => {
    e.stopPropagation();
  });

  document.addEventListener("keydown", (e) => {
    if (!_lightbox.classList.contains("active")) return;
    if (e.key === "Escape") close();
    if (e.key === "ArrowLeft") navigateLightbox(-1);
    if (e.key === "ArrowRight") navigateLightbox(1);
  });
}

/**
 * Open lightbox with specific image
 */
function openLightbox(img) {
  const proseEl = img.closest(".prose");
  if (!proseEl) return;

  _currentImages = [...proseEl.querySelectorAll("img, .gallery-img")];
  _currentIndex = _currentImages.indexOf(img);

  showLightboxImage();
  _lightbox.classList.add("active");
}

/**
 * Navigate lightbox between images
 */
function navigateLightbox(direction) {
  if (_currentImages.length === 0) return;

  _currentIndex += direction;
  if (_currentIndex < 0) _currentIndex = _currentImages.length - 1;
  if (_currentIndex >= _currentImages.length) _currentIndex = 0;

  showLightboxImage();
}

/**
 * Display current image in lightbox
 */
function showLightboxImage() {
  if (_currentImages.length === 0) return;

  const img = _currentImages[_currentIndex];
  const lbImg = _lightbox.querySelector(".lightbox-img");
  const lbCaption = _lightbox.querySelector(".lightbox-caption");
  const lbCounter = _lightbox.querySelector(".lightbox-counter");
  const navPrev = _lightbox.querySelector(".lightbox-nav-prev");
  const navNext = _lightbox.querySelector(".lightbox-nav-next");

  lbImg.src = img.src;
  lbImg.alt = img.alt;
  lbCaption.textContent = img.alt || "";

  if (_currentImages.length > 1) {
    lbCounter.textContent = `${_currentIndex + 1} / ${_currentImages.length}`;
    lbCounter.style.display = "block";
    navPrev.style.display = "flex";
    navNext.style.display = "flex";
  } else {
    lbCounter.style.display = "none";
    navPrev.style.display = "none";
    navNext.style.display = "none";
  }
}

/**
 * Mark standalone images as zoomable
 */
export function markStandaloneImagesZoomable(proseEl) {
  proseEl.querySelectorAll("img").forEach((img) => {
    if (!img.closest(".image-gallery")) {
      img.classList.add("zoomable");
    }
  });
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Compose: Drag-and-drop reordering for images in markdown
 */
export function enableImageReordering(textareaEl) {
  // This will be handled via a UI overlay in the compose view
  // For now, users can manually cut/paste markdown image syntax
  console.log("Image reordering enabled for textarea", textareaEl);
}
