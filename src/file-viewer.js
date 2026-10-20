import './file-viewer.css';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  extractTextFromFile,
  MAX_FILE_BYTES,
} from './document-text-extractor.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const fileInput = document.querySelector('#file-input');
const fileStatus = document.querySelector('#file-status');
const summaryEmpty = document.querySelector('#summary-empty');
const summaryList = document.querySelector('#summary-list');
const topicIndex = document.querySelector('#topic-index');
const topicIndexList = document.querySelector('#topic-index-list');
const saveRevisionButton = document.querySelector('#save-revision-button');
const askAiButton = document.querySelector('#ask-ai-button');
const askAiPanel = document.querySelector('#ask-ai-panel');
const questionForm = document.querySelector('#question-form');
const questionInput = document.querySelector('#question-input');
const questionSubmit = document.querySelector('#question-submit');
const questionStatus = document.querySelector('#question-status');
const questionAnswer = document.querySelector('#question-answer');
const questionResult = document.querySelector('#question-result');
const saveQuestionButton = document.querySelector('#save-question-button');
const questionSaveStatus = document.querySelector('#question-save-status');
const closeAskAiButton = document.querySelector('#close-ask-ai-button');
const savedQuestionDialog = document.querySelector('#saved-question-dialog');
const savedQuestionDialogHeading = document.querySelector('#saved-question-dialog-heading');
const savedQuestionDialogDate = document.querySelector('#saved-question-dialog-date');
const savedQuestionDialogAnswer = document.querySelector('#saved-question-dialog-answer');
const closeSavedQuestionDialog = document.querySelector('#close-saved-question-dialog');
const authPanel = document.querySelector('#auth-panel');
const authForm = document.querySelector('#auth-form');
const authHeading = document.querySelector('#auth-heading');
const authDescription = document.querySelector('#auth-description');
const authMessage = document.querySelector('#auth-message');
const authUsername = document.querySelector('#auth-username');
const authPassword = document.querySelector('#auth-password');
const rememberMe = document.querySelector('#remember-me');
const authSubmit = document.querySelector('#auth-submit');
const loginModeButton = document.querySelector('#login-mode');
const registerModeButton = document.querySelector('#register-mode');
const appShell = document.querySelector('#app-shell');
const activeUsername = document.querySelector('#active-username');
const logoutButton = document.querySelector('#logout-button');
const savedRevisionsList = document.querySelector('#saved-revisions-list');
const savedRevisionsEmpty = document.querySelector('#saved-revisions-empty');
const savedRevisionsStatus = document.querySelector('#saved-revisions-status');
const savedRevisionsCount = document.querySelector('#saved-revisions-count');
const savedQuestionsList = document.querySelector('#saved-questions-list');
const savedQuestionsEmpty = document.querySelector('#saved-questions-empty');
const savedQuestionsStatus = document.querySelector('#saved-questions-status');
const savedQuestionsCount = document.querySelector('#saved-questions-count');
const SUMMARY_ENDPOINT = '/api/summaries';
const FILE_SUMMARY_ENDPOINT = '/api/summaries/file';
const QUESTION_ENDPOINT = '/api/questions';
const REVISIONS_ENDPOINT = '/api/revisions';
const SAVED_QUESTIONS_ENDPOINT = '/api/saved-questions';
const DIRECT_SUMMARY_MIME_BY_EXTENSION = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/plain',
  csv: 'text/csv',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};
const MAX_DIRECT_FILE_UPLOAD_BYTES = 3 * 1024 * 1024;
let activeController;
let activeRequest = 0;
let authMode = 'login';
let currentMarkdown = '';
let currentRevisionId = null;
let currentDiagramUrls = [];
let questionController;
let questionRequestId = 0;
let currentAnsweredQuestion = '';
let currentAnsweredAnswer = '';
let currentQuestionSaved = false;

function releaseCurrentDiagramUrls() {
  for (const url of currentDiagramUrls) URL.revokeObjectURL(url);
  currentDiagramUrls = [];
}

