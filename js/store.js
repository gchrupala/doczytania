// Data model: saved links, their tags and state, search and merging of
// copies from several devices. Pure logic without the DOM; the time is
// passed in as an argument.
//
// The whole state is one document, the same one that is synced:
//   { doczytania: 1, items: [Item], tombstones: { id: deletedAt } }
// Item:
//   id, url, title (typed or shared, may be ''), note, tags [string],
//   kind ('' = guessed from the address), status ('unread' | 'read'),
//   addedAt, updatedAt, readAt (ms or null),
//   meta (optional, filled in by the GitHub Action in the data repository):
//     { fetchedAt, title, description, site, author, date, lang, words,
//       excerpt, kind, error }

export const DOC_VERSION = 1;
export const STORAGE_KEY = 'doczytania:v1';

export const KINDS = ['article', 'blog', 'paper', 'pdf', 'video', 'podcast', 'thread', 'book'];
export const STATUSES = ['unread', 'read'];

const MAX_TAGS = 20;
const MAX_TEXT = 2000;

export const emptyDoc = () => ({ doczytania: DOC_VERSION, items: [], tombstones: {} });

// ---------- addresses ----------

// Query parameters that only track where a click came from.
const TRACKING = /^(utm_\w+|fbclid|gclid|dclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|igshid|igsh|si|ref_src|ref_url|_hsenc|_hsmi|mkt_tok|oly_\w+|vero_\w+|spm|share_id|smid|cmpid|ito|sh|s)$/i;
// "si", "s" and "sh" are tracking only on these hosts; elsewhere they may matter.
const SHORT_TRACKING_HOSTS = /(^|\.)(youtube\.com|youtu\.be|twitter\.com|x\.com|open\.spotify\.com|instagram\.com|threads\.net)$/i;

// A web address with tracking parameters and text fragments removed, or
// null when the input is not an http(s) address.
export function cleanUrl(input) {
  let u;
  try {
    u = new URL(String(input ?? '').trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (!u.hostname.includes('.') && u.hostname !== 'localhost') return null;
  const shortOk = SHORT_TRACKING_HOSTS.test(u.hostname);
  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING.test(key) && (key.length > 2 || shortOk)) u.searchParams.delete(key);
  }
  if (u.hash.startsWith('#:~:')) u.hash = '';
  let s = u.toString();
  if (!u.search && s.endsWith('?')) s = s.slice(0, -1);
  return s;
}

// The key under which two addresses count as the same link: no scheme, no
// "www.", no fragment, no trailing slash, sorted parameters.
export function urlKey(input) {
  const clean = cleanUrl(input);
  if (!clean) return null;
  const u = new URL(clean);
  u.searchParams.sort();
  const host = u.hostname.toLowerCase().replace(/^(www|m|mobile)\./, '');
  const path = u.pathname.replace(/\/+$/, '');
  const search = u.searchParams.toString();
  return `${host}${u.port ? `:${u.port}` : ''}${path}${search ? `?${search}` : ''}`;
}

export function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

const URL_IN_TEXT = /https?:\/\/[^\s<>"'«»“”]+/i;

// What another app shared (Web Share Target: title, text, url) -> { url,
// title } or null when there is no address. Android apps often put the
// address in the text, sometimes after the title.
export function extractShared({ url, title, text } = {}) {
  const fromUrl = cleanUrl(url);
  const found = String(text ?? '').match(URL_IN_TEXT);
  const fromText = found ? cleanUrl(found[0].replace(/[.,;:!?)\]]+$/, '')) : null;
  const link = fromUrl || fromText;
  if (!link) return null;
  let rest = String(text ?? '');
  if (found) rest = rest.replace(found[0], '');
  rest = rest.replace(/\s+/g, ' ').trim().replace(/[\s:–—-]+$/, '');
  const name = String(title ?? '').trim() || rest;
  return { url: link, title: name === link ? '' : name.slice(0, 300) };
}

// ---------- kinds ----------

