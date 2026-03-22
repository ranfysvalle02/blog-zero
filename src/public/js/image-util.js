const MAX_DIMENSION = 1200;
const COVER_WIDTH = 1200;
const COVER_HEIGHT = 675;
const MAX_RAW_SIZE = 10 * 1024 * 1024;

const TARGET_BYTES = 120 * 1024;
const INITIAL_QUALITY = 0.72;
const MIN_QUALITY = 0.30;
const QUALITY_STEP = 0.08;

/**
 * Compress a canvas to JPEG, stepping down quality until the data URI
 * is under TARGET_BYTES. Returns the data URI string.
 */
function compressCanvas(canvas, startQuality = INITIAL_QUALITY) {
  let q = startQuality;
  let uri = canvas.toDataURL("image/jpeg", q);

  while (uri.length > TARGET_BYTES && q > MIN_QUALITY) {
    q -= QUALITY_STEP;
    uri = canvas.toDataURL("image/jpeg", q);
  }

  if (uri.length > TARGET_BYTES && canvas.width > 800) {
    const scale = 0.7;
    const w = Math.round(canvas.width * scale);
    const h = Math.round(canvas.height * scale);
    const small = document.createElement("canvas");
    small.width = w;
    small.height = h;
    small.getContext("2d").drawImage(canvas, 0, 0, w, h);
    q = Math.max(startQuality - 0.05, MIN_QUALITY);
    uri = small.toDataURL("image/jpeg", q);
    while (uri.length > TARGET_BYTES && q > MIN_QUALITY) {
      q -= QUALITY_STEP;
      uri = small.toDataURL("image/jpeg", q);
    }
  }

  return uri;
}

/**
 * Resize + compress an image File to a JPEG data URI.
 * Always outputs JPEG regardless of input format.
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
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);

        const dataUri = compressCanvas(canvas);
        resolve({ dataUri, width, height });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Resize + center-crop an image to 16:9 cover dimensions, output JPEG.
 */
export function processCoverImage(file) {
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
        const targetRatio = COVER_WIDTH / COVER_HEIGHT;
        const srcRatio = img.width / img.height;

        let sx = 0, sy = 0, sw = img.width, sh = img.height;
        if (srcRatio > targetRatio) {
          sw = Math.round(img.height * targetRatio);
          sx = Math.round((img.width - sw) / 2);
        } else {
          sh = Math.round(img.width / targetRatio);
          sy = Math.round((img.height - sh) / 2);
        }

        const canvas = document.createElement("canvas");
        canvas.width = COVER_WIDTH;
        canvas.height = COVER_HEIGHT;
        canvas.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, COVER_WIDTH, COVER_HEIGHT);

        const dataUri = compressCanvas(canvas);
        resolve({ dataUri, width: COVER_WIDTH, height: COVER_HEIGHT });
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