async function apiRequest(path, { method = 'GET', body, signal } = {}) {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });

  let data = null;
  if (response.status !== 204) {
    try {
      data = await response.json();
    } catch {
      throw new Error('The server returned an unreadable response.');
    }
  }

  if (!response.ok) {
    const error = new Error(data?.error || `Request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }

  return data;
}

function clearSummary(message = 'Your digital study notes will appear here.') {
  releaseCurrentDiagramUrls();
  currentMarkdown = '';
  currentRevisionId = null;
  updateCurrentIndexSelection();
  summaryList.replaceChildren();
  summaryList.classList.add('hidden');
  topicIndexList.replaceChildren();
  topicIndex.classList.add('hidden');
  saveRevisionButton.classList.add('hidden');
  saveRevisionButton.disabled = false;
  saveRevisionButton.textContent = 'Save revision';
  summaryEmpty.textContent = message;
  summaryEmpty.classList.remove('hidden');
}

function resetQuestionPanel() {
  questionController?.abort();
  questionController = undefined;
  questionRequestId += 1;
  questionForm.reset();
  questionAnswer.textContent = '';
  questionResult.classList.add('hidden');
  questionStatus.textContent = '';
  questionStatus.classList.remove('is-error');
  questionSaveStatus.textContent = '';
  currentAnsweredQuestion = '';
  currentAnsweredAnswer = '';
  currentQuestionSaved = false;
  questionSubmit.disabled = false;
  questionSubmit.textContent = 'Ask AI';
  saveQuestionButton.disabled = false;
  saveQuestionButton.textContent = 'Save Q&A';
  askAiPanel.classList.add('hidden');
  askAiButton.setAttribute('aria-expanded', 'false');
}

function setQuestionPanelOpen(isOpen) {
  askAiPanel.classList.toggle('hidden', !isOpen);
  askAiButton.setAttribute('aria-expanded', String(isOpen));
  if (isOpen) questionInput.focus();
}

function updateCurrentIndexSelection() {
  for (const button of savedRevisionsList.querySelectorAll('button[data-revision-id]')) {
    if (button.dataset.revisionId === currentRevisionId) {
      button.setAttribute('aria-current', 'page');
    } else {
      button.removeAttribute('aria-current');
    }
  }
}

function normalizeInlineSpacing(text) {
  return text
    .replace(/[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g, ' ')
    .replace(/[\u200b\u2060\ufeff]/g, '')
    .replace(/[ \t]{2,}/g, ' ');
}

function appendInlineMarkdown(parent, text) {
  text = normalizeInlineSpacing(text);
  const tokenPattern = /(\*\*[^*]+\*\*|<u>[^<>]+<\/u>|\*[^*]+\*)/g;
  let cursor = 0;

  for (const match of text.matchAll(tokenPattern)) {
    const token = match[0];
    const start = match.index ?? 0;
    if (start > cursor) {
      parent.append(document.createTextNode(text.slice(cursor, start)));
    }

    let element;
    let content;
    if (token.startsWith('<u>')) {
      element = document.createElement('u');
      element.className = 'font-medium text-slate-900 decoration-amber-500 decoration-2 underline-offset-4';
      content = token.slice(3, -4);
    } else if (token.startsWith('**')) {
      element = document.createElement('strong');
      content = token.slice(2, -2);
    } else {
      element = document.createElement('em');
      content = token.slice(1, -1);
    }

    element.textContent = content;
    parent.append(element);
    cursor = start + token.length;
  }

  if (cursor < text.length) {
    parent.append(document.createTextNode(text.slice(cursor)));
  }
}

function parseStudyTopics(markdown) {
  const topics = [];
  const takeawayLines = [];
  let currentTopic;
  let currentSection = 'notes';
  let bulletStack = [];

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = normalizeInlineSpacing(rawLine.trim());
    if (!line) continue;

    if (currentSection === 'takeaway') {
      takeawayLines.push(normalizeInlineSpacing(line));
      continue;
    }

    const takeawayMatch = line.match(/^\*\*KEY TAKEAWAY:\*\*\s*(.*)$/i);
    if (takeawayMatch) {
      currentSection = 'takeaway';
      if (takeawayMatch[1]) takeawayLines.push(normalizeInlineSpacing(takeawayMatch[1]));
      continue;
    }

    const headingMatch = line.match(/^###\s+(.+)$/);
    if (headingMatch) {
      currentTopic = {
        title: normalizeInlineSpacing(headingMatch[1].replace(/^\*\*|\*\*$/g, '')),
        definition: '',
        diagrams: [],
        bullets: [],
        examFocus: '',
        example: [],
        questions: [],
        takeaway: '',
      };
      topics.push(currentTopic);
      currentSection = 'notes';
      bulletStack = [];
      continue;
    }

    if (!currentTopic) continue;

    const examFocusMatch = line.match(/^(?:\*\*)?EXAM FOCUS:?(?:\*\*)?\s*(.*)$/i);
    if (examFocusMatch) {
      currentSection = 'examFocus';
      bulletStack = [];
      if (examFocusMatch[1]) {
        currentTopic.examFocus = normalizeInlineSpacing(examFocusMatch[1]);
      }
      continue;
    }

    const exampleMatch = line.match(/^(?:\*\*)?EXAMPLE:?(?:\*\*)?\s*(.*)$/i);
    if (exampleMatch) {
      currentSection = 'example';
      bulletStack = [];
      if (exampleMatch[1]) currentTopic.example.push(normalizeInlineSpacing(exampleMatch[1]));
      continue;
    }

    const questionsMatch = line.match(
      /^(?:\*\*)?POSSIBLE EXAM QUESTIONS:?(?:\*\*)?\s*$/i,
    );
    if (questionsMatch) {
      currentSection = 'questions';
      bulletStack = [];
      continue;
    }

    const bulletMatch = rawLine.match(/^(\s*)[-*]\s+(.+)$/);
    if (bulletMatch) {
      if (currentSection === 'questions') {
        currentTopic.questions.push(normalizeInlineSpacing(bulletMatch[2].trim()));
        bulletStack = [];
        continue;
      }

      currentSection = 'notes';
      const indent = bulletMatch[1].replace(/\t/g, '  ').length;
      const item = { text: normalizeInlineSpacing(bulletMatch[2].trim()), children: [] };
      while (bulletStack.length && bulletStack[bulletStack.length - 1].indent >= indent) {
        bulletStack.pop();
      }
      const parent = bulletStack[bulletStack.length - 1]?.item;
      if (parent) parent.children.push(item);
      else currentTopic.bullets.push(item);
      bulletStack.push({ indent, item });
      continue;
    }

    bulletStack = [];
    if (line.startsWith('→')) {
      currentTopic.definition = normalizeInlineSpacing(line.replace(/^→\s*/, ''));
      currentSection = 'notes';
    } else if (currentSection === 'example') {
      currentTopic.example.push(normalizeInlineSpacing(line));
    } else if (currentSection === 'examFocus') {
      currentTopic.examFocus = [
        currentTopic.examFocus,
        normalizeInlineSpacing(line),
      ].filter(Boolean).join(' ');
    }
  }

  if (topics.length) {
    topics[topics.length - 1].takeaway = takeawayLines.join(' ');
  }
  return topics;
}

function renderTopicDiagrams(topic) {
  if (!topic.diagrams.length) return undefined;

  const section = document.createElement('section');
  section.className = 'topic-diagrams rounded-xl border border-indigo-200 bg-indigo-50/80 px-4 py-3';
  const label = document.createElement('h4');
  label.className = 'mb-3 text-xs font-semibold text-indigo-900';
  label.textContent = 'Diagram from PDF';
  section.append(label);

  for (const diagram of topic.diagrams) {
    const figure = document.createElement('figure');
    figure.className = 'topic-diagram-figure';
    const image = document.createElement('img');
    image.className = 'topic-diagram-image';
    image.src = diagram.url;
    image.alt = `Diagram for ${topic.title}, from page ${diagram.page} of the PDF`;
    image.loading = 'lazy';
    image.decoding = 'async';
    figure.append(image);

    const caption = document.createElement('figcaption');
    caption.textContent = `Page ${diagram.page}`;
    figure.append(caption);
    section.append(figure);
  }

  return section;
}

async function renderPdfDiagramCrops(file, regions, signal, onProgress) {
  if (!Array.isArray(regions) || regions.length === 0) return [];

  const pdf = await pdfjsLib.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
  }).promise;
  const diagramImages = [];

  try {
    const validRegions = regions
      .filter((region) => (
        region &&
        typeof region.topicTitle === 'string' &&
        Number.isInteger(region.page) &&
        region.page >= 1 &&
        region.page <= pdf.numPages &&
        [region.x, region.y, region.width, region.height].every(
          (value) => typeof value === 'number' && Number.isFinite(value),
        ) &&
        region.x >= 0 &&
        region.y >= 0 &&
        region.width > 0 &&
        region.height > 0 &&
        region.x + region.width <= 1000 &&
        region.y + region.height <= 1000
      ))
      .slice(0, 24);
    const pageNumbers = [...new Set(validRegions.map((region) => region.page))];

    for (const [pageIndex, pageNumber] of pageNumbers.entries()) {
      if (signal.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }
      onProgress?.(`Extracting diagrams from PDF page ${pageNumber}…`);

      const page = await pdf.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(
        1.5,
        2400 / Math.max(baseViewport.width, baseViewport.height),
      );
      const viewport = page.getViewport({ scale });
      const pageCanvas = document.createElement('canvas');
      pageCanvas.width = Math.ceil(viewport.width);
      pageCanvas.height = Math.ceil(viewport.height);
      const pageContext = pageCanvas.getContext('2d');
      if (!pageContext) continue;

      const renderTask = page.render({
        canvas: pageCanvas,
        canvasContext: pageContext,
        viewport,
      });
      const abortRender = () => renderTask.cancel();
      signal.addEventListener('abort', abortRender, { once: true });
      try {
        await renderTask.promise;
      } catch (error) {
        if (signal.aborted) {
          throw new DOMException('The operation was aborted.', 'AbortError');
        }
        throw error;
      } finally {
        signal.removeEventListener('abort', abortRender);
      }

      for (const region of validRegions.filter((item) => item.page === pageNumber)) {
        const sourceX = Math.max(0, Math.floor((region.x / 1000) * pageCanvas.width));
        const sourceY = Math.max(0, Math.floor((region.y / 1000) * pageCanvas.height));
        const sourceRight = Math.min(
          pageCanvas.width,
          Math.ceil(((region.x + region.width) / 1000) * pageCanvas.width),
        );
        const sourceBottom = Math.min(
          pageCanvas.height,
          Math.ceil(((region.y + region.height) / 1000) * pageCanvas.height),
        );
        const cropWidth = sourceRight - sourceX;
        const cropHeight = sourceBottom - sourceY;
        if (cropWidth < 2 || cropHeight < 2) continue;

        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = cropWidth;
        cropCanvas.height = cropHeight;
        const cropContext = cropCanvas.getContext('2d');
        if (!cropContext) continue;
        cropContext.drawImage(
          pageCanvas,
          sourceX,
          sourceY,
          cropWidth,
          cropHeight,
          0,
          0,
          cropWidth,
          cropHeight,
        );
        const blob = await new Promise((resolve) => cropCanvas.toBlob(resolve, 'image/png'));
        cropCanvas.width = 0;
        cropCanvas.height = 0;
        if (!blob) continue;

        diagramImages.push({
          topicTitle: normalizeInlineSpacing(region.topicTitle).toLocaleLowerCase(),
          page: pageNumber,
          url: URL.createObjectURL(blob),
        });
      }

      pageCanvas.width = 0;
      pageCanvas.height = 0;
      onProgress?.(`Extracted diagrams from ${pageIndex + 1} of ${pageNumbers.length} PDF pages…`);
    }
  } catch (error) {
    for (const diagram of diagramImages) URL.revokeObjectURL(diagram.url);
    throw error;
  } finally {
    await pdf.destroy();
  }

  return diagramImages;
}

function renderBulletList(items, nested = false) {
  if (!items.length) return undefined;

  const list = document.createElement('ul');
  list.className = nested
    ? 'mt-2 list-disc space-y-2 pl-5 marker:text-slate-400'
    : 'list-disc space-y-3 pl-6 marker:text-amber-500';

  for (const item of items) {
    const listItem = document.createElement('li');
    listItem.className = 'pl-1 leading-7 text-slate-800';
    appendInlineMarkdown(listItem, item.text);
    const children = renderBulletList(item.children, true);
    if (children) listItem.append(children);
    list.append(listItem);
  }
  return list;
}

function renderExamFocus(text) {
  if (!text) return undefined;

  const focus = document.createElement('aside');
  focus.className = 'rounded-lg border-l-4 border-amber-500 bg-amber-100/90 px-4 py-3';
  const label = document.createElement('h4');
  label.className = 'mb-1 text-xs font-bold uppercase tracking-wide text-amber-900';
  label.textContent = 'Exam focus';
  const point = document.createElement('p');
  point.className = 'font-semibold leading-7 text-slate-800';
  appendInlineMarkdown(point, text);
  focus.append(label, point);
  return focus;
}

function renderExamQuestions(questions) {
  if (!questions.length) return undefined;

  const section = document.createElement('section');
  section.className = 'rounded-lg border border-indigo-100 bg-indigo-50/70 px-4 py-3';
  const label = document.createElement('h4');
  label.className = 'mb-2 text-xs font-bold uppercase tracking-wide text-indigo-900';
  label.textContent = 'Possible exam questions';
  const list = document.createElement('ol');
  list.className = 'list-decimal space-y-2 pl-5 marker:text-indigo-500';

  for (const question of questions) {
    const item = document.createElement('li');
    item.className = 'pl-1 leading-7 text-slate-800';
    appendInlineMarkdown(item, question);
    list.append(item);
  }

  section.append(label, list);
  return section;
}

function renderStudyTopic(topic, topicNumber) {
  const article = document.createElement('article');
  article.className = 'study-copy w-full space-y-5 text-[15px] text-slate-800';
  article.id = `study-topic-${topicNumber}`;

  const heading = document.createElement('h3');
  heading.className = 'w-fit max-w-full rounded-md bg-yellow-200 px-3 py-1.5 text-lg font-bold leading-snug text-slate-950';
  appendInlineMarkdown(heading, topic.title);
  article.append(heading);

  if (topic.definition) {
    const definition = document.createElement('p');
    definition.className = 'flex items-start rounded-lg bg-sky-50/90 px-4 py-3 leading-7 text-slate-800';
    const arrow = document.createElement('span');
    arrow.className = 'mr-2 shrink-0 font-semibold text-sky-800';
    arrow.textContent = '→';
    const definitionText = document.createElement('span');
    definitionText.className = 'min-w-0';
    appendInlineMarkdown(definitionText, topic.definition);
    definition.append(arrow, definitionText);
    article.append(definition);
  }

  const diagram = renderTopicDiagrams(topic);
  if (diagram) article.append(diagram);

  const bulletList = renderBulletList(topic.bullets);
  if (bulletList) article.append(bulletList);

  const examFocus = renderExamFocus(topic.examFocus);
  if (examFocus) article.append(examFocus);

  if (topic.example.length) {
    const example = document.createElement('section');
    example.className = 'rounded-r-lg border-l-4 border-teal-300 bg-teal-50/90 px-4 py-3';
    const label = document.createElement('h4');
    label.className = 'mb-1 text-xs font-bold uppercase tracking-normal text-teal-800';
    label.textContent = 'Example:';
    example.append(label);
    for (const line of topic.example) {
      const scenario = document.createElement('p');
      scenario.className = 'leading-7 text-slate-700';
      appendInlineMarkdown(scenario, line);
      example.append(scenario);
    }
    article.append(example);
  }

  const examQuestions = renderExamQuestions(topic.questions);
  if (examQuestions) article.append(examQuestions);

  return article;
}

function renderKeyTakeaway(text) {
  if (!text) return undefined;
  const takeaway = document.createElement('aside');
  takeaway.className = 'study-copy w-full rounded-xl border-2 border-dashed border-amber-400 bg-amber-50/90 px-5 py-4 sm:px-6 sm:py-5';
  const takeawayLabel = document.createElement('h4');
  takeawayLabel.className = 'mb-2 text-xs font-bold uppercase tracking-normal text-amber-900';
  takeawayLabel.textContent = 'Key takeaway:';
  const takeawayText = document.createElement('p');
  takeawayText.className = 'text-[15px] leading-7 text-slate-800';
  appendInlineMarkdown(takeawayText, text);
  takeaway.append(takeawayLabel, takeawayText);
  return takeaway;
}

function renderSummary(markdown, savedRevisionId = null, diagramImages = []) {
  const topics = parseStudyTopics(markdown);
  if (!topics.length) {
    throw new Error('The study notes did not contain any topics. Please try again.');
  }
  releaseCurrentDiagramUrls();
  currentDiagramUrls = diagramImages.map((diagram) => diagram.url);
  for (const topic of topics) {
    topic.diagrams = diagramImages.filter(
      (diagram) => diagram.topicTitle === topic.title.toLocaleLowerCase(),
    );
  }
  summaryList.replaceChildren();
  topicIndexList.replaceChildren();
  topics.forEach((topic, index) => {
    const topicNumber = index + 1;
    const topicId = `study-topic-${topicNumber}`;
    const item = document.createElement('li');
    const link = document.createElement('a');
    item.className = 'rounded-lg border border-amber-200/80 bg-white/90 px-3 py-2 text-sm';
    link.className = 'font-medium text-amber-950 underline decoration-amber-400 underline-offset-4 hover:text-amber-700';
    link.href = `#${topicId}`;
    link.textContent = topic.title;
    item.append(link);
    topicIndexList.append(item);
    summaryList.append(renderStudyTopic(topic, topicNumber));
  });
  const takeaway = renderKeyTakeaway(topics[topics.length - 1].takeaway);
  if (takeaway) summaryList.append(takeaway);
  currentMarkdown = markdown;
  currentRevisionId = savedRevisionId;
  updateCurrentIndexSelection();
  summaryList.classList.remove('hidden');
  topicIndex.classList.remove('hidden');
  saveRevisionButton.classList.remove('hidden');
  saveRevisionButton.disabled = Boolean(savedRevisionId);
  saveRevisionButton.textContent = savedRevisionId ? 'Saved to index' : 'Save revision';
  summaryEmpty.classList.add('hidden');
}

