const MAX_DIMENSION = 1200;
const JPEG_QUALITY = 0.75;
const MAX_RAW_SIZE = 10 * 1024 * 1024;

/**
 * Resize + compress an image File to a base64 data URI.
 * Returns { dataUri, width, height } or throws on invalid input.
 */
export function processImage(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) {
      reject(new Error("Not an image file"));
      return;
    }
    if (file.size > MAX_RAW_SIZE) {
      reject(new Error("Image exceeds 10 MB limit"));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Failed to decode image"));
      img.onload = () => {
        let { width, height } = img;

        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
          const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);

        const keepPng = file.type === "image/png" || file.type === "image/svg+xml";
        const mime = keepPng ? "image/png" : "image/jpeg";
        const quality = keepPng ? undefined : JPEG_QUALITY;
        const dataUri = canvas.toDataURL(mime, quality);

        resolve({ dataUri, width, height });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Extract image Files from a ClipboardEvent or DragEvent.
 */
export function extractImageFiles(event) {
  const files = [];
  const items = event.clipboardData?.items || event.dataTransfer?.items;
  if (items) {
    for (const item of items) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
  }
  if (!files.length && event.dataTransfer?.files) {
    for (const f of event.dataTransfer.files) {
      if (f.type.startsWith("image/")) files.push(f);
    }
  }
  return files;
}
