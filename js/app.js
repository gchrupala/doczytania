// User interface: renders the views from the document in store.js and
// handles input, links shared from other apps and sync.

import { dropTitle, renderMarkdown } from './reader.js';
import * as S from './store.js';
import { filePath, fileWebUrl, gitHubRemote, parsePerson, parseRepo, syncOnce, syncPath } from './sync.js';

const VERSION = '3';

const KIND_ONE = {
  article: 'Artykuł',
  blog: 'Blog',
  paper: 'Publikacja',
  pdf: 'PDF',
  video: 'Wideo',
  podcast: 'Podcast',
  thread: 'Wpis',
  book: 'Książka',
};
const KIND_MANY = {
  article: 'Artykuły',
  blog: 'Blogi',
  paper: 'Publikacje',
  pdf: 'PDF',
  video: 'Wideo',
  podcast: 'Podcasty',
  thread: 'Wpisy',
  book: 'Książki',
};
const STATUS_TABS = [
  ['unread', 'Do przeczytania'],
  ['read', 'Przeczytane'],
  ['all', 'Wszystkie'],
];

const ICON = {
  gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg>',
  cloud: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.5 19H7a5 5 0 1 1 1.1-9.9A6 6 0 0 1 19.6 11a4 4 0 0 1-2.1 8Z"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5 8 12l7 7"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  file: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5M12 11v6M9 14h6"/></svg>',
  book: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6.5C10.5 5 8 4.5 4 4.5v13c4 0 6.5.5 8 2 1.5-1.5 4-2 8-2v-13c-4 0-6.5.5-8 2Z"/><path d="M12 6.5v13"/></svg>',
};

const storage = openStorage();
let doc = S.loadDoc(storage);
let saveFailed = !storage;

const PREFS_KEY = 'doczytania:prefs';
const prefs = { status: 'unread', kind: '', tag: '', readerSize: 2, ...readJson(PREFS_KEY) };

const ui = {
  view: 'list', // 'list' | 'settings' | 'reader'
  query: '',
  editId: null,
  editIntro: '', // text above the edit form, e.g. after sharing
  toast: null, // { text, action, run }
  toastTimer: 0,
  confirmDelete: false,
  syncRepo: null,
  syncPerson: null,
  syncToken: null,
  syncError: null,
  syncConnecting: false,
  importMsg: '',
  readerId: null, // the link whose text is open
  readerFor: null, // which text is being loaded (textKey)
  readerHtml: null,
  readerError: null,
  listScroll: 0,
};

const app = document.getElementById('app');
const sheet = document.getElementById('sheet');

function openStorage() {
  try {
    const ls = window.localStorage;
    ls.setItem('doczytania:probe', '1');
    ls.removeItem('doczytania:probe');
    return ls;
  } catch {
    return null;
  }
}

function readJson(key) {
  try {
    return JSON.parse(storage?.getItem(key) ?? 'null') ?? {};
  } catch {
    return {};
  }
}

function savePrefs() {
  try {
    storage?.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Filters then last until the page closes.
  }
}

function persist() {
  if (!S.saveDoc(storage, doc)) saveFailed = true;
  scheduleSync();
}

// ---------- sync with GitHub ----------
//
// The connection (repository, person and token) is kept on this device
// only, under its own key, so it never goes into a backup file or into the
// shared data. The data go to <person>/doczytania.json in the repository.

const SYNC_KEY = 'doczytania:sync';
const SYNC_DELAY = 5000;
const DEFAULT_SYNC_REPO = 'gchrupala/app-data';
// Page data for new links come from a GitHub Action a minute or so after a
// push; look for them a few times while the app is open.
const META_CHECK_DELAY = 75000;
const META_CHECKS = 4;
let syncConfig = loadSyncConfig();
const sync = { busy: false, again: false, timer: 0, metaTimer: 0, metaChecks: 0 };

function loadSyncConfig() {
  const c = readJson(SYNC_KEY);
  if (c?.repo && c?.token && c?.person) return c;
  // Myo on the same site uses the same kind of connection: offer it.
  const myo = readJson('myo:sync');
  if (myo?.repo && myo?.token) Object.assign(ui, { syncRepo: myo.repo, syncPerson: myo.person ?? '', syncToken: myo.token });
  return null;
}

const remoteFor = (c) => gitHubRemote({ repo: c.repo, token: c.token, path: syncPath(c.person) });

function saveSyncConfig() {
  try {
    if (syncConfig) storage?.setItem(SYNC_KEY, JSON.stringify(syncConfig));
    else storage?.removeItem(SYNC_KEY);
  } catch {
    // Without storage the connection lasts until the page closes.
  }
}

function scheduleSync(delay = SYNC_DELAY) {
  if (!syncConfig) return;
  clearTimeout(sync.timer);
  sync.timer = setTimeout(syncNow, delay);
}

async function syncNow() {
  const config = syncConfig;
  if (!config) return;
  if (sync.busy) {
    sync.again = true;
    return;
  }
  clearTimeout(sync.timer);
  sync.timer = 0;
  sync.busy = true;
  render();
  let result = { error: null };
  try {
    // Files first: the Action starts when the data file changes.
    await uploadPending(config);
    await syncOnce({
      remote: remoteFor(config),
      getLocal: () => doc,
      apply: (merged) => {
        doc = merged;
        if (!S.saveDoc(storage, doc)) saveFailed = true;
      },
      now: Date.now(),
    });
    result = { lastSyncAt: Date.now(), error: null };
  } catch (e) {
    // Being offline is not shown as an error; the next change, a return to
    // the app or getting back online tries again.
    result = e?.kind === 'network' ? {} : { error: e?.kind ?? 'bad' };
  } finally {
    sync.busy = false;
    if (syncConfig === config) {
      syncConfig = { ...config, ...result };
      saveSyncConfig();
    }
    render();
    if (sync.again) {
      sync.again = false;
      scheduleSync(1000);
    } else {
      watchForMeta();
    }
  }
}

function watchForMeta() {
  clearTimeout(sync.metaTimer);
  if (!syncConfig || syncConfig.error || !S.waitingForMeta(doc) || sync.metaChecks >= META_CHECKS) return;
  sync.metaTimer = setTimeout(() => {
    sync.metaChecks += 1;
    if (document.visibilityState === 'visible') syncNow();
  }, META_CHECK_DELAY);
}