function setAuthMode(mode) {
  authMode = mode;
  const isRegistering = mode === 'register';
  authForm.dataset.mode = mode;
  loginModeButton.setAttribute('aria-selected', String(!isRegistering));
  registerModeButton.setAttribute('aria-selected', String(isRegistering));
  loginModeButton.className = isRegistering
    ? 'mode-tab rounded-lg px-3 py-2 text-sm font-semibold text-[#856b70]'
    : 'mode-tab is-active rounded-lg bg-white px-3 py-2 text-sm font-semibold text-[#633b46] shadow-sm';
  registerModeButton.className = isRegistering
    ? 'mode-tab is-active rounded-lg bg-white px-3 py-2 text-sm font-semibold text-[#633b46] shadow-sm'
    : 'mode-tab rounded-lg px-3 py-2 text-sm font-semibold text-[#856b70]';
  authHeading.textContent = isRegistering
    ? 'Create your notebook account'
    : 'Sign in to your notebook';
  authDescription.textContent = isRegistering
    ? 'Choose a username and password. No email or other details are needed.'
    : 'Use your username and password to access your saved revisions.';
  authPassword.autocomplete = isRegistering ? 'new-password' : 'current-password';
  authSubmit.textContent = isRegistering ? 'Create account' : 'Sign in';
  authMessage.textContent = '';
  authMessage.classList.add('hidden');
}

