// Markdown -> HTML for the reading view. The texts come from PDFs, turned
// into Markdown by the GitHub Action (pymupdf4llm), so only what that tool
// writes is understood: headings, paragraphs, lists, tables, code blocks,
// bold, italics, links and the tags <sup>, <sub>, <u>, <b>, <i> and <br>
// without attributes. Everything else is escaped: a PDF is not trusted.
// Pure functions without the DOM.

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const LIST_ITEM = /^(\s*)([-*+]|(\d+)[.)])\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const FENCE = /^\s*```/;
const TABLE_ROW = /^\s*\|/;

const isBlockStart = (line) =>
  HEADING.test(line) || RULE.test(line) || FENCE.test(line) || TABLE_ROW.test(line) || LIST_ITEM.test(line) || /^\s*>/.test(line);

// Bold, italics, links, code and the few HTML tags pymupdf4llm writes.
export function inline(text) {
  const codes = [];
  let s = String(text ?? '')
    .replace(/\0/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images: the Action does not keep them
    .replace(/`([^`]+)`/g, (_, c) => `\0${codes.push(c) - 1}\0`);
  s = esc(s)
    .replace(/&lt;br\s*\/?&gt;/gi, '<br>')
    .replace(/&lt;(sup|sub|u|b|i)&gt;([\s\S]*?)&lt;\/\1&gt;/gi, (_, tag, inner) => `<${tag.toLowerCase()}>${inner}</${tag.toLowerCase()}>`)
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    // _x_ only between non-letters, so snake_case_names stay as they are.
    .replace(/(^|[^\p{L}_])_(?=\S)([^_]*?\S)_(?=$|[^\p{L}_])/gu, '$1<em>$2</em>')
    .replace(/(^|[^\p{L}\p{N}*])\*(?=\S)([^*]*?\S)\*(?![*\p{L}\p{N}])/gu, '$1<em>$2</em>');
  return s.replace(/\0(\d+)\0/g, (_, n) => `<code>${esc(codes[Number(n)])}</code>`);
}

const cells = (row) =>
  row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

function table(rows) {
  const sep = rows.findIndex((r) => /^[\s|:-]+$/.test(r) && r.includes('-'));
  const head = sep === 1 ? cells(rows[0]) : null;
  const body = rows.filter((_, k) => k !== sep && !(head && k === 0)).map(cells);
  const tr = (r, tag) => `<tr>${r.map((c) => `<${tag}>${inline(c)}</${tag}>`).join('')}</tr>`;
  return `<div class="table-wrap"><table>${head ? `<thead>${tr(head, 'th')}</thead>` : ''}<tbody>${body
    .map((r) => tr(r, 'td'))
    .join('')}</tbody></table></div>`;
}

// The whole text. Headings start at <h2>: the title of the link is the <h1>.
export function renderMarkdown(md) {
  const lines = String(md ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n');
  const out = [];
  let i = 0;
  const blank = (k) => k >= lines.length || !lines[k].trim();
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (FENCE.test(line)) {
      const code = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) code.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
      continue;
    }
    const h = line.match(HEADING);
    if (h) {
      const level = Math.min(h[1].length + 1, 4);
      out.push(`<h${level}>${inline(h[2].replace(/\*\*/g, '').trim())}</h${level}>`);
      i++;
      continue;
    }
    if (RULE.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }
    if (TABLE_ROW.test(line)) {
      const rows = [];
      while (i < lines.length && TABLE_ROW.test(lines[i])) rows.push(lines[i++]);
      out.push(table(rows));
      continue;
    }
    const first = line.match(LIST_ITEM);
    if (first) {
      // Items may be separated by empty lines; lines that are not items
      // continue the item above them.
      const ordered = Boolean(first[3]);
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(LIST_ITEM);
        if (m && Boolean(m[3]) === ordered) {
          items.push([m[4].trim()]);
          i++;
        } else if (!blank(i) && !isBlockStart(lines[i]) && items.length) {
          items[items.length - 1].push(lines[i].trim());
          i++;
        } else if (blank(i)) {
          let k = i;
          while (k < lines.length && blank(k)) k++;
          const next = k < lines.length && lines[k].match(LIST_ITEM);
          if (!next || Boolean(next[3]) !== ordered) break;
          i = k;
        } else break;
      }
      const tag = ordered ? 'ol' : 'ul';
      const start = ordered && Number(first[3]) !== 1 ? ` start="${Number(first[3])}"` : '';
      out.push(`<${tag}${start}>${items.map((parts) => `<li>${inline(parts.join(' '))}</li>`).join('')}</${tag}>`);
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${renderMarkdown(quote.join('\n'))}</blockquote>`);
      continue;
    }
    const para = [line.trim()];
    i++;
    while (i < lines.length && !blank(i) && !isBlockStart(lines[i])) para.push(lines[i++].trim());
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return out.join('\n');
}

const plain = (s) =>
  String(s ?? '')
    .replace(/<[^>]+>|[*_`#[\]]/g, '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLowerCase();

// Without the first heading when it only repeats the title shown above it.
export function dropTitle(md, title) {
  const text = String(md ?? '');
  const m = text.match(/^\s*#{1,6}\s+(.+)\n?/);
  if (!m) return text;
  const head = plain(m[1]);
  const t = plain(title);
  return head && t && (t.includes(head) || head.includes(t)) ? text.slice(m[0].length) : text;
}