const KIND_RULES = [
  ['video', /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|ted\.com|dailymotion\.com|twitch\.tv)$/],
  ['podcast', /(^|\.)(podcasts\.apple\.com|overcast\.fm|pocketcasts\.com|podbean\.com|anchor\.fm|castbox\.fm)$/],
  ['thread', /(^|\.)(twitter\.com|x\.com|bsky\.app|threads\.net|mastodon\.social|reddit\.com|news\.ycombinator\.com|linkedin\.com|facebook\.com)$/],
  ['paper', /(^|\.)(arxiv\.org|aclanthology\.org|openreview\.net|doi\.org|semanticscholar\.org|biorxiv\.org|medrxiv\.org|psyarxiv\.com|ssrn\.com|nature\.com|science\.org|sciencedirect\.com|springer\.com|link\.springer\.com|wiley\.com|jstor\.org|pnas\.org|plos\.org|frontiersin\.org|mdpi\.com|acm\.org|ieee\.org|ieeexplore\.ieee\.org|pubmed\.ncbi\.nlm\.nih\.gov|ncbi\.nlm\.nih\.gov|researchgate\.net|proceedings\.mlr\.press|papers\.nips\.cc|neurips\.cc|isca-archive\.org|jmlr\.org|direct\.mit\.edu|cambridge\.org|tandfonline\.com|sagepub\.com|elifesciences\.org)$/],
  ['book', /(^|\.)(goodreads\.com|lubimyczytac\.pl|openlibrary\.org|books\.google\.com|gutenberg\.org)$/],
  ['blog', /(^|\.)(substack\.com|medium\.com|wordpress\.com|blogspot\.com|ghost\.io|tumblr\.com|bearblog\.dev|lesswrong\.com|github\.io|hashnode\.dev|dev\.to|beehiiv\.com|buttondown\.email)$/],
];

// The kind of a link guessed from its address and, when there are any,
// from what the Action found on the page.
export function guessKind(url, meta) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return 'article';
  }
  const host = u.hostname.toLowerCase();
  const path = u.pathname.toLowerCase();
  if (spotifyEpisode(host, path)) return 'podcast';
  for (const [kind, re] of KIND_RULES) if (re.test(host)) return kind;
  if (/\.pdf$/.test(path) || meta?.kind === 'pdf') return 'pdf';
  if (meta?.kind && KINDS.includes(meta.kind)) return meta.kind;
  if (/^blog\.|\.blog$/.test(host) || /(^|\/)(blog|blogs|posts?)(\/|$)/.test(path)) return 'blog';
  return 'article';
}

const spotifyEpisode = (host, path) => host === 'open.spotify.com' && /^\/(episode|show)\//.test(path);

export const kindOf = (item) => (KINDS.includes(item.kind) ? item.kind : guessKind(item.url, item.meta));

// ---------- tags ----------

