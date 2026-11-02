// User interface: renders the views from the document in store.js and
// handles input, links shared from other apps and sync.

import * as S from './store.js';
import { gitHubRemote, parsePerson, parseRepo, syncOnce, syncPath } from './sync.js';

const VERSION = '1';

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
};

const storage = openStorage();
let doc = S.loadDoc(storage);
let saveFailed = !storage;

const PREFS_KEY = 'doczytania:prefs';
const prefs = { status: 'unread', kind: '', tag: '', ...readJson(PREFS_KEY) };

const ui = {
  view: 'list', // 'list' | 'settings'
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
  document.title = ui.view === 'settings' ? 'Ustawienia — Doczytania' : 'Doczytania';
  app.innerHTML = ui.view === 'settings' ? settingsView() : listView();
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
      <div class="bar-actions">${syncButton()}<button class="icon-btn" type="button" data-action="settings" aria-label="Ustawienia" title="Ustawienia">${ICON.gear}</button></div>
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
  const site = item.meta?.site || S.domainOf(item.url);
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
    </div>
    <button type="button" class="icon-btn small edit" data-action="edit" aria-label="Edytuj" title="Edytuj">${ICON.edit}</button>
  </li>`;
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
  const page = meta
    ? meta.error
      ? `<p class="field-note">Nie udało się pobrać opisu strony (${esc(meta.error)}).</p>`
      : `<p class="field-note">Opis strony pobrany ${esc(ago(meta.fetchedAt))}${meta.title && meta.title !== item.title ? `: „${esc(meta.title)}”` : ''}.</p>`
    : syncConfig
      ? '<p class="field-note">Tytuł, opis i czas czytania pojawią się po synchronizacji, gdy GitHub pobierze stronę.</p>'
      : '';
  sheet.innerHTML = `<form method="dialog" id="edit-form" class="edit">
    <div class="sheet-head">
      <h2>${ui.editIntro ? esc(ui.editIntro) : 'Edycja'}</h2>
      <button type="button" class="icon-btn small" data-action="sheet-close" aria-label="Zamknij">${ICON.close}</button>
    </div>
    <a class="sheet-link" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(S.prettyUrl(item.url))}</a>
    ${page}
    <label for="f-title">Tytuł</label>
    <input id="f-title" name="title" type="text" value="${esc(item.title)}" placeholder="${esc(meta?.title || S.prettyUrl(item.url))}">
    <label for="f-tags">Tagi <span class="hint">(oddzielone przecinkami)</span></label>
    <input id="f-tags" name="tags" type="text" value="${esc(item.tags.join(', '))}" autocapitalize="off" spellcheck="false">
    ${suggestions}
    <label for="f-kind">Rodzaj</label>
    <select id="f-kind" name="kind">${kinds}</select>
    <label for="f-note">Notatka</label>
    <textarea id="f-note" name="note" rows="3">${esc(item.note)}</textarea>
    <label for="f-url">Adres</label>
    <input id="f-url" name="url" type="url" value="${esc(item.url)}" autocapitalize="off" spellcheck="false">
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
  S.updateItem(
    doc,
    ui.editId,
    {
      title: f.get('title'),
      tags: f.get('tags'),
      kind: f.get('kind'),
      note: f.get('note'),
      url: f.get('url'),
      status: f.get('read') ? 'read' : 'unread',
    },
    Date.now(),
  );
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
  const total = doc.items.length;
  const base = new URL('./', location.href).href;
  const bookmarklet = `javascript:(()=>{window.open('${base}?url='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title),'doczytania')})()`;
  const tags = S.tagCounts(doc.items);
  return `<header class="bar">
      <button class="icon-btn" type="button" data-action="back" aria-label="Wróć">${ICON.back}</button>
      <h1>Ustawienia</h1>
      <span></span>
    </header>
    ${notices()}
    ${syncSection()}
    <section>
      <h2>Dodawanie linków</h2>
      <h3>Android</h3>
      <p>Zainstaluj aplikację: w Chrome menu ⋮ → „Zainstaluj aplikację” (albo „Dodaj do ekranu głównego”). Potem w dowolnej aplikacji wybierz „Udostępnij” → <strong>Doczytania</strong>.</p>
      <h3>iPhone i iPad</h3>
      <p>Safari nie pozwala aplikacjom z sieci odbierać udostępnień. Można zrobić skrót w aplikacji Skróty:</p>
      <ol>
        <li>Nowy skrót → w ustawieniach skrótu włącz „Pokaż w arkuszu udostępniania”, typ: adresy URL.</li>
        <li>Dodaj czynność „Tekst” z treścią <code>${esc(base)}?url=</code> i zaraz po niej zmienną „Dane wejściowe skrótu”.</li>
        <li>Dodaj czynność „Otwórz adresy URL”.</li>
      </ol>
      <p class="field-note">Skrót otwiera Doczytania w Safari. Dane w Safari i w aplikacji dodanej do ekranu początkowego są na iPhonie osobne; połącz obie z GitHubem, a będą takie same.</p>
      <h3>Komputer</h3>
      <p>Przeciągnij ten przycisk na pasek zakładek: <a class="btn bookmarklet" href="${esc(bookmarklet)}" data-action="bookmarklet">+ Doczytania</a>. Kliknięty na dowolnej stronie zapisuje ją tutaj. Można też wkleić link w pole wyszukiwania.</p>
    </section>
    ${tags.length ? tagsSection(tags) : ''}
    <section>
      <h2>Kopia danych</h2>
      <p>Linków: ${total}. Kopia to plik JSON; wczytanie dołącza jego linki do obecnych.</p>
      <div class="row">
        <button class="btn" type="button" data-action="export">Pobierz kopię</button>
        <label class="btn file-btn">Wczytaj kopię<input type="file" accept="application/json,.json" data-action="import" hidden></label>
      </div>
      ${ui.importMsg ? `<p class="field-note" role="status">${esc(ui.importMsg)}</p>` : ''}
    </section>
    <p class="version">Doczytania · wersja ${VERSION} · <a href="https://github.com/gchrupala/doczytania" target="_blank" rel="noopener">kod</a></p>`;
}

