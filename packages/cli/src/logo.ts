/**
 * Plain-string moxxy banner for non-Ink contexts (`moxxy --help`, init wizard
 * intro, doctor output). Reuses the shared `LOGO_LINES` from
 * `@moxxy/plugin-cli/logo-data` so the TUI's React `<Logo />` and this
 * helper stay in lock-step. The slogan + version line is rendered by the
 * caller (typically in the clack-style box header right under the banner),
 * not by this function — that keeps the slogan from appearing twice.
 */

import { LOGO_LINES } from '@moxxy/plugin-cli';
import { colors } from './colors.js';

export const MOXXY_LOGO_COMPACT = '|X|';

export interface RenderLogoOptions {
  /** Horizontally center each line to `width` (default: left-aligned). */
  readonly center?: boolean;
  /**
   * Draw the mark two-tone — bright `X` strokes, dim-gray `:` fill — to
   * match the TUI bootscreen's `<LogoLine>`. Default fades the whole glyph
   * uniformly (quiet chrome for the init wizard banner).
   */
  readonly twoTone?: boolean;
}

/**
 * Style one logo row. `twoTone` mirrors `LogoLine.tsx`'s `splitRuns`: `X`
 * strokes keep the terminal default fg, `:` fill renders dim gray, spaces
 * stay bare. Without it the whole line fades uniformly — `gray` (ANSI 90 /
 * bright-black) + `dim` (SGR 2), both relative to the terminal's own
 * palette, so the banner reads as barely-visible chrome in any theme.
 */
function styleLine(line: string, twoTone: boolean): string {
  const fade = (s: string): string => colors.dim(colors.gray(s));
  if (!twoTone) return fade(line);
  // Coalesce consecutive same-class chars so we emit one ANSI run per group.
  let out = '';
  let run = '';
  let runIsFill = false;
  const flush = (): void => {
    if (run === '') return;
    out += runIsFill ? fade(run) : run;
    run = '';
  };
  for (const ch of line) {
    const isFill = ch === ':';
    if (run !== '' && isFill !== runIsFill) flush();
    runIsFill = isFill;
    run += ch;
  }
  flush();
  return out;
}

/** Render the moxxy banner. Falls back to a one-line mark on ultra-narrow terminals. */
export function renderLogo(
  width: number = process.stdout.columns ?? 80,
  opts: RenderLogoOptions = {},
): string {
  const { center = false, twoTone = false } = opts;
  // ANSI codes are zero-width, so center off the raw line length, then style.
  const pad = (raw: string): string =>
    center ? ' '.repeat(Math.max(0, Math.floor((width - raw.length) / 2))) : '';
  if (width < 20) {
    const raw = '|X|  moxxy';
    return '\n' + pad(raw) + styleLine(raw, twoTone) + '\n\n';
  }
  const body = LOGO_LINES.map((line) => pad(line) + styleLine(line, twoTone)).join('\n');
  return '\n' + body + '\n\n';
}
