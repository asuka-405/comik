import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { ArrowRight, Copy } from "@phosphor-icons/react";
import "./styles.css";
import "./landing.css";
import "./docs.css";
import { parseMarkdown, type Block, type Inline } from "./core/markdown";
import { SCHEMAS } from "./core/dataSchemas";
import customization from "../docs/CUSTOMIZATION.md?raw";
import connectors from "../docs/CONNECTORS.md?raw";

const REPO = "https://github.com/asuka-405/comik";

function inline(parts: Inline[]) {
  return parts.map((part, i) => {
    if (part.type === "bold") return <strong key={i}>{part.text}</strong>;
    if (part.type === "code") return <code key={i}>{part.text}</code>;
    if (part.type === "link") return <a key={i} href={part.href} target="_blank" rel="noreferrer">{part.text}</a>;
    return part.text;
  });
}

/** The same heading text always gets the same id, so the section links in the sidebar keep working. */
const slug = (parts: Inline[]) => parts.map((p) => p.text).join("").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function Markdown({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((block, i) => {
        if (block.type === "heading") {
          const id = slug(block.inline);
          return block.level === 2 ? <h2 key={i} id={id}>{inline(block.inline)}</h2> : <h3 key={i} id={id}>{inline(block.inline)}</h3>;
        }
        if (block.type === "list") return <ul key={i}>{block.items.map((item, j) => <li key={j}>{inline(item)}</li>)}</ul>;
        if (block.type === "table") {
          return (
            <div className="docs-table" key={i}>
              <table>
                <thead><tr>{block.head.map((cell, j) => <th key={j}>{inline(cell)}</th>)}</tr></thead>
                <tbody>{block.rows.map((row, r) => <tr key={r}>{row.map((cell, j) => <td key={j}>{inline(cell)}</td>)}</tr>)}</tbody>
              </table>
            </div>
          );
        }
        if (block.type === "code") return <CodeBlock key={i} lang={block.lang} text={block.text} />;
        return <p key={i}>{inline(block.inline)}</p>;
      })}
    </>
  );
}

function CodeBlock({ lang, text }: { lang: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => void navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); }).catch(() => undefined);
  return (
    <div className="docs-code">
      <div><span>{lang || "code"}</span><button onClick={copy}><Copy size={13} /> {copied ? "Copied" : "Copy"}</button></div>
      <pre><code>{text}</code></pre>
    </div>
  );
}