function tagsSection(tags) {
  return `<section>
    <h2>Tagi</h2>
    <ul class="tag-list">${tags
      .map(
        ([t, n]) => `<li><span>#${esc(t)} <span class="count">${n}</span></span>
        <span class="row"><button class="btn small" type="button" data-action="rename-tag" data-value="${esc(t)}">Zmień nazwę</button>
        <button class="btn small" type="button" data-action="remove-tag" data-value="${esc(t)}">Usuń</button></span></li>`,
      )
      .join('')}</ul>
  </section>`;
}

function syncSection() {
  const c = syncConfig;
  const error = c ? c.error : ui.syncError;
  const errorHtml = error ? `<p class="error" role="alert">${esc(SYNC_ERRORS[error] ?? SYNC_ERRORS.bad)}</p>` : '';
  const head = '<h2>Synchronizacja z GitHubem</h2>';
  if (c) {
    const status = sync.busy ? 'Synchronizuję…' : c.lastSyncAt ? `Ostatnio: ${ago(c.lastSyncAt)}.` : 'Jeszcze nie zsynchronizowano.';
    return `<section>${head}
      <p>Połączono z <strong>${esc(c.repo)}</strong>, plik <code>${esc(syncPath(c.person))}</code>.</p>
      <p class="field-note" role="status">${esc(status)}</p>
      ${errorHtml}
      <div class="row">
        <button class="btn" type="button" data-action="sync-now"${sync.busy ? ' disabled' : ''}>Synchronizuj teraz</button>
        <button class="btn${ui.confirmDisconnect ? ' danger' : ''}" type="button" data-action="sync-off">${ui.confirmDisconnect ? 'Na pewno odłączyć?' : 'Odłącz'}</button>
      </div>
      <p class="field-note">Odłączenie usuwa token z tego urządzenia. Linki zostają tu i w repozytorium.</p>
    </section>`;
  }
  const fromMyo = ui.syncToken && !ui.syncError ? '<p class="field-note">Formularz wypełniono danymi połączenia z Myo na tym urządzeniu.</p>' : '';
  return `<section>${head}
    <p class="field-note">Linki trafiają do pliku <code>&lt;imię&gt;/doczytania.json</code> w prywatnym repozytorium, tak jak w Myo. Każde urządzenie połączone z tym samym repozytorium i imieniem ma te same linki.</p>
    <ol>
      <li>Prywatne repozytorium, np. <code>app-data</code>: <a href="https://github.com/new?name=app-data&amp;visibility=private" target="_blank" rel="noopener">github.com/new</a> (albo istniejące).</li>
      <li>Token z uprawnieniem „Contents: Read and write” do tego repozytorium: <a href="https://github.com/settings/personal-access-tokens/new?name=Doczytania&amp;description=Doczytania+sync&amp;expires_in=366&amp;contents=write" target="_blank" rel="noopener">github.com/settings/personal-access-tokens</a>. Może być ten sam co w Myo.</li>
      <li>Wpisz poniżej repozytorium, imię i token.</li>
    </ol>
    ${fromMyo}
    <form id="sync-form" class="edit" novalidate>
      <label for="sync-repo">Repozytorium</label>
      <input id="sync-repo" type="text" placeholder="właściciel/nazwa" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(ui.syncRepo ?? DEFAULT_SYNC_REPO)}">
      <label for="sync-person">Imię</label>
      <input id="sync-person" type="text" placeholder="np. Grzegorz" autocomplete="off" spellcheck="false" value="${esc(ui.syncPerson ?? '')}">
      <label for="sync-token">Token</label>
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

window.addEventListener('popstate', () => {
  const screen = history.state?.screen ?? 'list';
  if (screen !== 'edit' && ui.editId) {
    ui.editId = null;
    ui.editIntro = '';
  }
  if (screen === 'list') ui.view = 'list';
  else if (screen === 'settings') ui.view = 'settings';
  render();
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

app.addEventListener('change', (e) => {
  if (e.target.dataset.action === 'import' && e.target.files?.[0]) importDoc(e.target.files[0]);
});

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
if (syncConfig) syncNow();

if ('serviceWorker' in navigator && window.isSecureContext) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // A new version took over: reload into it, unless the user is editing.
    if (!hadController || reloading || ui.editId) return;
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
