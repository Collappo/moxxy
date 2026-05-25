import { describe, expect, it } from 'vitest';
import { LOGO_LINES } from '@moxxy/plugin-cli';
import { colorsEnabled } from './colors.js';
import { renderLogo } from './logo.js';

// Strip ANSI so layout assertions don't have to encode color codes.
function strip(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('renderLogo', () => {
  it('default output is left-aligned with no leading pad (init wizard banner relies on this)', () => {
    const out = strip(renderLogo(80));
    const lines = out.split('\n').filter((l) => l.trim());
    // First glyph line begins with the logo art's own 3-space indent — and
    // nothing more. The clack `┌` corner connects under a left-flush banner.
    expect(lines[0]).toBe(LOGO_LINES[0]);
  });

  it('center adds symmetric leading padding sized to the terminal width', () => {
    const width = 80;
    const out = strip(renderLogo(width, { center: true }));
    const first = out.split('\n').filter((l) => l.trim())[0]!;
    const logoWidth = LOGO_LINES[0]!.length; // 24
    const expectedPad = Math.floor((width - logoWidth) / 2);
    expect(first).toBe(' '.repeat(expectedPad) + LOGO_LINES[0]);
  });

  it('two-tone preserves the art and (when color is on) wraps only the `:` fill runs', () => {
    const fillLine = LOGO_LINES.find((l) => l.includes(':'))!;
    const strokeOnly = LOGO_LINES.find((l) => !l.includes(':'))!;
    const raw = renderLogo(80, { twoTone: true });
    // Stripping color must always round-trip back to the exact ASCII art.
    const styled = raw.split('\n').find((l) => l.includes(':'))!;
    expect(strip(styled)).toBe(fillLine);
    if (colorsEnabled) {
      // Fill chars carry dim+gray codes; pure-stroke lines stay bare.
      expect(styled).toContain('\x1b[2m');
      expect(styled).toContain('\x1b[90m');
      expect(raw.split('\n').find((l) => strip(l) === strokeOnly)).toBe(strokeOnly);
    }
  });

  it('falls back to the compact mark on ultra-narrow terminals', () => {
    expect(strip(renderLogo(15))).toContain('|X|  moxxy');
    expect(strip(renderLogo(15, { center: true }))).toContain('  |X|  moxxy');
  });
});
