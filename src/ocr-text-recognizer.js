const MAX_IMAGE_EDGE = 2400;
const MAX_SOURCE_IMAGE_PIXELS = 40_000_000;

function setCanvasSize(canvas, width, height) {
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Your browser could not prepare this image for OCR.');
  }

  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  return context;
}

function reportWorkerProgress(onProgress, status, progress) {
  if (!onProgress) return;

  if (status === 'loading tesseract core') {
    onProgress('Loading the OCR engine…');
  } else if (status === 'loading language traineddata') {
    onProgress('Downloading the English OCR model; the first scan may take a moment…');
  } else if (status === 'initializing tesseract') {
    onProgress('Preparing OCR…');
  } else if (status === 'recognizing text') {
    const percent = Math.round(progress * 100);
    onProgress(`Recognizing scanned text… ${percent}%`);
  }
}

export async function createOcrWorker(onProgress) {
  onProgress?.('Preparing OCR for this scan…');

  const [tesseractModule, workerAsset] = await Promise.all([
    import('tesseract.js'),
    import('tesseract.js/dist/worker.min.js?url'),
  ]);
  const tesseract = tesseractModule.default ?? tesseractModule;

  return tesseract.createWorker('eng', 1, {
    workerPath: workerAsset.default,
    workerBlobURL: false,
    logger: ({ status, progress }) =>
      reportWorkerProgress(onProgress, status, progress),
  });
}

export async function imageFileToCanvas(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('This image could not be opened. Try a PNG, JPG, or WebP image.');
  }

  try {
    const sourcePixels = bitmap.width * bitmap.height;
    if (
      !bitmap.width ||
      !bitmap.height ||
      sourcePixels > MAX_SOURCE_IMAGE_PIXELS
    ) {
      throw new Error(
        'This image is too large to process safely. Resize or crop it and try again.',
      );
    }

    const scale = Math.min(
      2,
      MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height),
    );
    const canvas = document.createElement('canvas');
    const context = setCanvasSize(
      canvas,
      bitmap.width * scale,
      bitmap.height * scale,
    );
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    bitmap.close();
  }
}

export async function recognizeCanvas(worker, canvas) {
  const result = await worker.recognize(canvas);
  return result.data.text ?? '';
}

export function releaseCanvas(canvas) {
  canvas.width = 0;
  canvas.height = 0;
}