// "Uczenie maszynowe, #NLP  ai" -> ["uczenie maszynowe", "nlp", "ai"] when
// split on commas; a list without commas is split on spaces.
export function parseTags(input) {
  const raw = Array.isArray(input) ? input : String(input ?? '').split(/[,;\n]/);
  const parts = !Array.isArray(input) && !/[,;\n]/.test(String(input ?? '')) ? String(input ?? '').split(/\s+/) : raw;
  const tags = [];
  for (const p of parts) {
    const t = String(p ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().replace(/^#+\s*/, '').toLowerCase().slice(0, 40);
    if (t && !tags.includes(t)) tags.push(t);
  }
  return tags.slice(0, MAX_TAGS);
}

// ---------- titles and descriptions for display ----------

export const titleOf = (item) => item.title || item.meta?.title || prettyUrl(item.url);
export const descriptionOf = (item) => item.meta?.description || '';

export function prettyUrl(url) {
  try {
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname).replace(/\/+$/, '');
    return `${u.hostname.replace(/^www\./, '')}${path}`;
  } catch {
    return String(url);
  }
}

// Minutes of reading at 220 words per minute, or null when not known.
export function readingMinutes(item) {
  const w = item.meta?.words;
  return Number.isFinite(w) && w > 0 ? Math.max(1, Math.round(w / 220)) : null;
}

// ---------- changes ----------

export function newId(now, random = Math.random) {
  return `${now.toString(36)}-${Math.floor(random() * 36 ** 6).toString(36).padStart(6, '0')}`;
}

export const findByUrl = (doc, url) => {
  const key = urlKey(url);
  return key ? doc.items.find((i) => urlKey(i.url) === key) ?? null : null;
};

// Adds a link. When the same link is already saved, it returns that one
// (moved back to unread, with the new title and tags added) instead.
// Returns { item, existed } or null when the address is not valid.
export function addItem(doc, { url, title = '', note = '', tags = [], kind = '' }, now, random) {
  const clean = cleanUrl(url);
  if (!clean) return null;
  const existing = findByUrl(doc, clean);
  if (existing) {
    const patch = { status: 'unread', readAt: null };
    if (title && !existing.title) patch.title = String(title).slice(0, 300);
    const more = parseTags(tags);
    if (more.length) patch.tags = parseTags([...existing.tags, ...more]);
    updateItem(doc, existing.id, patch, now);
    return { item: existing, existed: true };
  }
  const item = {
    id: newId(now, random),
    url: clean,
    title: String(title ?? '').trim().slice(0, 300),
    note: String(note ?? '').slice(0, MAX_TEXT),
    tags: parseTags(tags),
    kind: KINDS.includes(kind) ? kind : '',
    status: 'unread',
    addedAt: now,
    updatedAt: now,
    readAt: null,
  };
  doc.items.push(item);
  return { item, existed: false };
}

// Changes the fields in patch that differ; stamps updatedAt when anything
// changed. Returns the item or null.
export function updateItem(doc, id, patch, now) {
  const item = doc.items.find((i) => i.id === id);
  if (!item) return null;
  const next = { ...item };
  if ('title' in patch) next.title = String(patch.title ?? '').trim().slice(0, 300);
  if ('note' in patch) next.note = String(patch.note ?? '').slice(0, MAX_TEXT);
  if ('tags' in patch) next.tags = parseTags(patch.tags);
  if ('kind' in patch) next.kind = KINDS.includes(patch.kind) ? patch.kind : '';
  if ('url' in patch) next.url = cleanUrl(patch.url) ?? item.url;
  if ('status' in patch && STATUSES.includes(patch.status)) {
    next.status = patch.status;
    next.readAt = patch.status === 'read' ? (item.status === 'read' ? item.readAt : now) : null;
  }
  if (stableJson(next) === stableJson(item)) return item;
  if (next.url !== item.url) delete next.meta; // the Action fetches the new page
  next.updatedAt = Math.max(now, item.updatedAt + 1);
  Object.keys(item).forEach((k) => delete item[k]);
  Object.assign(item, next);
  return item;
}

export const toggleRead = (doc, id, now) => {
  const item = doc.items.find((i) => i.id === id);
  return item ? updateItem(doc, id, { status: item.status === 'read' ? 'unread' : 'read' }, now) : null;
};

// Deletes a link and leaves a tombstone, so other devices delete it too.
export function deleteItem(doc, id, now) {
  const i = doc.items.findIndex((x) => x.id === id);
  if (i < 0) return null;
  const [item] = doc.items.splice(i, 1);
  doc.tombstones[id] = now;
  return item;
}

// Undoes deleteItem (right after it, on the same device).
export function restoreItem(doc, item) {
  delete doc.tombstones[item.id];
  if (!doc.items.some((i) => i.id === item.id)) doc.items.push(item);
}

// Renames a tag on every link, or removes it when the new name is empty.
export function renameTag(doc, from, to, now) {
  const [target] = parseTags([to]);
  let n = 0;
  for (const item of doc.items) {
    if (!item.tags.includes(from)) continue;
    const tags = item.tags.map((t) => (t === from ? target : t)).filter(Boolean);
    updateItem(doc, item.id, { tags }, now);
    n++;
  }
  return n;
}

// ---------- reading and lists ----------

// Tags with the number of links, most used first.
export function tagCounts(items) {
  const counts = new Map();
  for (const i of items) for (const t of i.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pl'));
}

export function kindCounts(items) {
  const counts = new Map();
  for (const i of items) {
    const k = kindOf(i);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return KINDS.filter((k) => counts.has(k)).map((k) => [k, counts.get(k)]);
}

// Lower case without accents, for search: "Łódź" -> "lodz".
export function fold(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'l')
    .toLowerCase();
}

function haystack(item) {
  const m = item.meta ?? {};
  return fold(
    [item.title, item.url, domainOf(item.url), item.note, item.tags.join(' '), m.title, m.description, m.site, m.author, m.excerpt]
      .filter(Boolean)
      .join(' \n '),
  );
}

// The links that match the filters, newest first (read ones by the time
// they were read). query: words that must all occur, in any field; "#tag"
// requires the tag. status: 'unread' | 'read' | 'all'.
export function filterItems(items, { query = '', status = 'all', kind = '', tag = '' } = {}) {
  const words = [];
  const tags = tag ? [tag] : [];
  for (const w of String(query).trim().split(/\s+/).filter(Boolean)) {
    if (w.startsWith('#') && w.length > 1) tags.push(...parseTags([w]));
    else words.push(fold(w));
  }
  const out = items.filter(
    (i) =>
      (status === 'all' || i.status === status) &&
      (!kind || kindOf(i) === kind) &&
      tags.every((t) => i.tags.includes(t)) &&
      (!words.length || ((h) => words.every((w) => h.includes(w)))(haystack(i))),
  );
  const when = (i) => (status === 'read' ? (i.readAt ?? i.addedAt) : i.addedAt);
  return out.sort((a, b) => when(b) - when(a) || (a.id < b.id ? 1 : -1));
}

// ---------- reading, checking and saving the document ----------

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const num = (x) => (Number.isFinite(x) ? x : null);

function parseMeta(m) {
  if (!isObj(m) || !Number.isFinite(m.fetchedAt)) return undefined;
  const out = { fetchedAt: m.fetchedAt };
  for (const k of ['title', 'description', 'site', 'author', 'date', 'lang', 'excerpt', 'kind', 'error', 'finalUrl']) {
    if (typeof m[k] === 'string' && m[k]) out[k] = m[k].slice(0, k === 'excerpt' ? 1500 : 1000);
  }
  if (Number.isFinite(m.words)) out.words = m.words;
  if (Number.isFinite(m.attempts)) out.attempts = m.attempts;
  return out;
}

function parseItem(x) {
  if (!isObj(x) || typeof x.id !== 'string' || !x.id) return null;
  const url = cleanUrl(x.url);
  if (!url) return null;
  const addedAt = num(x.addedAt) ?? num(x.updatedAt) ?? 0;
  const item = {
    id: x.id,
    url,
    title: typeof x.title === 'string' ? x.title.slice(0, 300) : '',
    note: typeof x.note === 'string' ? x.note.slice(0, MAX_TEXT) : '',
    tags: parseTags(Array.isArray(x.tags) ? x.tags : []),
    kind: KINDS.includes(x.kind) ? x.kind : '',
    status: STATUSES.includes(x.status) ? x.status : 'unread',
    addedAt,
    updatedAt: num(x.updatedAt) ?? addedAt,
    readAt: x.status === 'read' ? num(x.readAt) : null,
  };
  const meta = parseMeta(x.meta);
  if (meta) item.meta = meta;
  return item;
}

// A document from JSON (storage, the repository or a backup file), checked
// and completed; null when it is not a Doczytania document.
export function parseDoc(raw) {
  if (!isObj(raw) || !Array.isArray(raw.items)) return null;
  const tombstones = {};
  if (isObj(raw.tombstones)) {
    for (const [id, at] of Object.entries(raw.tombstones)) if (Number.isFinite(at)) tombstones[id] = at;
  }
  const seen = new Set();
  const items = [];
  for (const x of raw.items) {
    const item = parseItem(x);
    if (item && !seen.has(item.id) && !(item.id in tombstones)) {
      seen.add(item.id);
      items.push(item);
    }
  }
  return { doczytania: DOC_VERSION, items, tombstones };
}

export function loadDoc(storage) {
  try {
    const text = storage?.getItem(STORAGE_KEY);
    return (text && parseDoc(JSON.parse(text))) || emptyDoc();
  } catch {
    return emptyDoc();
  }
}

export function saveDoc(storage, doc) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(doc));
    return true;
  } catch {
    return false;
  }
}