function DataPage() {
  const online = SCHEMAS.filter((s) => !s.path.startsWith("IndexedDB"));
  const device = SCHEMAS.filter((s) => s.path.startsWith("IndexedDB"));
  const table = (rows: typeof SCHEMAS) => (
    <div className="docs-table">
      <table>
        <thead><tr><th>Path</th><th>Who can read it</th><th>Fields</th></tr></thead>
        <tbody>{rows.map((s) => (
          <tr key={s.path}>
            <td><code>{s.path}</code></td>
            <td>{s.visibility}</td>
            <td>{s.fields}{s.children ? <><br /><span className="docs-sub">Subcollections: {s.children}</span></> : null}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
  return (
    <>
      <p>Comik keeps your library on your device. If you sign in, a copy syncs through Firebase, and Community posts live in a shared project so everyone can find the same communities. This page lists every place data can live and who can read it. It is generated from the same list the app shows at <a href="/web/data">/web/data</a>, next to the live public records.</p>
      <h2 id="what-is-public">What is public</h2>
      <ul>
        <li><strong>Community content</strong>: posts, comments, votes, likes, ratings, public community names and member counts, and public chat. Anyone can read it, signed in or not.</li>
        <li><strong>Capacity status</strong>: one document, <code>system/capacity</code>, that says whether new writes are open.</li>
      </ul>
      <h2 id="what-is-private">What is private</h2>
      <ul>
        <li>Everything under <code>users/{"{uid}"}</code>: your library, progress, categories, settings, profile and memberships. The security rules let only that signed-in user read or write it. It is never shown in a public view.</li>
        <li>Private communities: their posts, channels and member lists need membership. Invite codes are visible to staff only.</li>
        <li>Everything on your device: titles, chapters, downloads, installed sources and connector code, backups and cached responses. Comik does not upload these on its own.</li>
      </ul>
      <p>With your own Firebase project, your synced library is stored in that project and Comik holds none of it. Communities still live in Comik's project.</p>
      <h2 id="online-schema">Firestore paths</h2>
      <p>A <code>?</code> after a field name means the field is optional. Curly braces are placeholders for an id.</p>
      {table(online)}
      <h2 id="device-schema">On your device</h2>
      <p>These are IndexedDB tables in your browser or app. They are listed so you know what a backup or a cleared site contains.</p>
      {table(device)}
      <h2 id="write-limits">Write limits</h2>
      <p>The rules bound document sizes, allow only the paths above, and give public posts, comments and chat an 8-second per-user cooldown. If <code>system/capacity</code> reports <code>closed</code>, or either usage figure is 95% or higher, new and edited sync and Community records are refused while reading, deleting and exporting keep working. Comik does not measure Google Cloud quota by itself; an operator sets that document by hand.</p>
      <p>The full rules are <a href={`${REPO}/blob/master/firestore.rules`} target="_blank" rel="noreferrer">firestore.rules</a> and the setup guide is <a href={`${REPO}/blob/master/docs/FIREBASE.md`} target="_blank" rel="noreferrer">docs/FIREBASE.md</a>.</p>
    </>
  );
}

interface Page { id: string; title: string; kicker: string; lead: string; render: () => React.ReactNode; outline: Block[] }

const customBlocks = parseMarkdown(customization, { tables: true });
const connectorBlocks = parseMarkdown(connectors, { tables: true });

const PAGES: Page[] = [
  {
    id: "customize", title: "Themes and CSS", kicker: "Make it yours",
    lead: "Pick a built-in theme, build your own from fourteen colors, a radius and a font, share it as a file, or restyle anything with CSS.",
    render: () => <Markdown blocks={customBlocks.slice(1)} />, outline: customBlocks,
  },
  {
    id: "data", title: "Public data and schemas", kicker: "Transparency",
    lead: "What Comik stores, where, and who can read it: every Firestore path and every device table.",
    render: () => <DataPage />, outline: [],
  },
  {
    id: "connectors", title: "Anime connectors", kicker: "Reference",
    lead: "How to write, test and debug a connector: the manifest, the ctx object, what to return and three worked examples.",
    render: () => <Markdown blocks={connectorBlocks.slice(1)} />, outline: connectorBlocks,
  },
];

const pageFromHash = () => {
  const id = location.hash.replace(/^#/, "").split("/")[0];
  return PAGES.find((p) => p.id === id) ?? PAGES[0]!;
};

function Docs() {
  const [page, setPage] = useState(pageFromHash);
  useEffect(() => {
    const on = () => {
      const next = pageFromHash();
      setPage(next);
      const section = location.hash.split("/")[1];
      requestAnimationFrame(() => (section ? document.getElementById(section)?.scrollIntoView() : window.scrollTo(0, 0)));
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  useEffect(() => { document.title = `${page.title} - Comik Docs`; }, [page]);

  const sections = useMemo(() => (page.id === "data"
    ? [["what-is-public", "What is public"], ["what-is-private", "What is private"], ["online-schema", "Firestore paths"], ["device-schema", "On your device"], ["write-limits", "Write limits"]]
    : page.outline.filter((b): b is Extract<Block, { type: "heading" }> => b.type === "heading" && b.level === 2).slice(1).map((b) => [slug(b.inline), b.inline.map((p) => p.text).join("")])), [page]);

  return (
    <div className="landing docs">
      <header className="landing-nav">
        <a className="landing-brand" href="/" aria-label="Comik home"><span className="landing-mark">C</span><span>comik</span></a>
        <nav aria-label="Main navigation">
          <a className="landing-nav-keep" href="/releases/">Releases</a>
          <a className="landing-nav-keep" href={REPO}>GitHub</a>
          <a className="landing-nav-cta" href="/web/">Open reader <ArrowRight size={16} /></a>
        </nav>
      </header>
      <div className="docs-layout">
        <aside className="docs-side" aria-label="Documentation">
          {PAGES.map((p) => (
            <div key={p.id}>
              <a className={p.id === page.id ? "on" : ""} href={`#${p.id}`}>{p.title}</a>
              {p.id === page.id && sections.length > 0 && (
                <ul>{sections.map(([id, label]) => <li key={id}><a href={`#${p.id}/${id}`}>{label}</a></li>)}</ul>
              )}
            </div>
          ))}
          <a className="docs-out" href={`${REPO}/blob/master/docs/FIREBASE.md`}>Firebase setup <ArrowRight size={13} /></a>
        </aside>
        <main className="docs-main">
          <span className="landing-kicker">{page.kicker}</span>
          <h1>{page.title}</h1>
          <p className="docs-lead">{page.lead}</p>
          <article className="docs-body">{page.render()}</article>
        </main>
      </div>
      <footer className="landing-footer">
        <a className="landing-brand" href="/" aria-label="Comik home"><span className="landing-mark">C</span><span>comik</span></a>
        <span>Made for the next chapter.</span>
        <a href={REPO}>GitHub <ArrowRight size={15} /></a>
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Docs /></StrictMode>);