async function connectSync(repoInput, personInput, tokenInput) {
  const repo = parseRepo(repoInput);
  const person = parsePerson(personInput);
  const token = String(tokenInput ?? '').trim();
  Object.assign(ui, { syncRepo: repoInput, syncPerson: personInput, syncToken: token, syncError: null });
  if (!repo) ui.syncError = 'repoFormat';
  else if (!person) ui.syncError = 'person';
  else if (!token) ui.syncError = 'token';
  if (ui.syncError) {
    render();
    return;
  }
  ui.syncConnecting = true;
  render();
  try {
    await remoteFor({ repo, person, token }).checkRepo();
    syncConfig = { repo, person, token, lastSyncAt: null, error: null };
    saveSyncConfig();
    Object.assign(ui, { syncRepo: null, syncPerson: null, syncToken: null, syncConnecting: false });
    await syncNow();
  } catch (e) {
    Object.assign(ui, { syncError: e?.kind ?? 'bad', syncConnecting: false });
    render();
  }
}

const SYNC_ERRORS = {
  repoFormat: 'Wpisz repozytorium jako właściciel/nazwa, np. gchrupala/app-data.',
  person: 'Wpisz imię. Od niego zależy folder z danymi w repozytorium.',
  token: 'Wklej token.',
  auth: 'GitHub nie przyjął tokena. Mógł wygasnąć; utwórz nowy i połącz ponownie.',
  forbidden: 'Token nie ma prawa zapisu w tym repozytorium (Contents: Read and write).',
  notFound: 'Nie ma takiego repozytorium albo token nie ma do niego dostępu.',
  public: 'To repozytorium jest publiczne. Użyj prywatnego.',
  conflict: 'Plik w repozytorium zmieniał się w trakcie. Spróbuj jeszcze raz.',
  bad: 'Synchronizacja się nie udała. Plik w repozytorium może być uszkodzony.',
};

