import {
  createOcrWorker,
  imageFileToCanvas,
  recognizeCanvas,
  releaseCanvas,
} from './ocr-text-recognizer.js';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_CHARACTERS = 100_000;
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
const DRAWING_NAMESPACE =
  'http://schemas.openxmlformats.org/drawingml/2006/main';
const PRESENTATION_NAMESPACE =
  'http://schemas.openxmlformats.org/presentationml/2006/main';
const OFFICE_RELATIONSHIPS_NAMESPACE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_RELATIONSHIPS_NAMESPACE =
  'http://schemas.openxmlformats.org/package/2006/relationships';

function getExtension(fileName) {
  return fileName.toLowerCase().split('.').pop() ?? '';
}

function normalizeText(text) {
  return text.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
}

function checkTextLength(text) {
  if (text.length > MAX_TEXT_CHARACTERS) {
    throw new Error(
      'This file contains more than 100,000 characters of readable text. Please choose a shorter document.',
    );
  }
  return text;
}

function parseXml(xml, fileName) {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.getElementsByTagName('parsererror').length > 0) {
    throw new Error(`Could not read ${fileName}; the document structure is invalid.`);
  }
  return document;
}

function resolveZipPath(baseDirectory, target) {
  const pathParts = (target.startsWith('/')
    ? target.slice(1)
    : `${baseDirectory}/${target}`
  ).split('/');
  const resolvedParts = [];

  for (const part of pathParts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      resolvedParts.pop();
    } else {
      resolvedParts.push(part);
    }
  }

  return resolvedParts.join('/');
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError');
  }
}

async function withOcrWorker(onProgress, signal, recognize) {
  throwIfAborted(signal);
  let ocrWorker;
  let terminationPromise;
  const terminateWorker = () => {
    if (!ocrWorker) return Promise.resolve();
    terminationPromise ??= ocrWorker.terminate().catch(() => {});
    return terminationPromise;
  };
  const abortOcr = () => {
    void terminateWorker();
  };
  signal?.addEventListener('abort', abortOcr, { once: true });

  try {
    ocrWorker = await createOcrWorker(onProgress);
    throwIfAborted(signal);
    return await recognize(ocrWorker);
  } finally {
    signal?.removeEventListener('abort', abortOcr);
    await terminateWorker();
  }
}

async function extractDocxText(file) {
  const mammothModule = await import('mammoth/mammoth.browser.js');
  const mammoth = mammothModule.default ?? mammothModule;
  const { value } = await mammoth.extractRawText({
    arrayBuffer: await file.arrayBuffer(),
  });
  return normalizeText(value);
}

async function extractPdfText(file, onProgress, signal) {
  throwIfAborted(signal);
  onProgress?.('Reading PDF text in your browser…');
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
  });
  const pdf = await loadingTask.promise;

  try {
    const pageTexts = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      throwIfAborted(signal);
      onProgress?.(`Reading PDF page ${pageNumber} of ${pdf.numPages}…`);
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .filter(Boolean)
        .join(' ');
      if (pageText) pageTexts.push(pageText);
      checkTextLength(pageTexts.join('\n\n'));
    }

    return normalizeText(pageTexts.join('\n\n'));
  } finally {
    await pdf.destroy();
  }
}

async function extractPptxText(file) {
  const zipModule = await import('jszip');
  const JSZip = zipModule.default ?? zipModule;
  const zip = await JSZip.loadAsync(file);
  const presentationPath = 'ppt/presentation.xml';
  const relationshipsPath = 'ppt/_rels/presentation.xml.rels';
  const presentationFile = zip.file(presentationPath);
  const relationshipsFile = zip.file(relationshipsPath);

  if (!presentationFile || !relationshipsFile) {
    throw new Error('This file is not a readable PowerPoint presentation.');
  }

  const [presentationXml, relationshipsXml] = await Promise.all([
    presentationFile.async('string'),
    relationshipsFile.async('string'),
  ]);
  const presentation = parseXml(presentationXml, 'the PowerPoint presentation');
  const relationships = parseXml(relationshipsXml, 'the PowerPoint presentation');
  const relationshipTargets = new Map(
    Array.from(
      relationships.getElementsByTagNameNS(
        PACKAGE_RELATIONSHIPS_NAMESPACE,
        'Relationship',
      ),
    ).map((relationship) => [
      relationship.getAttribute('Id'),
      relationship.getAttribute('Target'),
    ]),
  );
  const slideIds = Array.from(
    presentation.getElementsByTagNameNS(PRESENTATION_NAMESPACE, 'sldId'),
  );

  if (slideIds.length === 0) {
    throw new Error('This PowerPoint presentation does not contain any slides.');
  }

  const slideTexts = [];
  for (let index = 0; index < slideIds.length; index += 1) {
    const relationshipId = slideIds[index].getAttributeNS(
      OFFICE_RELATIONSHIPS_NAMESPACE,
      'id',
    );
    const target = relationshipTargets.get(relationshipId);
    const slidePath = target
      ? resolveZipPath('ppt', target)
      : undefined;
    const slideFile = slidePath ? zip.file(slidePath) : null;

    if (!slideFile) {
      throw new Error(`Could not read slide ${index + 1} in this presentation.`);
    }

    const slideXml = await slideFile.async('string');
    const slide = parseXml(slideXml, `slide ${index + 1}`);
    const text = Array.from(
      slide.getElementsByTagNameNS(DRAWING_NAMESPACE, 't'),
    )
      .map((node) => node.textContent?.trim() ?? '')
      .filter(Boolean)
      .join(' ');

    if (text) slideTexts.push(`Slide ${index + 1}: ${text}`);
    checkTextLength(slideTexts.join('\n\n'));
  }

  return normalizeText(slideTexts.join('\n\n'));
}

export async function extractTextFromFile(
  file,
  { onProgress, signal } = {},
) {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error('Files must be 20 MB or smaller.');
  }
  throwIfAborted(signal);

  const extension = getExtension(file.name);
  let text;

  switch (extension) {
    case 'txt':
    case 'csv':
    case 'md':
      text = normalizeText(await file.text());
      break;
    case 'pdf':
      text = await extractPdfText(file, onProgress, signal);
      break;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'webp':
      {
        const canvas = await imageFileToCanvas(file);
        try {
          text = await withOcrWorker(
            onProgress,
            signal,
            async (ocrWorker) => {
              onProgress?.('Reading the image scan with OCR…');
              return normalizeText(await recognizeCanvas(ocrWorker, canvas));
            },
          );
        } finally {
          releaseCanvas(canvas);
        }
      }
      break;
    case 'docx':
      text = await extractDocxText(file);
      break;
    case 'pptx':
      text = await extractPptxText(file);
      break;
    default:
      throw new Error(
        'Choose a PDF, TXT, CSV, Markdown, DOCX, PPTX, JPG, PNG, or WebP file.',
      );
  }

  return checkTextLength(text);
}
