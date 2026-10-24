import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { BookOpenText, DownloadSimple, Plus } from "@phosphor-icons/react";
import { db } from "@/core/db";
import { importNovel } from "@/core/novels";
import { resumeTarget } from "@/core/progress";
import { formatChapterNumber } from "@/core/chapterRecognition";
import { Empty, toast } from "../common";

export function Novels() {
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const novels = useLiveQuery(async () => {
    const books = await db.manga.filter((manga) => manga.inLibrary && manga.kind === "novel").toArray();
    return Promise.all(books.map(async (book) => {
      const chapters = await db.chapters.where("mangaId").equals(book.id).toArray();
      return { book, chapters, resume: resumeTarget(chapters) };
    }));
  }, [], []);

  const importFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError("");
    try {
      for (const file of Array.from(files)) await importNovel(file);
      toast(`Imported ${files.length} light novel${files.length === 1 ? "" : "s"}`);
    } catch (cause) {
      setError((cause as Error).message || "Could not import that novel.");
    } finally {
      setBusy(false);
      if (picker.current) picker.current.value = "";
    }
  };

  return (
    <div className="page novel-page">
      <section className="hero3d">
        <div className="copy"><div className="kicker">Library · Light novels</div><h2>Stories, one chapter at a time.</h2></div>
      </section>
      <div className="novel-toolbar">
        <span className="muted">{novels?.length ?? 0} novels</span>
        <input ref={picker} type="file" accept=".epub,.txt,application/epub+zip,text/plain" multiple hidden onChange={(event) => void importFiles(event.target.files)} />
        <button className="btn primary" disabled={busy} onClick={() => picker.current?.click()}><Plus size={16} />{busy ? "Importing…" : "Import EPUB or TXT"}</button>
      </div>
      {error && <div className="err" role="alert">{error}</div>}
      {!novels?.length ? <Empty title="No light novels yet" body="Import an EPUB or plain-text novel to start reading." action={<button className="btn primary" disabled={busy} onClick={() => picker.current?.click()}><Plus size={16} /> Import a novel</button>} /> : (
        <div className="novel-list">
          {novels.map(({ book, chapters, resume }) => <article key={book.id} className="novel-row">
            <div className="novel-row-mark"><BookOpenText size={21} /></div>
            <div className="novel-row-copy"><h3>{book.title}</h3><p>{chapters.length} chapters · {chapters.filter((chapter) => chapter.read).length} read</p></div>
            {resume ? <Link className="btn sm primary" to={`/read/${encodeURIComponent(resume.chapter.id)}`}>{resume.started ? "Continue" : "Start"} · Ch. {formatChapterNumber(resume.chapter.number)}</Link> : chapters[0] && <Link className="btn sm" to={`/read/${encodeURIComponent(chapters[0].id)}`}>Open</Link>}
            <Link className="icon-btn" to={`/series/${encodeURIComponent(book.id)}`} aria-label={`Open ${book.title} chapters`} title="Chapters"><DownloadSimple size={17} /></Link>
          </article>)}
        </div>
      )}
    </div>
  );
}