// ---------- formatting ----------

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const rtf = new Intl.RelativeTimeFormat('pl', { numeric: 'auto' });
const dateFmt = new Intl.DateTimeFormat('pl', { day: 'numeric', month: 'short', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('pl', { hour: '2-digit', minute: '2-digit' });

function ago(ms, now = Date.now()) {
  const s = (ms - now) / 1000;
  if (s > -60) return 'przed chwilą';
  if (s > -3600) return rtf.format(Math.round(s / 60), 'minute');
  const day = (d) => new Date(d).setHours(0, 0, 0, 0);
  const days = Math.round((day(ms) - day(now)) / 86400000);
  if (days === 0) return `dziś, ${timeFmt.format(ms)}`;
  if (days > -7) return rtf.format(days, 'day');
  return dateFmt.format(ms);
}

// ---------- views ----------

function render() {
  const focus = rememberFocus();
  if (ui.view === 'reader' && !readerItem()) ui.view = 'list'; // deleted on another device
  document.title =
    ui.view === 'settings' ? 'Ustawienia — Doczytania' : ui.view === 'reader' ? `${S.titleOf(readerItem())} — Doczytania` : 'Doczytania';
  if (ui.view === 'reader') renderReader();
  else app.innerHTML = ui.view === 'settings' ? settingsView() : listView();
  renderSheet();
  renderToast();
  restoreFocus(focus);
}

function rememberFocus() {
  const el = document.activeElement;
  if (!el?.id || !app.contains(el)) return null;
  return { id: el.id, start: el.selectionStart, end: el.selectionEnd };
}

function restoreFocus(f) {
  if (!f) return;
  const el = document.getElementById(f.id);
  if (!el) return;
  el.focus({ preventScroll: true });
  if (f.start != null && el.setSelectionRange) {
    try {
      el.setSelectionRange(f.start, f.end);
    } catch {
      // Some input types have no selection.
    }
  }
}

function syncButton() {
  if (!syncConfig) return '';
  const state = sync.busy ? 'busy' : syncConfig.error ? 'error' : 'ok';
  const label = sync.busy
    ? 'Synchronizuję…'
    : syncConfig.error
      ? 'Synchronizacja nie działa'
      : syncConfig.lastSyncAt
        ? `Zsynchronizowano ${ago(syncConfig.lastSyncAt)}. Synchronizuj teraz`
        : 'Synchronizuj teraz';
  return `<button class="icon-btn sync-${state}" type="button" data-action="${syncConfig.error ? 'settings' : 'sync-now'}" title="${esc(label)}" aria-label="${esc(label)}">${ICON.cloud}</button>`;
}

function notices() {
  const out = [];
  if (saveFailed) out.push('<p class="notice">Przeglądarka nie zapisuje danych na tym urządzeniu (np. tryb prywatny). Po zamknięciu strony zmiany przepadną.</p>');
  if (syncConfig?.error) out.push('<button class="notice notice-link" type="button" data-action="settings">Synchronizacja z GitHubem nie działa. Szczegóły w ustawieniach.</button>');
  return out.join('');
}

function listView() {
  return `<header class="bar">
      <h1>Doczytania</h1>
      <div class="bar-actions">${syncButton()}<button class="icon-btn" type="button" data-action="pick-pdf" title="Dodaj plik PDF" aria-label="Dodaj plik PDF">${ICON.file}</button><button class="icon-btn" type="button" data-action="settings" aria-label="Ustawienia" title="Ustawienia">${ICON.gear}</button></div>
    </header>
    ${notices()}
    <form class="search" id="search-form" role="search">
      <span class="search-icon">${ICON.search}</span>
      <input id="q" type="search" enterkeyhint="search" placeholder="Szukaj albo wklej link" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(ui.query)}" aria-label="Szukaj albo wklej link">
      <span id="search-actions" class="search-actions">${searchActions()}</span>
    </form>
    <div id="results">${results()}</div>`;
}

const pastedUrl = () => (/\s/.test(ui.query.trim()) ? null : S.cleanUrl(ui.query));

function searchActions() {
  const pasted = pastedUrl();
  return `${ui.query ? `<button class="icon-btn small" type="button" data-action="clear-query" aria-label="Wyczyść">${ICON.close}</button>` : ''}
    ${pasted ? '<button class="btn primary" type="submit">Dodaj</button>' : navigator.clipboard?.readText && !ui.query ? '<button class="btn" type="button" data-action="paste">Wklej</button>' : ''}`;
}

function results() {
  const all = doc.items;
  const counts = { unread: 0, read: 0, all: all.length };
  for (const i of all) counts[i.status] += 1;
  const scoped = prefs.status === 'all' ? all : all.filter((i) => i.status === prefs.status);
  const kinds = S.kindCounts(scoped);
  const tags = S.tagCounts(scoped);
  if (prefs.kind && !kinds.some(([k]) => k === prefs.kind)) prefs.kind = '';
  if (prefs.tag && !tags.some(([t]) => t === prefs.tag)) prefs.tag = '';
  const items = S.filterItems(all, { query: ui.query, status: prefs.status, kind: prefs.kind, tag: prefs.tag });
  const pasted = pastedUrl();
  const known = pasted && S.findByUrl(doc, pasted);

  const tabs = STATUS_TABS.map(
    ([key, label]) =>
      `<button type="button" role="tab" aria-selected="${prefs.status === key}" data-action="status" data-status="${key}">${label} <span class="count">${counts[key]}</span></button>`,
  ).join('');

  const chip = (action, value, label, count, on) =>
    `<button type="button" class="chip${on ? ' on' : ''}" aria-pressed="${on}" data-action="${action}" data-value="${esc(value)}">${esc(label)} <span class="count">${count}</span></button>`;
  const kindChips = kinds.length > 1 || prefs.kind ? kinds.map(([k, n]) => chip('kind', k, KIND_MANY[k], n, prefs.kind === k)).join('') : '';
  const tagChips = tags.map(([t, n]) => chip('tag', t, `#${t}`, n, prefs.tag === t)).join('');
  const filters = kindChips || tagChips ? `<div class="chips" aria-label="Filtry">${kindChips}${tagChips}</div>` : '';

  let body;
  if (items.length) body = `<ul class="items">${items.map(itemView).join('')}</ul>`;
  else if (!all.length) body = pasted ? '' : emptyHelp();
  else if (pasted) body = '';
  else body = `<p class="empty">Nic tu nie pasuje${ui.query || prefs.kind || prefs.tag ? '. <button type="button" class="link" data-action="clear-filters">Pokaż wszystko</button>' : '.'}</p>`;

  const addHint = pasted
    ? `<p class="add-hint">${known ? 'Ten link już jest na liście. „Dodaj” przywróci go do przeczytania.' : 'To jest link. Naciśnij „Dodaj”, żeby go zapisać.'}</p>`
    : '';
  return `${addHint}<div class="tabs" role="tablist">${tabs}</div>${filters}${body}`;
}

// While typing in the search field only the results change, so the field
// (and the phone keyboard) stays as it is.
function renderResults() {
  const actions = document.getElementById('search-actions');
  const box = document.getElementById('results');
  if (!actions || !box) return render();
  actions.innerHTML = searchActions();
  box.innerHTML = results();
}

function itemView(item) {
  const kind = S.kindOf(item);
  const minutes = S.readingMinutes(item);
  const site = item.file ? 'Plik' : item.meta?.site || S.domainOf(item.url);
  const info = [esc(site), KIND_ONE[kind], minutes ? `${minutes} min` : '', esc(ago(item.addedAt))].filter(Boolean).join(' · ');
  const desc = S.descriptionOf(item);
  const read = item.status === 'read';
  const tags = item.tags.length
    ? `<div class="item-tags">${item.tags.map((t) => `<button type="button" class="tag" data-action="tag" data-value="${esc(t)}">#${esc(t)}</button>`).join('')}</div>`
    : '';
  return `<li class="item${read ? ' read' : ''}" data-id="${esc(item.id)}">
    <button type="button" class="check" data-action="toggle" aria-pressed="${read}" aria-label="${read ? 'Przywróć do przeczytania' : 'Oznacz jako przeczytane'}" title="${read ? 'Przywróć do przeczytania' : 'Przeczytane'}">${ICON.check}</button>
    <div class="item-body">
      <a class="item-title" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(S.titleOf(item))}</a>
      <p class="item-info">${info}</p>
      ${desc ? `<p class="item-desc">${esc(desc)}</p>` : ''}
      ${item.note ? `<p class="item-note">${esc(item.note)}</p>` : ''}
      ${tags}
      ${textButton(item)}
    </div>
    <button type="button" class="icon-btn small edit" data-action="edit" aria-label="Edytuj" title="Edytuj">${ICON.edit}</button>
  </li>`;
}

// "Read" for a PDF with a text; for a sent file, where its text is.
function textButton(item) {
  if (S.textOf(item)) {
    return `<button type="button" class="btn small read-text" data-action="reader">${ICON.book} Czytaj</button>`;
  }
  if (!item.file) return '';
  if (pendingFiles.has(item.id)) return '<p class="item-state">Plik czeka na wysłanie do GitHuba.</p>';
  if (item.meta?.reflow?.error) return '<p class="item-state">Nie udało się przygotować tekstu.</p>';
  return '<p class="item-state">GitHub przygotowuje tekst…</p>';
}

function emptyHelp() {
  return `<div class="empty help">
    <p><strong>Lista jest pusta.</strong></p>
    <p>Wklej link w pole powyżej albo udostępnij go z innej aplikacji. Sposoby dodawania na telefonie i komputerze są w <button type="button" class="link" data-action="settings">ustawieniach</button>.</p>
  </div>`;
}

// ---------- edit sheet ----------

function renderSheet() {
  const item = ui.editId && doc.items.find((i) => i.id === ui.editId);
  if (!item) {
    if (sheet.open) sheet.close();
    sheet.dataset.id = '';
    ui.editId = null;
    return;
  }
  if (sheet.open && sheet.dataset.id === item.id) return; // keep what is being typed
  sheet.dataset.id = item.id;
  const guessed = S.guessKind(item.url, item.meta);
  const kinds = [`<option value="">Automatycznie (${KIND_ONE[guessed]})</option>`]
    .concat(S.KINDS.map((k) => `<option value="${k}"${item.kind === k ? ' selected' : ''}>${KIND_ONE[k]}</option>`))
    .join('');
  const known = S.tagCounts(doc.items).map(([t]) => t);
  const suggestions = known.length
    ? `<div class="chips tag-suggest" aria-label="Twoje tagi">${known
        .slice(0, 40)
        .map((t) => `<button type="button" class="chip${item.tags.includes(t) ? ' on' : ''}" data-action="sheet-tag" data-value="${esc(t)}">#${esc(t)}</button>`)
        .join('')}</div>`
    : '';
  const meta = item.meta;
  const waitingText = S.waitingForText(item) && syncConfig;
  const page = meta
    ? meta.error
      ? `<p class="field-note">Nie udało się pobrać opisu strony (${esc(meta.error)}).</p>`
      : `<p class="field-note">${item.file ? 'Opis pliku' : 'Opis strony'} pobrany ${esc(ago(meta.fetchedAt))}${meta.title && meta.title !== item.title ? `: „${esc(meta.title)}”` : ''}.</p>`
    : syncConfig
      ? waitingText
        ? '<p class="field-note">Tytuł i tekst do czytania pojawią się po synchronizacji, gdy GitHub przetworzy PDF.</p>'
        : '<p class="field-note">Tytuł, opis i czas czytania pojawią się po synchronizacji, gdy GitHub pobierze stronę.</p>'
      : '';
  const text = S.textOf(item);
  const reflow = meta?.reflow;
  const textNote = text
    ? `<p class="field-note">Tekst do czytania: ${[text.pages ? `${text.pages} str.` : '', S.readingMinutes(item) ? `${S.readingMinutes(item)} min` : ''].filter(Boolean).join(', ')}. <button type="button" class="link" data-action="reader">Czytaj</button></p>`
    : reflow?.error
      ? `<p class="field-note">Nie udało się przygotować tekstu z PDF-a (${esc(reflow.error)}).</p>`
      : waitingText && meta
        ? '<p class="field-note">Tekst do czytania pojawi się po synchronizacji, gdy GitHub przetworzy PDF.</p>'
        : '';
  const link = item.file
    ? `<a class="sheet-link" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">Plik: ${esc(item.file.name)}${item.file.size ? ` (${esc(sizeText(item.file.size))})` : ''}</a>`
    : `<a class="sheet-link" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(S.prettyUrl(item.url))}</a>`;
  const urlField = item.file
    ? ''
    : `<label for="f-url">Adres</label>
    <input id="f-url" name="url" type="url" value="${esc(item.url)}" autocapitalize="off" spellcheck="false">`;
  sheet.innerHTML = `<form method="dialog" id="edit-form" class="edit">
    <div class="sheet-head">
      <h2>${ui.editIntro ? esc(ui.editIntro) : 'Edycja'}</h2>
      <button type="button" class="icon-btn small" data-action="sheet-close" aria-label="Zamknij">${ICON.close}</button>
    </div>
    ${link}
    ${page}
    ${textNote}
    <label for="f-title">Tytuł</label>
    <input id="f-title" name="title" type="text" value="${esc(item.title)}" placeholder="${esc(meta?.title || item.file?.name || S.prettyUrl(item.url))}">
    <label for="f-tags">Tagi <span class="hint">(oddzielone przecinkami)</span></label>
    <input id="f-tags" name="tags" type="text" value="${esc(item.tags.join(', '))}" autocapitalize="off" spellcheck="false">
    ${suggestions}
    <label for="f-kind">Rodzaj</label>
    <select id="f-kind" name="kind">${kinds}</select>
    <label for="f-note">Notatka</label>
    <textarea id="f-note" name="note" rows="3">${esc(item.note)}</textarea>
    ${urlField}
    <label class="check-row"><input type="checkbox" name="read"${item.status === 'read' ? ' checked' : ''}> Przeczytane</label>
    <div class="sheet-actions">
      <button type="button" class="btn${ui.confirmDelete ? ' danger' : ''}" data-action="delete">${ui.confirmDelete ? 'Na pewno usunąć?' : 'Usuń'}</button>
      <button type="submit" class="btn primary">Gotowe</button>
    </div>
  </form>`;
  if (!sheet.open) {
    sheet.showModal();
    if (ui.editIntro) sheet.querySelector('#f-tags')?.focus();
    else sheet.querySelector('.sheet-head button')?.focus();
  }
}

function openEdit(id, intro = '') {
  ui.editId = id;
  ui.editIntro = intro;
  ui.confirmDelete = false;
  pushNav('edit');
  render();
}

function saveSheet() {
  const form = sheet.querySelector('#edit-form');
  if (!form || !ui.editId) return;
  const f = new FormData(form);
  const patch = {
    title: f.get('title'),
    tags: f.get('tags'),
    kind: f.get('kind'),
    note: f.get('note'),
    status: f.get('read') ? 'read' : 'unread',
  };
  if (f.has('url')) patch.url = f.get('url');
  S.updateItem(doc, ui.editId, patch, Date.now());
  persist();
}

function closeSheet() {
  ui.editId = null;
  ui.editIntro = '';
  ui.confirmDelete = false;
  if (navDepth() && history.state?.screen === 'edit') history.back();
  render();
}

// ---------- settings ----------

function settingsView() {
  const base = new URL('./', location.href).href;
  const bookmarklet = `javascript:(()=>{window.open('${base}?url='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title),'doczytania')})()`;
  const tags = S.tagCounts(doc.items);
  return `<header class="bar">
      <button class="icon-btn" type="button" data-action="back" aria-label="Wróć">${ICON.back}</button>
      <h1>Ustawienia</h1>
      <span class="bar-spacer"></span>
    </header>
    ${notices()}
    ${syncSection()}
    <section>
      <h2>Dodawanie linków</h2>
      <p><strong>Telefon:</strong> zainstaluj aplikację (Chrome → ⋮ → „Zainstaluj aplikację”), a potem w dowolnej aplikacji wybierz „Udostępnij” → Doczytania.</p>
      <p><strong>Komputer:</strong> przeciągnij <a class="btn small bookmarklet" href="${esc(bookmarklet)}" data-action="bookmarklet">+ Doczytania</a> na pasek zakładek albo wklej link w pole wyszukiwania.</p>
      <p><strong>PDF:</strong> udostępnij plik do Doczytań, dodaj go przyciskiem z kartką u góry listy albo przeciągnij na listę. Plik trafia do repozytorium z danymi, więc potrzebna jest synchronizacja. GitHub zamienia go na tekst, który dobrze się czyta na telefonie (przycisk „Czytaj”). Tak samo z linkami do PDF-ów i arXiv.</p>
    </section>
    ${tags.length ? tagsSection(tags) : ''}
    <section>
      <h2>Kopia</h2>
      <div class="row">
        <button class="btn" type="button" data-action="export">Pobierz</button>
        <button class="btn" type="button" data-action="pick-import">Wczytaj</button>
      </div>
      ${ui.importMsg ? `<p class="field-note" role="status">${esc(ui.importMsg)}</p>` : ''}
    </section>
    <p class="version">Doczytania ${VERSION} · linków: ${doc.items.length} · <a href="https://github.com/gchrupala/doczytania" target="_blank" rel="noopener">kod</a></p>`;
}

function tagsSection(tags) {
  return `<section>
    <h2>Tagi</h2>
    <ul class="tag-list">${tags
      .map(
        ([t, n]) => `<li><span>#${esc(t)} <span class="count">${n}</span></span>
        <span class="row"><button class="btn small" type="button" data-action="rename-tag" data-value="${esc(t)}">Zmień</button>
        <button class="btn small" type="button" data-action="remove-tag" data-value="${esc(t)}">Usuń</button></span></li>`,
      )
      .join('')}</ul>
  </section>`;
}

function syncSection() {
  const c = syncConfig;
  const error = c ? c.error : ui.syncError;
  const errorHtml = error ? `<p class="error" role="alert">${esc(SYNC_ERRORS[error] ?? SYNC_ERRORS.bad)}</p>` : '';
  const head = '<h2>Synchronizacja</h2>';
  if (c) {
    const status = sync.busy ? 'Synchronizuję…' : c.lastSyncAt ? `Ostatnio ${ago(c.lastSyncAt)}` : 'Jeszcze nie';
    return `<section>${head}
      <p>${esc(c.repo)} · ${esc(c.person)}<br><span class="field-note" role="status">${esc(status)}</span></p>
      ${errorHtml}
      <div class="row">
        <button class="btn" type="button" data-action="sync-now"${sync.busy ? ' disabled' : ''}>Synchronizuj</button>
        <button class="btn${ui.confirmDisconnect ? ' danger' : ''}" type="button" data-action="sync-off">${ui.confirmDisconnect ? 'Na pewno?' : 'Odłącz'}</button>
      </div>
    </section>`;
  }
  return `<section>${head}
    <p class="field-note">Prywatne repozytorium GitHub, jak w Myo. Token może być ten sam.</p>
    <form id="sync-form" class="edit" novalidate>
      <label for="sync-repo">Repozytorium</label>
      <input id="sync-repo" type="text" placeholder="właściciel/nazwa" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(ui.syncRepo ?? DEFAULT_SYNC_REPO)}">
      <label for="sync-person">Imię</label>
      <input id="sync-person" type="text" placeholder="np. Grzegorz" autocomplete="off" spellcheck="false" value="${esc(ui.syncPerson ?? '')}">
      <label for="sync-token">Token <a class="label-link" href="https://github.com/settings/personal-access-tokens/new?name=Doczytania&amp;description=Doczytania+sync&amp;expires_in=366&amp;contents=write" target="_blank" rel="noopener">utwórz</a></label>
      <input id="sync-token" class="token" type="text" placeholder="github_pat_…" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" value="${esc(ui.syncToken ?? '')}">
      ${errorHtml}
      <button class="btn primary wide" type="submit"${ui.syncConnecting ? ' disabled' : ''}>${ui.syncConnecting ? 'Łączę…' : 'Połącz'}</button>
    </form>
  </section>`;
}

// ---------- toast ----------

function toast(text, action, run) {
  clearTimeout(ui.toastTimer);
  ui.toast = { text, action, run };
  ui.toastTimer = setTimeout(() => {
    ui.toast = null;
    renderToast();
  }, 6000);
  renderToast();
}

function renderToast() {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  const host = sheet.open ? sheet : document.body;
  if (el.parentNode !== host) host.append(el);
  el.className = ui.toast ? 'toast show' : 'toast';
  el.innerHTML = ui.toast
    ? `<span>${esc(ui.toast.text)}</span>${ui.toast.action ? `<button type="button" class="link" data-action="toast">${esc(ui.toast.action)}</button>` : ''}`
    : '';
}

// ---------- navigation (the phone's back gesture) ----------

const navDepth = () => Number(history.state?.depth ?? 0);

function pushNav(screen) {
  try {
    history.pushState({ screen, depth: navDepth() + 1 }, '');
  } catch {
    // Embedded frames may refuse; buttons still work.
  }
}

function replaceNav(screen) {
  try {
    history.replaceState({ screen, depth: navDepth() }, '');
  } catch {
    // See pushNav.
  }
}

window.addEventListener('popstate', () => {
  const screen = history.state?.screen ?? 'list';
  if (screen !== 'edit' && ui.editId) {
    ui.editId = null;
    ui.editIntro = '';
  }
  const wasReader = ui.view === 'reader';
  if (screen === 'list') ui.view = 'list';
  else if (screen === 'settings') ui.view = 'settings';
  else if (screen === 'reader' && readerItem()) ui.view = 'reader';
  render();
  if (wasReader && ui.view === 'list') window.scrollTo(0, ui.listScroll);
});

function goSettings() {
  ui.view = 'settings';
  ui.confirmDisconnect = false;
  pushNav('settings');
  render();
  window.scrollTo(0, 0);
}

function goBack() {
  if (navDepth()) history.back();
  else {
    ui.view = 'list';
    render();
  }
}

// ---------- adding links ----------

function addLink(input, { fromShare = false } = {}) {
  const now = Date.now();
  const res = S.addItem(doc, input, now);
  if (!res) {
    toast('To nie jest link, który da się zapisać.');
    return null;
  }
  sync.metaChecks = 0;
  persist();
  if (prefs.status === 'read') prefs.status = 'unread';
  prefs.kind = '';
  prefs.tag = '';
  savePrefs();
  ui.query = '';
  if (fromShare) openEdit(res.item.id, res.existed ? 'Już było na liście' : 'Zapisano');
  else {
    render();
    toast(res.existed ? 'Ten link już był. Jest znowu do przeczytania.' : 'Zapisano.', 'Edytuj', () => openEdit(res.item.id));
  }
  return res;
}

// Links shared from other apps (Web Share Target, manifest) and from the
// bookmarklet arrive as ?url=&title=&text= in the address.
function takeSharedLink() {
  const params = new URLSearchParams(location.search);
  if (!['url', 'text', 'title'].some((k) => params.has(k))) return;
  const shared = S.extractShared({ url: params.get('url'), title: params.get('title'), text: params.get('text') });
  try {
    history.replaceState({ screen: 'list', depth: 0 }, '', location.pathname);
  } catch {
    // The parameters then stay in the address bar; harmless.
  }
  if (shared) addLink(shared, { fromShare: true });
  else toast('W udostępnionym tekście nie było linku.');
}

// ---------- reading view ----------
//
// The text of a PDF (Markdown from the Action) is fetched from the data
// repository when it is first opened, then kept in the cache storage for
// reading offline. The place where reading stopped is kept per link.

const readerItem = () => (ui.readerId ? (doc.items.find((i) => i.id === ui.readerId) ?? null) : null);
const textKey = (item) => new URL(`texts/${item.id}.md?at=${S.textOf(item).at}`, location.href).href;

const READER_ERRORS = {
  nosync: 'Tekst jest w repozytorium z danymi. Żeby go otworzyć, połącz synchronizację w ustawieniach.',
  network: 'Brak internetu, a tego tekstu nie otwierano jeszcze na tym urządzeniu.',
  notFound: 'Tekstu nie ma jeszcze w repozytorium. Spróbuj za chwilę.',
  auth: 'GitHub nie przyjął tokena. Połącz synchronizację ponownie w ustawieniach.',
  bad: 'Nie udało się wczytać tekstu.',
};

async function loadText(item) {
  const key = textKey(item);
  const cache = await openCache(TEXTS_CACHE);
  const hit = await cache?.match(key);
  if (hit) return hit.text();
  if (!syncConfig) throw Object.assign(new Error('nosync'), { kind: 'nosync' });
  const text = await remoteFor(syncConfig).readText(S.textOf(item).path);
  try {
    for (const req of (await cache?.keys()) ?? []) if (req.url.includes(`/texts/${item.id}.md`)) await cache.delete(req);
    await cache?.put(key, new Response(text, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } }));
  } catch {
    // Not kept for offline; it still opens now.
  }
  return text;
}