function showAuthPanel(message = '') {
  activeController?.abort();
  clearSummary();
  resetQuestionPanel();
  fileInput.value = '';
  fileStatus.textContent = '';
  savedRevisionsList.replaceChildren();
  savedRevisionsList.classList.add('hidden');
  savedRevisionsCount.textContent = '0 pages';
  savedRevisionsEmpty.classList.remove('hidden');
  savedRevisionsStatus.textContent = '';
  savedRevisionsStatus.classList.add('hidden');
  savedQuestionsList.replaceChildren();
  savedQuestionsList.classList.add('hidden');
  savedQuestionsCount.textContent = '0';
  savedQuestionsEmpty.classList.remove('hidden');
  savedQuestionsStatus.textContent = '';
  savedQuestionsStatus.classList.add('hidden');
  if (savedQuestionDialog.open) savedQuestionDialog.close();
  appShell.classList.add('hidden');
  authPanel.classList.remove('hidden');
  authMessage.textContent = message;
  authMessage.classList.toggle('hidden', !message);
}

async function loadSavedRevisions() {
  savedRevisionsStatus.textContent = '';
  savedRevisionsStatus.classList.add('hidden');
  try {
    const data = await apiRequest(REVISIONS_ENDPOINT);
    const revisions = Array.isArray(data?.revisions) ? data.revisions : [];
    savedRevisionsList.replaceChildren();
    savedRevisionsCount.textContent = `${revisions.length} ${revisions.length === 1 ? 'page' : 'pages'}`;
    if (!revisions.length) {
      savedRevisionsList.classList.add('hidden');
      savedRevisionsEmpty.textContent = 'Save a revision to add it to this index.';
      savedRevisionsEmpty.classList.remove('hidden');
      return;
    }

    savedRevisionsEmpty.classList.add('hidden');
    savedRevisionsList.classList.remove('hidden');
    for (const [index, revision] of revisions.entries()) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'index-revision-button flex w-full items-center justify-between gap-3 rounded-lg border border-[#ead4d5] bg-[#fffaf8] px-3 py-3 text-left transition hover:border-[#c995a0] hover:bg-[#fdf6f4]';
      button.dataset.revisionId = revision.id;
      if (revision.id === currentRevisionId) button.setAttribute('aria-current', 'page');
      button.setAttribute('aria-label', `Open page ${index + 1}: ${revision.title}`);

      const number = document.createElement('span');
      number.className = 'index-number';
      number.setAttribute('aria-hidden', 'true');
      number.textContent = String(index + 1).padStart(2, '0');
      const title = document.createElement('span');
      title.className = 'min-w-0 flex-1 truncate text-sm font-semibold text-[#633b46]';
      title.textContent = revision.title;
      const date = document.createElement('span');
      date.className = 'shrink-0 text-xs text-[#947d81]';
      const createdAt = new Date(revision.createdAt);
      date.textContent = Number.isNaN(createdAt.getTime())
        ? ''
        : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(createdAt);

      button.append(number, title, date);
      button.addEventListener('click', () => openSavedRevision(revision));

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'index-delete-button';
      deleteButton.textContent = 'Delete';
      deleteButton.setAttribute('aria-label', `Delete saved page: ${revision.title}`);
      deleteButton.addEventListener('click', () => {
        void deleteSavedRevision(revision, deleteButton);
      });

      item.className = 'index-revision-item';
      item.append(button, deleteButton);
      savedRevisionsList.append(item);
    }
  } catch (error) {
    if (error?.status === 401) {
      showAuthPanel('Your session ended. Sign in again to access your notebook.');
      return;
    }
    savedRevisionsStatus.textContent =
      error instanceof Error ? error.message : 'Could not load your revision index.';
    savedRevisionsStatus.classList.remove('hidden');
  }
}

