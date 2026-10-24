import { strFromU8, unzipSync } from "fflate";
import { db, chapterId } from "./db";
import { setInLibrary, syncChapters, upsertManga } from "./repo";
import { LOCAL_ID } from "./sources/local";
import type { SChapter } from "./types";

export interface NovelPart {
  title: string;
  text: string;
}

export type NovelDocumentParser = (markup: string, mimeType: "text/html" | "application/xml") => Document;
const browserDocumentParser: NovelDocumentParser = (markup, mimeType) => new DOMParser().parseFromString(markup, mimeType);

function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of decodeURIComponent(path).split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function textFromHtml(markup: string, parseDocument: NovelDocumentParser): string {
  const doc = parseDocument(markup, "text/html");
  doc.querySelectorAll("script,style,nav,header,footer,svg").forEach((node) => node.remove());
  const blocks = [...doc.querySelectorAll("h1,h2,h3,h4,p,blockquote,li")]
    .map((node) => node.textContent?.replace(/\s+/g, " ").trim() ?? "")
    .filter(Boolean);
  const text = (blocks.length ? blocks : [doc.body?.textContent ?? ""]).join("\n\n");
  return text.replace(/[\t\u00a0 ]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

export function parseEpub(bytes: Uint8Array, parseDocument: NovelDocumentParser = browserDocumentParser): NovelPart[] {
  const files = unzipSync(bytes);
  const containerBytes = files["META-INF/container.xml"];
  if (!containerBytes) throw new Error("This EPUB is missing META-INF/container.xml");
  const container = parseDocument(strFromU8(containerBytes), "application/xml");
  const packagePath = container.querySelector("rootfile")?.getAttribute("full-path");
  if (!packagePath) throw new Error("This EPUB does not identify its package document");
  const packageBytes = files[normalizePath(packagePath)];
  if (!packageBytes) throw new Error("This EPUB package document is missing");
  const packageDoc = parseDocument(strFromU8(packageBytes), "application/xml");
  const packageDir = normalizePath(packagePath).split("/").slice(0, -1).join("/");
  const manifest = new Map<string, { href: string; mediaType: string; properties: string }>();
  packageDoc.querySelectorAll("manifest item").forEach((node) => {
    const id = node.getAttribute("id");
    const href = node.getAttribute("href");
    if (id && href) manifest.set(id, { href, mediaType: node.getAttribute("media-type") ?? "", properties: node.getAttribute("properties") ?? "" });
  });
  const parts: NovelPart[] = [];
  packageDoc.querySelectorAll("spine itemref").forEach((reference, index) => {
    if (reference.getAttribute("linear") === "no") return;
    const item = manifest.get(reference.getAttribute("idref") ?? "");
    if (!item || !/xhtml|html/i.test(item.mediaType) || /\bnav\b/i.test(item.properties)) return;
    const path = normalizePath(`${packageDir}/${item.href}`);
    const content = files[path];
    if (!content) return;
    const markup = strFromU8(content);
    const text = textFromHtml(markup, parseDocument);
    if (!text) return;
    const heading = parseDocument(markup, "text/html").querySelector("h1,h2,h3,title")?.textContent?.trim();
    const fallback = item.href.split("/").pop()?.replace(/\.[^.]+$/, "") || `Chapter ${index + 1}`;
    parts.push({ title: heading || fallback, text });
  });
  if (!parts.length) throw new Error("No readable chapters were found in this EPUB");
  return parts;
}

export function parseNovelFile(name: string, bytes: Uint8Array, parseDocument: NovelDocumentParser = browserDocumentParser): NovelPart[] {
  if (/\.epub$/i.test(name)) return parseEpub(bytes, parseDocument);
  if (/\.txt$/i.test(name)) {
    const text = new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
    if (!text) throw new Error("This text file is empty");
    return [{ title: name.replace(/\.txt$/i, ""), text }];
  }
  throw new Error("Choose an EPUB or TXT file");
}

export async function importNovel(file: File): Promise<string> {
  if (file.size > 128 * 1024 * 1024) throw new Error("Novel files must be smaller than 128 MB");
  const parts = parseNovelFile(file.name, new Uint8Array(await file.arrayBuffer()));
  const title = file.name.replace(/\.(epub|txt)$/i, "").trim() || "Untitled novel";
  const url = `/novel/${crypto.randomUUID()}`;
  const manga = await upsertManga(LOCAL_ID, { url, title });
  const timestamp = Date.now();
  const chapters: SChapter[] = parts.map((part, index) => {
    const chapterUrl = `/novel/${index + 1}-${part.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-")}`;
    return { url: chapterUrl, name: part.title, number: index + 1, dateUpload: timestamp };
  });
  await Promise.all(parts.map(async (part, index) => {
    const chapterUrl = chapters[index]!.url;
    await db.localFiles.put({ chapterId: chapterId(manga.id, chapterUrl), blob: new Blob([part.text], { type: "text/plain;charset=utf-8" }), kind: "text" });
  }));
  await syncChapters(manga, chapters);
  await db.manga.update(manga.id, { kind: "novel", modifiedAt: timestamp });
  await setInLibrary(manga.id, true);
  return manga.id;
}