function openReader(id) {
  const item = doc.items.find((i) => i.id === id);
  if (!item || !S.textOf(item)) return;
  if (ui.view === 'list') ui.listScroll = window.scrollY;
  const here = history.state?.screen;
  Object.assign(ui, { view: 'reader', readerId: id, readerHtml: null, readerError: null });
  if (here === 'edit' || here === 'reader') replaceNav('reader');
  else pushNav('reader');
  render();
  window.scrollTo(0, 0);
  const key = textKey(item);
  ui.readerFor = key;
  loadText(item)
    .then((md) => {
      if (ui.readerFor !== key) return;
      ui.readerHtml = renderMarkdown(dropTitle(md, S.titleOf(item)));
      render();
      restorePosition(id);
    })
    .catch((e) => {
      if (ui.readerFor !== key) return;
      ui.readerError = e?.kind ?? 'bad';
      render();
    });
}

// The text itself is not rebuilt on every render (sync state, a toggle),
// so the scroll position and a selection stay where they are.
function renderReader() {
  const item = readerItem();
  const key = `${item.id}:${prefs.readerSize}:${ui.readerHtml ? 'text' : (ui.readerError ?? 'loading')}`;
  const body = document.getElementById('reader-body');
  if (body?.dataset.key === key) {
    document.getElementById('reader-bar').innerHTML = readerBar(item);
    document.getElementById('reader-end').innerHTML = readerEnd(item);
    return;
  }
  app.innerHTML = `<header class="bar reader-bar" id="reader-bar">${readerBar(item)}</header>
    <article class="reader size-${prefs.readerSize}" id="reader-body" data-key="${esc(key)}" lang="${esc(item.meta?.lang || '')}">${readerContent(item)}</article>
    <footer class="reader-end" id="reader-end">${readerEnd(item)}</footer>`;
}