// ---------- merging copies from two devices ----------

// The newer of two versions of a link. Fields go by updatedAt; the page
// data (meta) go by fetchedAt, because the Action changes them without
// touching updatedAt.
function mergeItem(a, b) {
  let base;
  if (a.updatedAt !== b.updatedAt) base = a.updatedAt > b.updatedAt ? a : b;
  else base = stableJson({ ...a, meta: undefined }) >= stableJson({ ...b, meta: undefined }) ? a : b;
  const ma = a.meta?.fetchedAt ?? -1;
  const mb = b.meta?.fetchedAt ?? -1;
  let meta = ma >= mb ? a.meta : b.meta;
  // A changed address means the page data of the old one no longer apply.
  if (meta && meta !== base.meta && (ma >= mb ? a : b).url !== base.url) meta = base.meta;
  const out = { ...base, addedAt: Math.min(a.addedAt, b.addedAt) };
  if (meta) out.meta = meta;
  else delete out.meta;
  return out;
}

// Two links with the same address saved on different devices become one:
// the id of the earlier one, the newer fields, the tags of both. The other
// id gets a tombstone, so both devices arrive at the same result.
function dedupe(items, tombstones) {
  const byKey = new Map();
  for (const item of [...items].sort((a, b) => a.addedAt - b.addedAt || (a.id < b.id ? -1 : 1))) {
    const key = urlKey(item.url) ?? item.id;
    const first = byKey.get(key);
    if (!first) {
      byKey.set(key, item);
      continue;
    }
    const newer = item.updatedAt > first.updatedAt ? item : first;
    const merged = {
      ...newer,
      id: first.id,
      addedAt: first.addedAt,
      tags: parseTags([...first.tags, ...item.tags]),
      note: [first.note, item.note].filter(Boolean).filter((n, i, all) => all.indexOf(n) === i).join('\n\n').slice(0, MAX_TEXT),
      updatedAt: Math.max(first.updatedAt, item.updatedAt),
    };
    const meta = (first.meta?.fetchedAt ?? -1) >= (item.meta?.fetchedAt ?? -1) ? first.meta : item.meta;
    if (meta) merged.meta = meta;
    else delete merged.meta;
    byKey.set(key, merged);
    tombstones[item.id] = Math.max(tombstones[item.id] ?? 0, item.updatedAt);
  }
  return [...byKey.values()];
}

// Merges the local document with the one from the repository (or null).
// The result does not depend on which side is which.
export function mergeDocs(local, remote) {
  const a = parseDoc(local) ?? emptyDoc();
  const b = remote ? (parseDoc(remote) ?? emptyDoc()) : emptyDoc();
  const tombstones = { ...a.tombstones };
  for (const [id, at] of Object.entries(b.tombstones)) tombstones[id] = Math.max(tombstones[id] ?? 0, at);
  const byId = new Map();
  for (const item of [...a.items, ...b.items]) {
    if (item.id in tombstones) continue;
    const other = byId.get(item.id);
    byId.set(item.id, other ? mergeItem(other, item) : item);
  }
  const items = dedupe([...byId.values()], tombstones).sort((x, y) => x.addedAt - y.addedAt || (x.id < y.id ? -1 : 1));
  return { doczytania: DOC_VERSION, items, tombstones };
}

// JSON with sorted keys, to compare documents.
export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .filter((k) => value[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

// Links still waiting for page data from the Action.
export const waitingForMeta = (doc) => doc.items.some((i) => !i.meta);
