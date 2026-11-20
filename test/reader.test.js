import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dropTitle, inline, renderMarkdown } from '../js/reader.js';

test('blocks: headings from h2, paragraphs, lists, tables, code, rules', () => {
  const md = [
    '# **Tytuł**',
    '',
    'Pierwszy wiersz',
    'drugi wiersz.',
    '',
    '- [1] Pierwsza pozycja',
    '',
    '- [2] Druga',
    'ciąg dalszy',
    '',
    '3. trzy',
    '4. cztery',
    '',
    '||A|B|',
    '|---|---|---|',
    '|x|1|2|',
    '',
    '```',
    'a < b',
    '',
    'c',
    '```',
    '',
    '-----',
    '#### Głęboko',
  ].join('\n');
  assert.equal(
    renderMarkdown(md),
    [
      '<h2>Tytuł</h2>',
      '<p>Pierwszy wiersz drugi wiersz.</p>',
      '<ul><li>[1] Pierwsza pozycja</li><li>[2] Druga ciąg dalszy</li></ul>',
      '<ol start="3"><li>trzy</li><li>cztery</li></ol>',
      '<div class="table-wrap"><table><thead><tr><th></th><th>A</th><th>B</th></tr></thead><tbody><tr><td>x</td><td>1</td><td>2</td></tr></tbody></table></div>',
      '<pre><code>a &lt; b\n\nc</code></pre>',
      '<hr>',
      '<h4>Głęboko</h4>',
    ].join('\n'),
  );
});

test('inline: emphasis as pymupdf4llm writes it, snake_case untouched', () => {
  assert.equal(inline('**Abstract.** Young _ad hoc_ text'), '<strong>Abstract.</strong> Young <em>ad hoc</em> text');
  assert.equal(inline('8_×_8 and some_snake_case'), '8<em>×</em>8 and some_snake_case');
  assert.equal(inline('Aw<sup>_∗_</sup> and H<sub>2</sub>O<br>next'), 'Aw<sup><em>∗</em></sup> and H<sub>2</sub>O<br>next');
  assert.equal(inline('a * b * c and *x*'), 'a * b * c and <em>x</em>');
  assert.equal(inline('`a**b**`'), '<code>a**b**</code>');
});

test('a PDF cannot inject markup or scripts', () => {
  assert.equal(inline('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(inline('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(inline('[klik](javascript:alert(1))'), '[klik](javascript:alert(1))');
  assert.equal(
    inline('[strona](https://example.com/a?b=1&c="x")'),
    '<a href="https://example.com/a?b=1&amp;c=&quot;x&quot;" target="_blank" rel="noopener noreferrer">strona</a>',
  );
  assert.equal(inline('<sup onclick="x">1</sup>'), '&lt;sup onclick=&quot;x&quot;&gt;1&lt;/sup&gt;');
  assert.equal(renderMarkdown('<!-- komentarz -->\n> cytat <b>'), '<blockquote><p>cytat &lt;b&gt;</p></blockquote>');
});

test('the real output of the Action renders', async () => {
  const md = '# **Zero-shot World Models**\n\n**Khai Loong Aw**, **Klemen Kotar** Stanford\n\n## **Results**\n\n### **ZWM performs**\n\nText [1, 2].\n';
  const html = renderMarkdown(md);
  assert.match(html, /^<h2>Zero-shot World Models<\/h2>\n<p><strong>Khai Loong Aw<\/strong>, <strong>Klemen Kotar<\/strong> Stanford<\/p>\n<h3>Results<\/h3>\n<h4>ZWM performs<\/h4>/);
});

test('the first heading goes when it repeats the title', () => {
  const md = '# **Zero-shot World Models**\n\nText.\n';
  assert.equal(dropTitle(md, '[2604.10333] Zero-shot World Models'), '\nText.\n');
  assert.equal(dropTitle(md, 'Inny tytuł'), md);
  assert.equal(dropTitle('Text.\n# Later', 'Later'), 'Text.\n# Later');
});