function readerBar(item) {
  return `<button class="icon-btn" type="button" data-action="back" aria-label="Wróć" title="Wróć">${ICON.back}</button>
    <p class="reader-bar-title">${esc(S.titleOf(item))}</p>
    <div class="bar-actions">
      <button class="icon-btn small text-size" type="button" data-action="reader-size" data-value="-1" aria-label="Mniejsze litery" title="Mniejsze litery"${prefs.readerSize <= 0 ? ' disabled' : ''}>A−</button>
      <button class="icon-btn small text-size" type="button" data-action="reader-size" data-value="1" aria-label="Większe litery" title="Większe litery"${prefs.readerSize >= 4 ? ' disabled' : ''}>A+</button>
    </div>`;
}

function readerContent(item) {
  const text = S.textOf(item);
  const m = item.meta ?? {};
  const author = m.author && m.author.length > 90 ? `${m.author.slice(0, 88).replace(/[\s;,]+\S*$/, '')} i in.` : m.author;
  const info = [
    esc(author || ''),
    esc(item.file ? item.file.name : m.site || S.domainOf(item.url)),
    text.pages ? `${text.pages} str. PDF` : '',
    S.readingMinutes(item) ? `${S.readingMinutes(item)} min` : '',
    `<a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${item.file ? 'plik PDF' : 'oryginał'}</a>`,
  ]
    .filter(Boolean)
    .join(' · ');
  let body;
  if (ui.readerHtml) body = `<div class="reader-text">${ui.readerHtml}</div>`;
  else if (ui.readerError) {
    body = `<p class="error" role="alert">${esc(READER_ERRORS[ui.readerError] ?? READER_ERRORS.bad)}</p>
      <div class="row"><button class="btn" type="button" data-action="reader-retry">Spróbuj ponownie</button></div>`;
  } else body = '<p class="field-note" role="status">Wczytuję tekst…</p>';
  return `<h1>${esc(S.titleOf(item))}</h1>
    <p class="reader-info">${info}</p>
    <p class="reader-warn">Tekst wyciągnięty z PDF-a, bez rysunków i wzorów.</p>
    ${body}`;
}