async function loadSavedQuestions() {
  savedQuestionsStatus.textContent = '';
  savedQuestionsStatus.classList.add('hidden');
  try {
    const data = await apiRequest(SAVED_QUESTIONS_ENDPOINT);
    const questions = Array.isArray(data?.questions) ? data.questions : [];
    savedQuestionsList.replaceChildren();
    savedQuestionsCount.textContent = String(questions.length);
    if (!questions.length) {
      savedQuestionsList.classList.add('hidden');
      savedQuestionsEmpty.textContent =
        'Save an AI answer to keep its question and answer here.';
      savedQuestionsEmpty.classList.remove('hidden');
      return;
    }

    savedQuestionsEmpty.classList.add('hidden');
    savedQuestionsList.classList.remove('hidden');
    for (const question of questions) {
      const item = document.createElement('li');
      item.className = 'saved-question-item';

      const openButton = document.createElement('button');
      openButton.type = 'button';
      openButton.className = 'saved-question-open';
      openButton.setAttribute('aria-label', `Open saved question: ${question.question}`);
      const questionText = document.createElement('span');
      questionText.className = 'saved-question-text';
      questionText.textContent = question.question;
      const date = document.createElement('span');
      date.className = 'saved-question-date';
      const createdAt = new Date(question.createdAt);
      date.textContent = Number.isNaN(createdAt.getTime())
        ? ''
        : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(createdAt);
      openButton.append(questionText, date);
      openButton.addEventListener('click', () => {
        void openSavedQuestion(question);
      });

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'saved-question-delete';
      deleteButton.textContent = 'Delete';
      deleteButton.setAttribute('aria-label', `Delete saved question: ${question.question}`);
      deleteButton.addEventListener('click', () => {
        void deleteSavedQuestion(question, deleteButton);
      });

      item.append(openButton, deleteButton);
      savedQuestionsList.append(item);
    }
  } catch (error) {
    if (error?.status === 401) {
      showAuthPanel('Your session ended. Sign in again to access your notebook.');
      return;
    }
    savedQuestionsStatus.textContent =
      error instanceof Error ? error.message : 'Could not load your saved questions.';
    savedQuestionsStatus.classList.remove('hidden');
  }
}

async function showNotebook(user) {
  activeUsername.textContent = user.username;
  authPanel.classList.add('hidden');
  appShell.classList.remove('hidden');
  await Promise.all([loadSavedRevisions(), loadSavedQuestions()]);
}

