import { BLOG_CONFIG, excerpt } from "./utils.js";

function setMeta(name, content) {
  let el = document.querySelector(`meta[name="${name}"]`) || document.querySelector(`meta[property="${name}"]`);
  if (!el) {
    el = document.createElement("meta");
    if (name.startsWith("og:")) el.setAttribute("property", name);
    else el.setAttribute("name", name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setJsonLd(obj) {
  let el = document.getElementById("jsonld");
  if (!el) {
    el = document.createElement("script");
    el.id = "jsonld";
    el.type = "application/ld+json";
    document.head.appendChild(el);
  }
  el.textContent = JSON.stringify(obj);
}

const cfg = BLOG_CONFIG.seo || {};
const siteName = cfg.siteName || BLOG_CONFIG.brand.text;
const defaultDesc = cfg.defaultDescription || BLOG_CONFIG.tagline || "";
const defaultImg = cfg.defaultImage || "";

export function updateSeo(view, data) {
  let title = siteName;
  let description = defaultDesc;
  let type = "website";
  let url = location.href;

  if (view === "home") {
    title = siteName;
  } else if (view === "blog") {
    title = `Browse posts — ${siteName}`;
    description = `Browse and search all posts on ${siteName}.`;
  } else if (view === "article" && data) {
    title = `${data.title} — ${siteName}`;
    description = excerpt(data.body, 160) || defaultDesc;
    type = "article";
    setJsonLd({
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      "headline": data.title,
      "author": { "@type": "Person", "name": data.author || "Anonymous" },
      "datePublished": data.created_at,
      "description": description,
    });
  }

  document.title = title;
  setMeta("description", description);
  setMeta("og:title", title);
  setMeta("og:description", description);
  setMeta("og:type", type);
  setMeta("og:url", url);
  if (defaultImg) setMeta("og:image", defaultImg);
  setMeta("og:site_name", siteName);

  if (view !== "article") {
    setJsonLd({
      "@context": "https://schema.org",
      "@type": "Blog",
      "name": siteName,
      "description": defaultDesc,
      "url": location.origin,
    });
  }
}
