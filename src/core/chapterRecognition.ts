/**
 * Work out a chapter's number from its title. Sources give wildly different
 * names ("Vol.2 Ch.15.5 - Title", "Chapter 12a", "Ep. 105 (END)"), and the
 * reader needs a reliable number to sort, dedupe, detect gaps and mark
 * "read up to here".
 *
 * Rules, in order:
 *  1. Strip the series title from the chapter name so digits in the title
 *     ("Re:Zero", "2.5 Dimensional Seduction") are not mistaken for the number.
 *  2. Prefer an explicit marker: ch / chapter / ep / episode / #, then bare numbers.
 *  3. Ignore volume / season / part numbers.
 *  4. A trailing letter ("12a") or "extra / omake / special" becomes a decimal
 *     (.1, .2 ...) so side chapters sort right after their parent.
 */

const UNWANTED = /\b(?:v(?:ol(?:ume)?)?|s(?:eason)?|part|pt|arc|book|bk|tome)\.?\s*\d+(?:\.\d+)?\b/gi;
const NUM = String.raw`(\d+)(?:[.,](\d+))?(?:\s?([a-z])\b)?`;
const MARKED = new RegExp(String.raw`(?:chapters?|chap|ch|episodes?|ep|capitulo|cap|#)\.?\s*${NUM}`, "i");
const SPECIAL = /\b(extra|omake|special|bonus|side\s?story|gaiden|oneshot|one-shot)\b/i;

function alphaFraction(letter: string): number {
  const idx = letter.toLowerCase().charCodeAt(0) - 96; // a=1
  return idx >= 1 && idx <= 26 ? idx / 10 : 0;
}

function build(whole: string, frac?: string, letter?: string): number {
  let n = Number(whole);
  if (frac) n = Number(`${whole}.${frac}`);
  else if (letter) n += alphaFraction(letter);
  return n;
}

export function recognizeChapterNumber(chapterName: string, mangaTitle = "", sourceHint?: number): number {
  if (sourceHint !== undefined && sourceHint >= 0 && Number.isFinite(sourceHint)) return sourceHint;

  let name = chapterName.toLowerCase().replace(/&nbsp;| /g, " ").trim();
  const title = mangaTitle.toLowerCase().trim();
  if (title) name = name.replace(title, " ");
  name = name.replace(UNWANTED, " ").replace(/\s+/g, " ").trim();

  const marked = name.match(MARKED);
  if (marked) return build(marked[1]!, marked[2], marked[3]);

  // "12 - Title", "12.5: Title", leading number only
  const lead = name.match(new RegExp(String.raw`^${NUM}(?=\s|$|[-:–—])`, "i"));
  if (lead) return build(lead[1]!, lead[2], lead[3]);

  // last standalone number that is not a year-like token
  const all = [...name.matchAll(/(?<![\w.])(\d+)(?:[.,](\d+))?(?![\w])/g)].filter((m) => !(m[1]!.length === 4 && !m[2] && Number(m[1]) > 1900));
  if (all.length) {
    const m = all[all.length - 1]!;
    return build(m[1]!, m[2]);
  }

  if (SPECIAL.test(name)) return 0.5;
  return -1;
}

/**
 * Fill in missing numbers (-1) for a source-ordered, newest-first list: infer from neighbours so
 * unnamed chapters still sort in place.
 */
export function backfillNumbers(numbers: number[]): number[] {
  const out = [...numbers];
  for (let i = 0; i < out.length; i++) {
    if (out[i]! >= 0) continue;
    // list is newest first, so the next index is the older chapter
    const older = out.slice(i + 1).find((n) => n >= 0);
    const newer = [...out.slice(0, i)].reverse().find((n) => n >= 0);
    if (older !== undefined) out[i] = Math.floor(older) + 1 > (newer ?? Infinity) ? older + 0.1 : Math.floor(older) + 1;
    else if (newer !== undefined) out[i] = Math.max(0, newer - 1);
    else out[i] = out.length - i;
  }
  return out;
}

/** Is there a gap between two chapter numbers worth warning about? Ignores decimals/extras. */
export function missingBetween(prev: number, next: number): number {
  if (prev < 0 || next < 0) return 0;
  const gap = Math.floor(next) - Math.floor(prev) - 1;
  return gap > 0 && gap < 500 ? gap : 0;
}

export function formatChapterNumber(n: number): string {
  if (n < 0) return "-";
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}
