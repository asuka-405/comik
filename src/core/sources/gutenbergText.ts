import type { NovelPart } from "../novels";

export function splitPublicDomainText(raw: string): NovelPart[] {
  const text = raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  const begin = lines.findIndex((line) => /\*\*\*\s*start of (?:the )?project gutenberg/i.test(line));
  const end = lines.findIndex((line, index) => index > Math.max(begin, -1) && /\*\*\*\s*end of (?:the )?project gutenberg/i.test(line));
  const body = (begin >= 0 ? lines.slice(begin + 1, end >= 0 ? end : undefined) : lines).join("\n").trim();
  const heading = /^\s*((?:CHAPTER|BOOK|PART|VOLUME|LETTER|SECTION)\s+(?:[IVXLCDM]+|\d+)(?:\s*[:.\-].*)?)\s*$/gim;
  const matches = [...body.matchAll(heading)];
  if (matches.length < 2) return [{ title: "Full text", text: body }];
  const parts: NovelPart[] = [];
  for (let index = 0; index < matches.length; index++) {
    const match = matches[index]!;
    const contentStart = match.index! + match[0].length;
    const contentEnd = matches[index + 1]?.index ?? body.length;
    const chapterText = body.slice(contentStart, contentEnd).trim();
    if (chapterText) parts.push({ title: match[1]!.trim(), text: chapterText });
  }
  return parts.length ? parts : [{ title: "Full text", text: body }];
}