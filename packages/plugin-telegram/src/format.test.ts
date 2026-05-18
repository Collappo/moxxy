import { describe, expect, it } from 'vitest';
import { markdownToTelegramHtml } from './format.js';

describe('markdownToTelegramHtml', () => {
  it('escapes raw HTML special chars in plain text', () => {
    expect(markdownToTelegramHtml('< & > "')).toBe('&lt; &amp; &gt; "');
  });

  it('renders headings as bold lines', () => {
    expect(markdownToTelegramHtml('# Title\nbody')).toContain('<b>Title</b>');
  });

  it('converts bold and italic correctly', () => {
    const out = markdownToTelegramHtml('Hello **world** and *italic*.');
    expect(out).toContain('<b>world</b>');
    expect(out).toContain('<i>italic</i>');
  });

  it('renders inline code in <code>', () => {
    const out = markdownToTelegramHtml('use `npm install` to set up.');
    expect(out).toContain('<code>npm install</code>');
  });

  it('renders fenced code blocks with language class', () => {
    const out = markdownToTelegramHtml('```ts\nconst x = 1;\n```');
    expect(out).toContain('<pre><code class="language-ts">');
    expect(out).toContain('const x = 1;');
    expect(out).toContain('</code></pre>');
  });

  it('does NOT process markdown inside code blocks', () => {
    const out = markdownToTelegramHtml('```\n**not bold**\n```');
    expect(out).not.toContain('<b>not bold</b>');
    expect(out).toContain('**not bold**');
  });

  it('converts links to <a href="...">', () => {
    const out = markdownToTelegramHtml('See [docs](https://example.com).');
    expect(out).toContain('<a href="https://example.com">docs</a>');
  });

  it('converts bullet markers to • glyph', () => {
    const out = markdownToTelegramHtml('- one\n- two');
    expect(out).toContain('• one');
    expect(out).toContain('• two');
  });

  it("doesn't italicize mid-word underscores", () => {
    const out = markdownToTelegramHtml('var_name_here');
    expect(out).not.toContain('<i>');
    expect(out).toContain('var_name_here');
  });
});