function readerEnd(item) {
  if (!ui.readerHtml) return '';
  const read = item.status === 'read';
  return `<button class="btn${read ? '' : ' primary'}" type="button" data-action="reader-toggle">${read ? 'Przywróć do przeczytania' : 'Oznacz jako przeczytane'}</button>
    <button class="btn" type="button" data-action="back">Wróć do listy</button>`;
}

const POS_KEY = 'doczytania:pos';
let posTimer = 0;

function savePosition() {
  if (ui.view !== 'reader' || !ui.readerHtml) return;
  const max = document.documentElement.scrollHeight - window.innerHeight;
  if (max <= 0) return;
  const all = readJson(POS_KEY);
  all[ui.readerId] = [Math.round((window.scrollY / max) * 10000) / 10000, Date.now()];
  const kept = Object.entries(all)
    .sort((a, b) => b[1][1] - a[1][1])
    .slice(0, 100);
  try {
    storage?.setItem(POS_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // The place is then not remembered.
  }
}

function restorePosition(id) {
  const at = readJson(POS_KEY)[id]?.[0];
  if (!(at > 0)) return;
  const max = document.documentElement.scrollHeight - window.innerHeight;
  window.scrollTo(0, at * max);
}

window.addEventListener('scroll', () => {
  if (ui.view !== 'reader') return;
  clearTimeout(posTimer);
  posTimer = setTimeout(savePosition, 400);
});

// ---------- PDF files ----------
//
// A PDF added on this device waits in the cache storage until the next sync
// sends it to <person>/doczytania/<id>.pdf in the data repository. There
// the Action takes the title from it and turns it into a text.

const FILES_CACHE = 'doczytania-files';
const TEXTS_CACHE = 'doczytania-texts';
const SHARE_CACHE = 'doczytania-share'; // files shared from other apps (sw.js)
const MAX_FILE = 40 * 1024 * 1024;
const pendingFiles = new Set();
const pendingKey = (id) => new URL(`pending/${id}.pdf`, location.href).href;
const failedUploads = new Set();

async function openCache(name) {
  try {
    return 'caches' in window ? await caches.open(name) : null;
  } catch {
    return null;
  }
}

// Files waiting to be sent; files and texts of deleted links go.
async function loadPendingFiles() {
  const ids = new Set(doc.items.map((i) => i.id));
  try {
    const files = await openCache(FILES_CACHE);
    for (const req of (await files?.keys()) ?? []) {
      const id = req.url.match(/\/pending\/([^/]+)\.pdf$/)?.[1];
      if (id && ids.has(id)) pendingFiles.add(id);
      else await files.delete(req);
    }
    const texts = await openCache(TEXTS_CACHE);
    for (const req of (await texts?.keys()) ?? []) {
      const id = req.url.match(/\/texts\/([^/]+)\.md/)?.[1];
      if (!id || !ids.has(id)) await texts.delete(req);
    }
  } catch {
    // Tried again at the next start.
  }
}

async function uploadPending(config) {
  if (!pendingFiles.size) return;
  const cache = await openCache(FILES_CACHE);
  const remote = remoteFor(config);
  for (const id of [...pendingFiles]) {
    const item = doc.items.find((i) => i.id === id);
    const res = await cache?.match(pendingKey(id));
    if (!item || !res) {
      pendingFiles.delete(id);
      await cache?.delete(pendingKey(id));
      continue;
    }
    try {
      await remote.putFile(filePath(config.person, id, 'pdf'), await res.arrayBuffer(), `Doczytania: plik ${item.file?.name ?? id}`);
    } catch (e) {
      // No connection or no access stops the whole sync; anything else is
      // about this file, which waits for the next sync.
      if (['network', 'auth', 'forbidden', 'notFound'].includes(e?.kind)) throw e;
      if (!failedUploads.has(id)) toast(`Nie udało się wysłać pliku ${item.file?.name ?? ''}. Spróbuję przy następnej synchronizacji.`);
      failedUploads.add(id);
      continue;
    }
    pendingFiles.delete(id);
    await cache?.delete(pendingKey(id));
  }
}

async function sha256Hex(bytes) {
  try {
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return undefined;
  }
}

const sizeText = (bytes) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} kB` : `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;

