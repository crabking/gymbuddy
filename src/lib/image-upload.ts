const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 3 * 1024 * 1024;
const MAX_EDGE = 1600;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("This photo format is not supported. Try a JPG or PNG."));
    };
    image.src = url;
  });
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("The photo could not be prepared."));
      },
      "image/jpeg",
      quality,
    );
  });
}

export async function prepareChatImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error("That photo is too large. Choose one under 25 MB.");
  }

  const source = await loadImage(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(source.naturalWidth, source.naturalHeight));
  const width = Math.max(1, Math.round(source.naturalWidth * scale));
  const height = Math.max(1, Math.round(source.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Photo processing is unavailable on this device.");
  context.drawImage(source, 0, 0, width, height);

  let blob = await canvasBlob(canvas, 0.82);
  if (blob.size > MAX_OUTPUT_BYTES) blob = await canvasBlob(canvas, 0.68);
  if (blob.size > MAX_OUTPUT_BYTES) blob = await canvasBlob(canvas, 0.52);
  if (blob.size > MAX_OUTPUT_BYTES) {
    throw new Error("That photo is still too large after resizing. Try a closer crop.");
  }

  const stem = file.name.replace(/\.[^.]+$/, "") || "photo";
  return new File([blob], `${stem}.jpg`, {
    type: "image/jpeg",
    lastModified: file.lastModified,
  });
}
