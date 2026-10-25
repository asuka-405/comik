/**
 * Minimal Markdown for release notes: headings, bullet lists, paragraphs, and inline
 * bold, code and links. Parsed into data so the page renders it as React elements,
 * never as HTML strings, which keeps untrusted release text from injecting markup.
 */
export type Inline =
  | { type: "text"; text: string }
  | { type: "bold"; text: string }
  | { type: "code"; text: string }
  | { type: "link"; text: string; href: string };

export type Block =
  | { type: "heading"; level: 2 | 3 | 4; inline: Inline[] }
  | { type: "list"; items: Inline[][] }
  | { type: "paragraph"; inline: Inline[] }
  /** A fenced block. `meta` is whatever follows the language on the opening line, such as "template". */
  | { type: "code"; lang: string; meta: string; text: string }
  /** Only produced when `parseMarkdown` is called with `{ tables: true }`, so renderers that never ask for it can ignore it. */
  | { type: "table"; head: Inline[][]; rows: Inline[][][] };

const INLINE = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) out.push({ type: "text", text: text.slice(last, match.index) });
    if (match[1] !== undefined) out.push({ type: "bold", text: match[1] });
    else if (match[2] !== undefined) out.push({ type: "code", text: match[2] });
    else out.push({ type: "link", text: match[3], href: match[4] });
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out;
}

const cells = (line: string) => line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
const isDivider = (line: string) => /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/.test(line);

export function parseMarkdown(source: string, options: { tables?: boolean } = {}): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: Inline[][] | null = null;
  let table: { head: Inline[][]; rows: Inline[][][] } | null = null;
  const flush = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", inline: parseInline(paragraph.join(" ")) });
    if (list) blocks.push({ type: "list", items: list });
    if (table) blocks.push({ type: "table", ...table });
    paragraph = [];
    list = null;
    table = null;
  };
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let fence: { lang: string; meta: string; lines: string[] } | null = null;
  for (let n = 0; n < lines.length; n++) {
    const raw = lines[n]!;
    if (fence) {
      if (raw.trim() === "```") { blocks.push({ type: "code", lang: fence.lang, meta: fence.meta, text: fence.lines.join("\n") }); fence = null; }
      else fence.lines.push(raw);
      continue;
    }
    const opening = /^```\s*([A-Za-z0-9+-]*)\s*(.*)$/.exec(raw.trim());
    if (opening) { flush(); fence = { lang: opening[1] ?? "", meta: opening[2] ?? "", lines: [] }; continue; }
    const line = raw.trim();
    if (options.tables && line.startsWith("|")) {
      if (!table) {
        // A table starts at a header row followed by a divider row; anything else stays a paragraph.
        if (isDivider((lines[n + 1] ?? "").trim())) { flush(); table = { head: cells(line).map(parseInline), rows: [] }; n++; continue; }
      } else {
        table.rows.push(cells(line).map(parseInline));
        continue;
      }
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (!line) flush();
    else if (heading) {
      flush();
      // Release titles already show the version, so `#` is treated as `##`.
      blocks.push({ type: "heading", level: Math.max(2, heading[1].length) as 2 | 3 | 4, inline: parseInline(heading[2]) });
    } else if (bullet) {
      if (paragraph.length) flush();
      (list ??= []).push(parseInline(bullet[1]));
    } else {
      if (list) flush();
      paragraph.push(line);
    }
  }
  if (fence) blocks.push({ type: "code", lang: fence.lang, meta: fence.meta, text: fence.lines.join("\n") });
  flush();
  return blocks;
}