async function addPdfFiles(files) {
  const config = syncConfig;
  if (!config) {
    toast('Pliki PDF trafiają do repozytorium z danymi. Najpierw połącz synchronizację.', 'Ustawienia', goSettings);
    return;
  }
  const added = [];
  for (const file of files) {
    const name = file.name || 'plik.pdf';
    if (file.size > MAX_FILE) {
      toast(`${name} ma ponad 40 MB. Takiego pliku nie da się wysłać.`);
      continue;
    }
    const bytes = await file.arrayBuffer();
    if (new TextDecoder().decode(new Uint8Array(bytes, 0, Math.min(5, bytes.byteLength))) !== '%PDF-') {
      toast(`${name} nie jest plikiem PDF.`);
      continue;
    }
    const sha256 = await sha256Hex(bytes);
    const res = S.addFile(doc, { name, size: file.size, sha256 }, (id) => fileWebUrl(config.repo, filePath(config.person, id, 'pdf')), Date.now());
    if (!res.existed) {
      const cache = await openCache(FILES_CACHE);
      try {
        await cache.put(pendingKey(res.item.id), new Response(new Blob([bytes], { type: 'application/pdf' })));
        pendingFiles.add(res.item.id);
      } catch {
        // No room to keep it until the sync: send it now or give up.
        try {
          await remoteFor(config).putFile(filePath(config.person, res.item.id, 'pdf'), bytes, `Doczytania: plik ${name}`);
        } catch {
          doc.items = doc.items.filter((i) => i.id !== res.item.id);
          toast(`Nie udało się zapisać pliku ${name}.`);
          continue;
        }
      }
    }
    added.push(res);
  }
  if (!added.length) return;
  sync.metaChecks = 0;
  persist();
  scheduleSync(500);
  if (prefs.status === 'read') prefs.status = 'unread';
  Object.assign(prefs, { kind: '', tag: '' });
  savePrefs();
  ui.query = '';
  if (added.length === 1) openEdit(added[0].item.id, added[0].existed ? 'Ten PDF już był na liście' : 'Zapisano PDF');
  else {
    render();
    toast(`Zapisano pliki PDF: ${added.length}.`);
  }
}

// A file shared from another app: sw.js keeps it and opens ?file=<key>.
async function takeSharedFile() {
  const key = new URLSearchParams(location.search).get('file');
  if (!key) return;
  try {
    history.replaceState({ screen: 'list', depth: 0 }, '', location.pathname);
  } catch {
    // The parameter then stays in the address bar; harmless.
  }
  const cache = await openCache(SHARE_CACHE);
  const url = new URL(`shared/${encodeURIComponent(key)}`, location.href).href;
  const res = await cache?.match(url);
  if (!res) {
    toast('Nie udało się odebrać pliku.');
    return;
  }
  const name = decodeURIComponent(res.headers.get('X-File-Name') || '') || 'plik.pdf';
  const blob = await res.blob();
  await addPdfFiles([new File([blob], name, { type: blob.type || 'application/pdf' })]);
  for (const req of await cache.keys()) await cache.delete(req);
}

// PDFs dragged onto the window (on a computer).
document.addEventListener('dragover', (e) => {
  if (![...(e.dataTransfer?.types ?? [])].includes('Files')) return;
  e.preventDefault();
  document.body.classList.add('dropping');
});
document.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) document.body.classList.remove('dropping');
});
document.addEventListener('drop', (e) => {
  if (!e.dataTransfer?.files?.length) return;
  e.preventDefault();
  document.body.classList.remove('dropping');
  addPdfFiles([...e.dataTransfer.files]);
});

// ---------- backup ----------