async function openSavedQuestion(questionSummary) {
  savedQuestionsStatus.textContent = `Opening saved question…`;
  savedQuestionsStatus.classList.remove('hidden');
  try {
    const data = await apiRequest(
      `${SAVED_QUESTIONS_ENDPOINT}/${encodeURIComponent(questionSummary.id)}`,
    );
    const question = data.question;
    savedQuestionDialogHeading.textContent = question.question;
    savedQuestionDialogAnswer.textContent = question.answer;
    const createdAt = new Date(question.createdAt);
    savedQuestionDialogDate.textContent = Number.isNaN(createdAt.getTime())
      ? ''
      : `Saved ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(createdAt)}`;
    savedQuestionsStatus.textContent = '';
    savedQuestionsStatus.classList.add('hidden');
    savedQuestionDialog.showModal();
  } catch (error) {
    if (error?.status === 401) {
      showAuthPanel('Your session ended. Sign in again to access your notebook.');
      return;
    }
    savedQuestionsStatus.textContent =
      error instanceof Error ? error.message : 'Could not open that saved question.';
    savedQuestionsStatus.classList.remove('hidden');
  }
}

async function deleteSavedQuestion(question, button) {
  const confirmed = window.confirm(
    `Delete this saved question and answer? “${question.question.slice(0, 100)}”`,
  );
  if (!confirmed) return;

  button.disabled = true;
  savedQuestionsStatus.textContent = 'Deleting saved question…';
  savedQuestionsStatus.classList.remove('hidden');
  try {
    await apiRequest(
      `${SAVED_QUESTIONS_ENDPOINT}/${encodeURIComponent(question.id)}`,
      { method: 'DELETE' },
    );
    await loadSavedQuestions();
    savedQuestionsStatus.textContent = 'Deleted saved question.';
    savedQuestionsStatus.classList.remove('hidden');
  } catch (error) {
    if (error?.status === 401) {
      showAuthPanel('Your session ended. Sign in again to access your notebook.');
      return;
    }
    savedQuestionsStatus.textContent =
      error instanceof Error ? error.message : 'Could not delete that saved question.';
    savedQuestionsStatus.classList.remove('hidden');
    button.disabled = false;
  }
}

async function openSavedRevision(revision) {
  savedRevisionsStatus.textContent = `Opening ${revision.title}…`;
  savedRevisionsStatus.classList.remove('hidden');
  try {
    const data = await apiRequest(`${REVISIONS_ENDPOINT}/${encodeURIComponent(revision.id)}`);
    renderSummary(data.revision.markdown, data.revision.id);
    fileStatus.textContent = `Opened ${data.revision.title}.`;
    savedRevisionsStatus.textContent = '';
    savedRevisionsStatus.classList.add('hidden');
    document.querySelector('#summary-label').scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  } catch (error) {
    if (error?.status === 401) {
      showAuthPanel('Your session ended. Sign in again to access your notebook.');
      return;
    }
    savedRevisionsStatus.textContent =
      error instanceof Error ? error.message : 'Could not open that saved revision.';
    savedRevisionsStatus.classList.remove('hidden');
  }
}

async function deleteSavedRevision(revision, button) {
  const confirmed = window.confirm(
    `Delete “${revision.title}” from your saved index? This cannot be undone.`,
  );
  if (!confirmed) return;

  button.disabled = true;
  savedRevisionsStatus.textContent = `Deleting ${revision.title}…`;
  savedRevisionsStatus.classList.remove('hidden');
  try {
    await apiRequest(`${REVISIONS_ENDPOINT}/${encodeURIComponent(revision.id)}`, {
      method: 'DELETE',
    });
    if (currentRevisionId === revision.id) {
      currentRevisionId = null;
      updateCurrentIndexSelection();
      saveRevisionButton.disabled = false;
      saveRevisionButton.textContent = 'Save revision';
    }
    await loadSavedRevisions();
    savedRevisionsStatus.textContent = `Deleted “${revision.title}” from your index.`;
    savedRevisionsStatus.classList.remove('hidden');
  } catch (error) {
    if (error?.status === 401) {
      showAuthPanel('Your session ended. Sign in again to access your notebook.');
      return;
    }
    savedRevisionsStatus.textContent =
      error instanceof Error ? error.message : 'Could not delete that saved page.';
    savedRevisionsStatus.classList.remove('hidden');
    button.disabled = false;
  }
}

async function saveCurrentRevision() {
  if (!currentMarkdown || currentRevisionId) return;
  saveRevisionButton.disabled = true;
  saveRevisionButton.textContent = 'Saving…';
  try {
    const title = parseStudyTopics(currentMarkdown)[0]?.title || 'Study revision';
    const data = await apiRequest(REVISIONS_ENDPOINT, {
      method: 'POST',
      body: { title, markdown: currentMarkdown },
    });
    currentRevisionId = data.revision.id;
    saveRevisionButton.textContent = 'Saved to index';
    saveRevisionButton.disabled = true;
    fileStatus.textContent = `Saved “${data.revision.title}” to your revision index.`;
    await loadSavedRevisions();
  } catch (error) {
    if (error?.status === 401) {
      showAuthPanel('Your session ended. Sign in again to access your notebook.');
      return;
    }
    fileStatus.textContent =
      error instanceof Error ? error.message : 'Could not save this revision.';
    saveRevisionButton.disabled = false;
    saveRevisionButton.textContent = 'Save revision';
  }
}

async function initializeAuth() {
  setAuthMode('login');
  try {
    const data = await apiRequest('/api/auth/session');
    await showNotebook(data.user);
  } catch (error) {
    showAuthPanel(
      error?.status === 401 ? '' : 'The notebook is unavailable right now. Please try again.',
    );
  }
}

