/**
 * A calendar description, as something a person can read.
 *
 * Google Calendar lets whoever writes an entry use rich text, so descriptions
 * arrive as HTML — the school's Maze Day entry is an entire <table> of
 * last-name ranges and times. Two reasons to flatten it at sync time rather
 * than in the app: it happens once instead of on every render, and it means the
 * app never puts markup that came from a feed into the page.
 *
 * Block-level tags become line breaks before anything else is stripped,
 * because in these entries the line breaks carry the meaning. A table of
 * name-ranges collapsed onto one line is unreadable.
 */
export function htmlToText(input) {
  return (
    String(input)
      // Undo the .ics folding first: a literal backslash-n in the raw feed.
      .replace(/\\n/g, '\n')
      .replace(/\\([,;\\])/g, '$1')
      // Structure worth keeping, before the rest of the tags go.
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\/\s*(?:tr|p|div|li|h[1-6]|table)\s*>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      // Tidy the wreckage: spaces within a line, then runs of blank lines.
      .split('\n')
      .map((line) => line.replace(/[ \t]+/g, ' ').trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}