function exportDoc() {
  const blob = new Blob([`${JSON.stringify(doc, null, 1)}\n`], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `doczytania-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importDoc(file) {
  try {
    const parsed = S.parseDoc(JSON.parse(await file.text()));
    if (!parsed) throw new Error();
    const before = doc.items.length;
    doc = S.mergeDocs(doc, parsed);
    persist();
    ui.importMsg = `Wczytano. Nowych linków: ${doc.items.length - before}.`;
  } catch {
    ui.importMsg = 'To nie jest plik z kopią Doczytań.';
  }
  render();
}

// ---------- events ----------

let lastToggle = null;

app.addEventListener('click', onClick);
sheet.addEventListener('click', onClick);

function onClick(e) {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  const id = el.closest('[data-id]')?.dataset.id;
  const value = el.dataset.value;
  switch (action) {
    case 'settings':
      goSettings();
      break;
    case 'back':
      goBack();
      break;
    case 'sync-now':
      syncNow();
      break;
    case 'sync-off':
      if (!ui.confirmDisconnect) {
        ui.confirmDisconnect = true;
        render();
        setTimeout(() => {
          ui.confirmDisconnect = false;
          if (ui.view === 'settings') render();
        }, 4000);
        break;
      }
      ui.confirmDisconnect = false;
      syncConfig = null;
      saveSyncConfig();
      render();
      break;
    case 'status':
      prefs.status = el.dataset.status;
      savePrefs();
      render();
      break;
    case 'kind':
      prefs.kind = prefs.kind === value ? '' : value;
      savePrefs();
      render();
      break;
    case 'tag':
      prefs.tag = prefs.tag === value ? '' : value;
      savePrefs();
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      break;
    case 'clear-filters':
      Object.assign(prefs, { kind: '', tag: '' });
      ui.query = '';
      savePrefs();
      render();
      break;
    case 'clear-query':
      ui.query = '';
      render();
      document.getElementById('q')?.focus();
      break;
    case 'paste':
      navigator.clipboard
        .readText()
        .then((text) => {
          const shared = S.extractShared({ text });
          if (shared) addLink(shared);
          else toast('W schowku nie ma linku.');
        })
        .catch(() => toast('Przeglądarka nie dała dostępu do schowka. Wklej link w pole.'));
      break;
    case 'toggle': {
      const item = S.toggleRead(doc, id, Date.now());
      if (!item) break;
      persist();
      lastToggle = id;
      render();
      if (prefs.status !== 'all') {
        toast(item.status === 'read' ? 'Przeczytane.' : 'Znowu do przeczytania.', 'Cofnij', () => {
          if (lastToggle !== id) return;
          S.toggleRead(doc, id, Date.now());
          persist();
          render();
        });
      }
      break;
    }
    case 'edit':
      openEdit(id);
      break;
    case 'reader': {
      const target = id ?? ui.editId;
      if (sheet.open) {
        saveSheet();
        ui.editId = null;
        ui.editIntro = '';
      }
      openReader(target);
      break;
    }
    case 'reader-retry':
      openReader(ui.readerId);
      break;
    case 'reader-size':
      prefs.readerSize = Math.max(0, Math.min(4, prefs.readerSize + Number(value)));
      savePrefs();
      render();
      break;
    case 'reader-toggle': {
      S.toggleRead(doc, ui.readerId, Date.now());
      persist();
      render();
      break;
    }
    case 'sheet-close':
      saveSheet();
      closeSheet();
      break;
    case 'sheet-tag': {
      const input = sheet.querySelector('#f-tags');
      const tags = S.parseTags(input.value.includes(',') || !input.value.trim() ? input.value : input.value.replace(/\s+/g, ', '));
      const next = tags.includes(value) ? tags.filter((t) => t !== value) : [...tags, value];
      input.value = next.join(', ');
      el.classList.toggle('on', next.includes(value));
      break;
    }
    case 'delete': {
      if (!ui.confirmDelete) {
        ui.confirmDelete = true;
        el.classList.add('danger');
        el.textContent = 'Na pewno usunąć?';
        break;
      }
      const item = S.deleteItem(doc, ui.editId, Date.now());
      persist();
      closeSheet();
      if (item) {
        toast('Usunięto.', 'Cofnij', () => {
          S.restoreItem(doc, item);
          persist();
          render();
        });
      }
      break;
    }
    case 'toast': {
      const run = ui.toast?.run;
      ui.toast = null;
      renderToast();
      run?.();
      break;
    }
    case 'bookmarklet':
      e.preventDefault();
      toast('Przeciągnij ten przycisk na pasek zakładek.');
      break;
    case 'export':
      exportDoc();
      break;
    case 'pick-import':
      pickFiles('application/json,.json', false, ([file]) => importDoc(file));
      break;
    case 'pick-pdf':
      pickFiles('application/pdf,.pdf', true, addPdfFiles);
      break;
    case 'rename-tag': {
      const to = prompt(`Nowa nazwa tagu #${value}:`, value);
      if (to == null || !to.trim()) break;
      S.renameTag(doc, value, to, Date.now());
      persist();
      render();
      break;
    }
    case 'remove-tag': {
      if (!confirm(`Usunąć tag #${value} ze wszystkich linków?`)) break;
      S.renameTag(doc, value, '', Date.now());
      if (prefs.tag === value) prefs.tag = '';
      persist();
      render();
      break;
    }
  }
}

// The toast lives in the sheet while it is open.
document.body.addEventListener('click', (e) => {
  if (e.target.closest('#toast [data-action="toast"]') && !app.contains(e.target) && !sheet.contains(e.target)) onClick(e);
});

app.addEventListener('input', (e) => {
  if (e.target.id !== 'q') return;
  ui.query = e.target.value;
  renderResults();
});

// File inputs live outside the views: a sync that redraws the view while
// the file dialog is open would otherwise lose the chosen file.
function pickFiles(accept, multiple, onFiles) {
  const input = document.createElement('input');
  Object.assign(input, { type: 'file', accept, multiple, hidden: true });
  input.addEventListener('change', () => {
    if (input.files?.length) onFiles([...input.files]);
    input.remove();
  });
  input.addEventListener('cancel', () => input.remove());
  document.body.append(input);
  input.click();
}

app.addEventListener('submit', (e) => {
  e.preventDefault();
  if (e.target.id === 'search-form') {
    const shared = S.extractShared({ text: ui.query });
    if (shared && !/\s/.test(ui.query.trim())) addLink(shared);
    else document.getElementById('q')?.blur();
  } else if (e.target.id === 'sync-form') {
    connectSync(
      document.getElementById('sync-repo').value,
      document.getElementById('sync-person').value,
      document.getElementById('sync-token').value,
    );
  }
});

// A link pasted into the search field is added at once when nothing else
// was typed there.
app.addEventListener('paste', (e) => {
  if (e.target.id !== 'q' || e.target.value.trim()) return;
  const text = e.clipboardData?.getData('text') ?? '';
  const shared = S.extractShared({ text });
  if (!shared || text.trim().split(/\s+/).length > 12) return;
  e.preventDefault();
  addLink(shared);
});

sheet.addEventListener('submit', (e) => {
  e.preventDefault();
  saveSheet();
  closeSheet();
});

// Escape or a tap outside the sheet: save and close.
sheet.addEventListener('cancel', (e) => {
  e.preventDefault();
  saveSheet();
  closeSheet();
});
sheet.addEventListener('click', (e) => {
  if (e.target === sheet) {
    saveSheet();
    closeSheet();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    swRegistration?.update().catch(() => {});
    if (syncConfig) syncNow();
  } else if (sync.timer) {
    // Push pending changes before the app goes to the background.
    syncNow();
  }
});

window.addEventListener('online', () => syncNow());

// Another tab of the app changed the data.
window.addEventListener('storage', (e) => {
  if (e.key !== S.STORAGE_KEY) return;
  doc = S.loadDoc(storage);
  render();
});

// ---------- start ----------

let swRegistration = null;

try {
  history.replaceState({ screen: 'list', depth: 0 }, '');
} catch {
  // See pushNav.
}
render();
takeSharedLink();
takeSharedFile();
loadPendingFiles().then(() => {
  render();
  if (syncConfig) syncNow();
});

if ('serviceWorker' in navigator && window.isSecureContext) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // A new version took over: reload into it, unless the user is editing
    // or reading.
    if (!hadController || reloading || ui.editId || ui.view === 'reader') return;
    reloading = true;
    window.location.reload();
  });
  navigator.serviceWorker
    .register('sw.js')
    .then((reg) => {
      swRegistration = reg;
    })
    .catch(() => {});
}