async function submitAuthentication(event) {
  event.preventDefault();
  if (!authForm.reportValidity()) return;

  const isRegistering = authMode === 'register';
  const username = authUsername.value.trim();
  const password = authPassword.value;
  authSubmit.disabled = true;
  loginModeButton.disabled = true;
  registerModeButton.disabled = true;
  authSubmit.textContent = isRegistering ? 'Creating account…' : 'Signing in…';
  authMessage.textContent = '';
  authMessage.classList.add('hidden');

  try {
    const data = await apiRequest(
      isRegistering ? '/api/auth/register' : '/api/auth/login',
      {
        method: 'POST',
        body: {
          username,
          password,
          rememberMe: rememberMe.checked,
        },
      },
    );
    authPassword.value = '';
    await showNotebook(data.user);
  } catch (error) {
    authMessage.textContent =
      error instanceof Error
        ? error.message
        : 'Could not access your notebook. Please try again.';
    authMessage.classList.remove('hidden');
  } finally {
    authSubmit.disabled = false;
    loginModeButton.disabled = false;
    registerModeButton.disabled = false;
    authSubmit.textContent = authMode === 'register' ? 'Create account' : 'Sign in';
  }
}

async function signOut() {
  logoutButton.disabled = true;
  logoutButton.textContent = 'Signing out…';
  try {
    await apiRequest('/api/auth/logout', { method: 'POST' });
    authForm.reset();
    rememberMe.checked = true;
    setAuthMode('login');
    showAuthPanel();
  } catch (error) {
    savedRevisionsStatus.textContent =
      error instanceof Error ? error.message : 'Could not sign out. Please try again.';
    savedRevisionsStatus.classList.remove('hidden');
  } finally {
    logoutButton.disabled = false;
    logoutButton.textContent = 'Sign out';
  }
}

function readFileAsBase64(file, signal, onProgress) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const abortRead = () => reader.abort();
    const cleanup = () => signal?.removeEventListener('abort', abortRead);

    reader.addEventListener(
      'load',
      () => {
        cleanup();
        if (typeof reader.result !== 'string') {
          reject(new Error('The file could not be prepared for the AI service.'));
          return;
        }
        const separator = reader.result.indexOf(',');
        if (separator < 0) {
          reject(new Error('The file could not be prepared for the AI service.'));
          return;
        }
        resolve(reader.result.slice(separator + 1));
      },
      { once: true },
    );
    reader.addEventListener(
      'error',
      () => {
        cleanup();
        reject(reader.error ?? new Error('The PDF could not be read.'));
      },
      { once: true },
    );
    reader.addEventListener(
      'abort',
      () => {
        cleanup();
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      },
      { once: true },
    );
    reader.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        onProgress?.(
          `Preparing ${file.name}… ${Math.round((event.loaded / event.total) * 100)}%`,
        );
      }
    });

    if (signal?.aborted) {
      reject(new DOMException('The operation was aborted.', 'AbortError'));
      return;
    }
    signal?.addEventListener('abort', abortRead, { once: true });
    reader.readAsDataURL(file);
  });
}

async function requestSummary(payload, signal, endpoint = SUMMARY_ENDPOINT) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal,
  });

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('The summarization server returned an unreadable response.');
  }

  if (!response.ok) {
    const message =
      typeof data?.error === 'string'
        ? data.error
        : data?.error?.message;
    throw new Error(message || `Summary request failed (${response.status}).`);
  }

  if (typeof data?.markdown !== 'string' || !data.markdown.trim()) {
    throw new Error('The summary response was invalid. Please try again.');
  }

  return {
    markdown: data.markdown,
    diagramRegions: Array.isArray(data.diagramRegions) ? data.diagramRegions : [],
  };
}

function getDirectSummaryMimeType(file) {
  const extension = file.name.toLowerCase().split('.').pop() ?? '';
  return Object.hasOwn(DIRECT_SUMMARY_MIME_BY_EXTENSION, extension)
    ? DIRECT_SUMMARY_MIME_BY_EXTENSION[extension]
    : undefined;
}

fileInput.addEventListener('change', async (event) => {
  const input = event.currentTarget;
  const file = input.files?.[0];

  if (!file) return;

  activeController?.abort();
  const controller = new AbortController();
  activeController = controller;
  const requestId = ++activeRequest;
  clearSummary('Your digital study notes will appear here.');

  try {
    if (file.size > MAX_FILE_BYTES) {
      throw new Error('Files must be 20 MB or smaller.');
    }

    let studySummary;
    let diagramImages = [];
    const directMimeType = getDirectSummaryMimeType(file);
    const mimeType =
      directMimeType && file.size <= MAX_DIRECT_FILE_UPLOAD_BYTES
        ? directMimeType
        : undefined;
    if (mimeType) {
      fileStatus.textContent = `Preparing ${file.name}…`;
      const fileBase64 = await readFileAsBase64(
        file,
        controller.signal,
        (message) => {
          if (requestId === activeRequest) fileStatus.textContent = message;
        },
      );
      if (requestId !== activeRequest) return;

      fileStatus.textContent = `Summarizing ${file.name}…`;
      studySummary = await requestSummary(
        { fileBase64, fileName: file.name, mimeType },
        controller.signal,
        FILE_SUMMARY_ENDPOINT,
      );
      if (mimeType === 'application/pdf' && studySummary.diagramRegions.length) {
        diagramImages = await renderPdfDiagramCrops(
          file,
          studySummary.diagramRegions,
          controller.signal,
          (message) => {
            if (requestId === activeRequest) fileStatus.textContent = message;
          },
        );
      }
    } else {
      fileStatus.textContent = `Preparing ${file.name} for text extraction…`;
      const text = await extractTextFromFile(file, {
        signal: controller.signal,
        onProgress: (message) => {
          if (requestId === activeRequest) fileStatus.textContent = message;
        },
      });
      if (requestId !== activeRequest) return;

      if (!text.trim()) {
        clearSummary('No readable text was found in this document.');
        fileStatus.textContent = `Could not read ${file.name}. It may be empty or contain only images.`;
        input.value = '';
        return;
      }

      fileStatus.textContent = `Creating a summary for ${file.name}…`;
      studySummary = await requestSummary({ text }, controller.signal);
    }

    if (requestId !== activeRequest) return;

    renderSummary(studySummary.markdown, null, diagramImages);
    fileStatus.textContent = `Study notes created for ${file.name}.`;
  } catch (error) {
    if (error?.name === 'AbortError') return;
    if (requestId !== activeRequest) return;

    const detail = error instanceof Error ? error.message : 'Please try again.';
    clearSummary('No summary was generated. Check the message above and try again.');
    fileStatus.textContent = `Could not summarize ${file.name}. ${detail}`;
    input.value = '';
  } finally {
    if (requestId === activeRequest) activeController = undefined;
  }
});

