import { colors } from '../colors.js';

/**
 * Shared formatter for `moxxy <command> --help` output. Produces the
 * same look-and-feel as `moxxy channels` and the top-level `moxxy
 * --help`: a one-line bold title, an optional dim subtitle, then
 * section blocks with bold padded labels + dim descriptions.
 *
 * Sections may also include "notes": free-form dim paragraphs printed
 * under the rows.
 */
export interface HelpSection {
  readonly title: string;
  readonly rows?: ReadonlyArray<readonly [string, string]>;
  readonly notes?: ReadonlyArray<string>;
}

export interface HelpDoc {
  /** The command name as the user types it, e.g. "moxxy plugins". */
  readonly title: string;
  /** One-line subtitle right under the title (rendered dim). */
  readonly tagline?: string;
  readonly sections: ReadonlyArray<HelpSection>;
  /** Optional trailing prose paragraphs (each rendered dim). */
  readonly footer?: ReadonlyArray<string>;
}

export function formatHelp(doc: HelpDoc): string {
  const allLabels = doc.sections.flatMap((s) => (s.rows ?? []).map(([k]) => k.length));
  const colWidth = allLabels.length > 0 ? Math.max(...allLabels) : 0;

  const out: string[] = [];
  out.push(colors.bold(doc.title));
  if (doc.tagline) out.push(colors.dim('  ' + doc.tagline));
  out.push('');

  doc.sections.forEach((section, idx) => {
    out.push(colors.bold(section.title));
    for (const [label, desc] of section.rows ?? []) {
      const padded = label.padEnd(colWidth, ' ');
      out.push(`  ${colors.bold(padded)}  ${colors.dim(desc)}`);
    }
    for (const note of section.notes ?? []) {
      out.push(`  ${colors.dim(note)}`);
    }
    if (idx < doc.sections.length - 1) out.push('');
  });

  if (doc.footer && doc.footer.length > 0) {
    out.push('');
    for (const para of doc.footer) out.push(colors.dim(para));
  }

  return out.join('\n') + '\n';
}
