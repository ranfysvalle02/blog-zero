import { BLOG_CONFIG } from "./utils.js";

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
  let image = defaultImg;

  if (view === "home") {
    title = siteName;
  } else if (view === "blog") {
    title = `Browse posts — ${siteName}`;
    description = `Browse and search all posts on ${siteName}.`;
  } else if (view === "article" && data) {
    title = `${data.title || "Post"} — ${siteName}`;
    description = data.excerpt || defaultDesc;
    type = "article";
    url = `${location.origin}/posts/${encodeURIComponent(data._id || "")}`;
    if (data.cover_image && !data.cover_image.startsWith("data:")) image = data.cover_image;
  }

  document.title = title;
  setMeta("description", description);
  setMeta("og:title", title);
  setMeta("og:description", description);
  setMeta("og:type", type);
  setMeta("og:url", url);
  if (image && !image.startsWith("data:")) {
    setMeta("og:image", image);
    setMeta("twitter:image", image);
  }
  setMeta("og:site_name", siteName);

  if (view === "article" && data) {
    setJsonLd({
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      "headline": data.title || "",
      "datePublished": data.created_at || "",
      "author": { "@type": "Person", "name": data.author || "Anonymous" },
      "publisher": { "@type": "Organization", "name": siteName },
      "url": url,
    });
  } else {
    setJsonLd({
      "@context": "https://schema.org",
      "@type": "Blog",
      "name": siteName,
      "description": defaultDesc,
      "url": location.origin,
    });
  }
}