async function readQuestionStream(response, signal, onText) {
  if (!response.body) {
    throw new Error('AI could not start the answer. Please try again.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let answer = '';
  let finished = false;

  const processEvent = (event) => {
    const data = event
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data || data === '[DONE]') return;

    let payload;
    try {
      payload = JSON.parse(data);
    } catch {
      return;
    }
    if (typeof payload?.error === 'string') throw new Error(payload.error);
    if (typeof payload?.text !== 'string' || !payload.text) return;

    answer += payload.text;
    onText(payload.text);
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(
        /\r\n/g,
        '\n',
      );

      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        processEvent(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf('\n\n');
      }
    }

    buffer += decoder.decode();
    if (buffer.trim()) processEvent(buffer);
    finished = true;
    return answer.trim();
  } finally {
    if (!finished && !signal.aborted) {
      try {
        await reader.cancel();
      } catch {
        // The response may already have closed.
      }
    }
    reader.releaseLock();
  }
}

async function submitQuestion(event) {
  event.preventDefault();
  if (!questionForm.reportValidity()) return;

  const question = questionInput.value.trim();
  if (!question) {
    questionStatus.textContent = 'Enter a question to continue.';
    questionStatus.classList.add('is-error');
    questionInput.focus();
    return;
  }

  questionController?.abort();
  const controller = new AbortController();
  questionController = controller;
  const requestId = ++questionRequestId;
  let receivedAnswer = '';
  questionSubmit.disabled = true;
  questionSubmit.textContent = 'Answering…';
  questionAnswer.textContent = '';
  questionResult.classList.add('hidden');
  questionSaveStatus.textContent = '';
  currentAnsweredQuestion = '';
  currentAnsweredAnswer = '';
  currentQuestionSaved = false;
  saveQuestionButton.disabled = false;
  saveQuestionButton.textContent = 'Save Q&A';
  questionStatus.classList.remove('is-error');
  questionStatus.textContent = 'Thinking…';

  try {
    const response = await fetch(QUESTION_ENDPOINT, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
      signal: controller.signal,
    });

    if (!response.ok) {
      let data;
      try {
        data = await response.json();
      } catch {
        data = null;
      }
      throw new Error(data?.error || `Request failed (${response.status}).`);
    }

    const answer = await readQuestionStream(response, controller.signal, (text) => {
      if (requestId !== questionRequestId) return;
      receivedAnswer += text;
      questionAnswer.textContent = receivedAnswer;
      questionResult.classList.remove('hidden');
      questionStatus.textContent = 'Writing your answer…';
    });
    if (requestId !== questionRequestId) return;
    if (!answer) {
      throw new Error('AI returned an empty answer. Please try again.');
    }

    currentAnsweredQuestion = question;
    currentAnsweredAnswer = answer;
    questionAnswer.textContent = answer;
    questionResult.classList.remove('hidden');
    questionStatus.textContent = 'Answer ready.';
  } catch (error) {
    if (error?.name === 'AbortError' || requestId !== questionRequestId) return;
    questionStatus.textContent =
      error instanceof Error ? error.message : 'Could not answer this question. Please try again.';
    questionStatus.classList.add('is-error');
    if (receivedAnswer) {
      questionResult.classList.remove('hidden');
      saveQuestionButton.disabled = true;
      questionSaveStatus.textContent = 'Ask again to save a complete answer.';
    }
  } finally {
    if (requestId === questionRequestId) {
      questionController = undefined;
      questionSubmit.disabled = false;
      questionSubmit.textContent = 'Ask AI';
    }
  }
}

async function saveCurrentQuestion() {
  if (
    currentQuestionSaved ||
    !currentAnsweredQuestion ||
    !currentAnsweredAnswer
  ) {
    return;
  }

  saveQuestionButton.disabled = true;
  questionSubmit.disabled = true;
  saveQuestionButton.textContent = 'Saving…';
  questionSaveStatus.textContent = '';
  try {
    await apiRequest(SAVED_QUESTIONS_ENDPOINT, {
      method: 'POST',
      body: {
        question: currentAnsweredQuestion,
        answer: currentAnsweredAnswer,
      },
    });
    currentQuestionSaved = true;
    saveQuestionButton.textContent = 'Saved';
    questionSaveStatus.textContent = 'Saved the question and answer to your saved questions.';
    await loadSavedQuestions();
  } catch (error) {
    if (error?.status === 401) {
      showAuthPanel('Your session ended. Sign in again to access your notebook.');
      return;
    }
    questionSaveStatus.textContent =
      error instanceof Error ? error.message : 'Could not save this answer.';
    saveQuestionButton.disabled = false;
    saveQuestionButton.textContent = 'Save Q&A';
  } finally {
    questionSubmit.disabled = false;
  }
}

authForm.addEventListener('submit', submitAuthentication);
loginModeButton.addEventListener('click', () => setAuthMode('login'));
registerModeButton.addEventListener('click', () => setAuthMode('register'));
saveRevisionButton.addEventListener('click', saveCurrentRevision);
askAiButton.addEventListener('click', () => {
  setQuestionPanelOpen(askAiPanel.classList.contains('hidden'));
});
closeAskAiButton.addEventListener('click', () => {
  setQuestionPanelOpen(false);
  askAiButton.focus();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !askAiPanel.classList.contains('hidden')) {
    setQuestionPanelOpen(false);
    askAiButton.focus();
  }
});
questionForm.addEventListener('submit', submitQuestion);
saveQuestionButton.addEventListener('click', saveCurrentQuestion);
closeSavedQuestionDialog.addEventListener('click', () => savedQuestionDialog.close());
logoutButton.addEventListener('click', signOut);
void initializeAuth();
