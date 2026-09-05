import { describe, expect, it } from 'vitest';

import { renderMarkdown } from '@/chat/markdown';

/**
 * The renderer's job is two things: produce the markup an assistant's answer
 * needs, and make it impossible for anything the model wrote to become markup
 * of its own. The escaping cases below are the second job, and they are the
 * reason this output can be handed to `v-html` at all.
 */
describe('structure', () => {
  it('renders headings, emphasis and links', () => {
    const html = renderMarkdown('## Savdo\n\n**12 ta** sotildi, [batafsil](https://example.com)');

    expect(html).toContain('<h2>Savdo</h2>');
    expect(html).toContain('<strong>12 ta</strong>');
    expect(html).toContain('<a href="https://example.com"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('renders bulleted and numbered lists', () => {
    expect(renderMarkdown('- cola\n- suv')).toBe('<ul><li>cola</li><li>suv</li></ul>');
    expect(renderMarkdown('1. cola\n2. suv')).toBe('<ol><li>cola</li><li>suv</li></ol>');
  });

  it('renders a table with a header row', () => {
    const html = renderMarkdown('| Mahsulot | Soni |\n| --- | --- |\n| Cola | 9 |');

    expect(html).toContain('<th scope="col">Mahsulot</th>');
    expect(html).toContain('<td>Cola</td>');
  });

  it('renders a fenced code block and keeps its language', () => {
    const html = renderMarkdown('```js\nconst a = 1;\n```');

    expect(html).toContain('<pre data-language="js">');
    expect(html).toContain('const a = 1;');
  });

  it('closes a code block the model forgot to close', () => {
    const html = renderMarkdown('```\nhalf written');

    expect(html).toContain('<pre');
    expect(html).toContain('half written');
  });

  it('keeps the line breaks inside a paragraph', () => {
    expect(renderMarkdown('Birinchi qator\nIkkinchi qator')).toBe(
      '<p>Birinchi qator<br />Ikkinchi qator</p>',
    );
  });
});

describe('escaping', () => {
  it('cannot be made to emit a script tag', () => {
    const html = renderMarkdown('<script>alert(1)</script>');

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('cannot be made to emit an element through a table cell', () => {
    const html = renderMarkdown('| a |\n| --- |\n| <img src=x onerror="alert(1)"> |');

    // The handler survives as *text*, which is inert: what matters is that no
    // `<img` element was ever produced for it to hang off.
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  });

  it('leaves a javascript: link as plain text', () => {
    const html = renderMarkdown('[tap](javascript:alert(1))');

    expect(html).not.toContain('<a ');
    expect(html).toContain('[tap]');
  });

  it('does not treat emphasis markers inside code as emphasis', () => {
    expect(renderMarkdown('`a *b* c`')).toBe('<p><code>a *b* c</code></p>');
  });
});
