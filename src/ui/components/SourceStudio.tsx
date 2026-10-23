import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowClockwise, ArrowLeft, ArrowSquareOut, CaretDown, CaretRight, Check, FloppyDisk, MagnifyingGlass } from "@phosphor-icons/react";
import { addCustomSource } from "@/core/sources/registry";
import { fetchDoc, imageUrl, imgSrc } from "@/core/http";
import type { SelectorConfig } from "@/core/sources/selector";
import { toast } from "../common";

type StudioStage = "catalog" | "series" | "reader";
type MappingKey = Exclude<keyof SelectorConfig, "popularUrl" | "latestUrl" | "searchUrl" | "pageStart">;

const fields: Record<StudioStage, { key: MappingKey; label: string; repeated?: boolean; scope?: MappingKey }[]> = {
  catalog: [
    { key: "card", label: "Series card", repeated: true },
    { key: "cardLink", label: "Series link", scope: "card" },
    { key: "cardTitle", label: "Series title", scope: "card" },
    { key: "cardImage", label: "Cover image", scope: "card" },
    { key: "nextPage", label: "Next-page control" },
  ],
  series: [
    { key: "detailTitle", label: "Series title" },
    { key: "detailCover", label: "Cover image" },
    { key: "detailDescription", label: "Description" },
    { key: "detailAuthor", label: "Author" },
    { key: "detailGenres", label: "Genre" },
    { key: "chapterRow", label: "Chapter row", repeated: true },
    { key: "chapterLink", label: "Chapter link", scope: "chapterRow" },
    { key: "chapterDate", label: "Chapter date", scope: "chapterRow" },
  ],
  reader: [{ key: "pageImage", label: "Reader page image" }],
};

const stageLabels: Record<StudioStage, string> = { catalog: "Catalog", series: "Series", reader: "Reader" };

interface HtmlTreeNode {
  selector: string;
  label: string;
  summary: string;
  children: HtmlTreeNode[];
}

function sourceOrigin(raw: string): URL {
  const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error("Enter a valid http or https site address");
  return new URL(url.origin);
}

function simpleSelector(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const classes = [...element.classList].filter(Boolean).slice(0, 2);
  return `${tag}${classes.map((name) => `.${CSS.escape(name)}`).join("")}`;
}

function selectorFor(element: Element, doc: Document, repeated: boolean, scope?: Element | null): string {
  if (scope?.contains(element)) {
    const parts: string[] = [];
    for (let current: Element | null = element; current && current !== scope; current = current.parentElement) {
      let part = simpleSelector(current);
      const parent = current.parentElement;
      if (parent) {
        const siblings = [...parent.children].filter((sibling) => sibling.tagName === current!.tagName);
        if (siblings.filter((sibling) => simpleSelector(sibling) === part).length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      }
      parts.unshift(part);
    }
    return parts.join(" > ");
  }

  if (repeated) {
    let fallback = "";
    let best = "";
    let bestScore = -1;
    for (let current: Element | null = element; current && current !== doc.body; current = current.parentElement) {
      const selector = simpleSelector(current);
      if (doc.querySelectorAll(selector).length < 2) continue;
      fallback ||= selector;
      const label = `${current.id} ${current.className}`.toLowerCase();
      const score = (current.querySelector("a[href]") ? 2 : 0)
        + (current.querySelector("img") ? 2 : 0)
        + (/^(article|li)$/.test(current.tagName.toLowerCase()) ? 1 : 0)
        + (/(card|item|manga|series|chapter|result|entry|row)/.test(label) ? 2 : 0)
        + (current.children.length > 1 ? 1 : 0);
      if (score > bestScore) {
        best = selector;
        bestScore = score;
      }
    }
    return best || fallback;
  }

  const parts: string[] = [];
  for (let current: Element | null = element; current && current !== doc.documentElement; current = current.parentElement) {
    if (current.id) {
      parts.unshift(`#${CSS.escape(current.id)}`);
      break;
    }
    let part = simpleSelector(current);
    const parent = current.parentElement;
    if (parent) {
      const siblings = [...parent.children].filter((sibling) => sibling.tagName === current.tagName);
      if (siblings.filter((sibling) => simpleSelector(sibling) === part).length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
    }
    parts.unshift(part);
    const candidate = parts.join(" > ");
    if (doc.querySelectorAll(candidate).length === 1) return candidate;
  }
  return parts.join(" > ");
}

function safePreview(doc: Document, pageUrl: string): string {
  const root = doc.documentElement.cloneNode(true) as HTMLElement;
  root.querySelectorAll("script,iframe,object,embed,base,form,meta[http-equiv]").forEach((node) => node.remove());
  root.querySelectorAll("link").forEach((link) => {
    if (!link.rel.toLowerCase().split(/\s+/).includes("stylesheet")) {
      link.remove();
      return;
    }
    link.href = new URL(link.getAttribute("href") ?? "", pageUrl).href;
    link.removeAttribute("integrity");
    link.removeAttribute("crossorigin");
  });
  root.querySelectorAll("*").forEach((element) => {
    const imageSource = element.tagName === "IMG" ? imgSrc(element, pageUrl) : "";
    for (const attribute of [...element.attributes]) {
      const isStylesheetLink = element.tagName === "LINK" && attribute.name === "href";
      if (/^on/i.test(attribute.name) || /^(action|formaction|poster|srcset|data-src|data-srcset)$/i.test(attribute.name) || (attribute.name === "href" && !isStylesheetLink) || (attribute.name === "src" && element.tagName !== "IMG")) {
        element.removeAttribute(attribute.name);
      }
    }
    if (element.tagName === "IMG") {
      if (imageSource) element.setAttribute("src", new URL(imageUrl(imageSource, pageUrl), window.location.href).href);
      element.setAttribute("alt", element.getAttribute("alt") || "Image element");
      element.setAttribute("style", `${element.getAttribute("style") ?? ""};max-width:min(100%,760px)!important;max-height:none!important;width:auto!important;height:auto!important;outline:1px dashed #9d6cff`);
    }
  });

  const head = root.querySelector("head") ?? root.insertBefore(doc.createElement("head"), root.firstChild);
  const styles = [...head.querySelectorAll('link[rel~="stylesheet"],style')];
  head.replaceChildren();
  const base = doc.createElement("base");
  base.href = pageUrl;
  const policy = doc.createElement("meta");
  policy.httpEquiv = "Content-Security-Policy";
  policy.content = `default-src 'none'; img-src 'self' https: data: blob:; style-src https: 'unsafe-inline'; font-src https: data:; connect-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri ${new URL(pageUrl).origin}`;
  head.append(policy, base, ...styles);
  const style = doc.createElement("style");
  style.textContent = "html{min-height:100%;overflow:auto!important}body{margin:0!important;min-height:100vh;overflow-wrap:anywhere}*{cursor:crosshair!important}*:hover{outline:2px solid #9d6cff!important;outline-offset:1px}[data-comik-picked]{outline:3px solid #fa625f!important;outline-offset:2px}";
  head.append(style);
  return `<!doctype html>${root.outerHTML}`;
}

function suggestSearchTemplate(doc: Document, pageUrl: string): string | undefined {
  for (const form of [...doc.querySelectorAll("form")]) {
    if ((form.getAttribute("method") ?? "get").toLowerCase() !== "get") continue;
    const inputs = [...form.querySelectorAll<HTMLInputElement>("input[name]")];
    const search = inputs.find((input) => /^(q|s|search|query|keyword|title)$/i.test(input.name) || input.type === "search");
    if (!search) continue;
    try {
      const action = new URL(form.getAttribute("action") || pageUrl, pageUrl);
      if (action.origin !== new URL(pageUrl).origin) continue;
      action.searchParams.set(search.name, "{query}");
      const pageField = inputs.find((input) => /^(page|paged)$/i.test(input.name));
      if (pageField) action.searchParams.set(pageField.name, "{page}");
      return action.pathname + action.search;
    } catch {
      continue;
    }
  }
  return undefined;
}

function buildHtmlTree(element: Element, doc: Document, budget: { remaining: number }, depth = 0): HtmlTreeNode | null {
  if (!budget.remaining-- || depth > 14) return null;
  const classes = [...element.classList].slice(0, 2).map((name) => `.${name}`).join("");
  const label = `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${classes}`;
  const summary = [...element.childNodes].filter((node) => node.nodeType === 3).map((node) => node.textContent?.replace(/\s+/g, " ").trim()).filter(Boolean).join(" ").slice(0, 90);
  const children: HtmlTreeNode[] = [];
  for (const child of [...element.children]) {
    const node = buildHtmlTree(child, doc, budget, depth + 1);
    if (node) children.push(node);
  }
  return { selector: selectorFor(element, doc, false), label, summary, children };
}

function filterTree(node: HtmlTreeNode, query: string): HtmlTreeNode | null {
  const children = node.children.map((child) => filterTree(child, query)).filter((child): child is HtmlTreeNode => !!child);
  return `${node.label} ${node.summary}`.toLowerCase().includes(query) || children.length ? { ...node, children } : null;
}

function treePath(node: HtmlTreeNode | null, selector: string): string[] {
  if (!node) return [];
  if (node.selector === selector) return [node.selector];
  for (const child of node.children) {
    const path = treePath(child, selector);
    if (path.length) return [node.selector, ...path];
  }
  return [];
}

function HtmlTreeItem({ node, depth, selected, hovered, hoverPath, onSelect }: { node: HtmlTreeNode; depth: number; selected: string; hovered: string; hoverPath: string[]; onSelect: (selector: string) => void }) {
  const [expanded, setExpanded] = useState(depth < 2);
  const rowRef = useRef<HTMLButtonElement>(null);
  const inHoverPath = hoverPath.includes(node.selector);
  const isHovered = hovered === node.selector;

  useEffect(() => {
    if (inHoverPath && node.children.length) setExpanded(true);
    if (isHovered && rowRef.current) {
      const container = rowRef.current.closest<HTMLElement>(".source-studio-tree-content");
      if (!container) return;
      const row = rowRef.current.getBoundingClientRect();
      const bounds = container.getBoundingClientRect();
      if (row.top < bounds.top) container.scrollTo({ top: container.scrollTop + row.top - bounds.top - 8, behavior: "smooth" });
      else if (row.bottom > bounds.bottom) container.scrollTo({ top: container.scrollTop + row.bottom - bounds.bottom + 8, behavior: "smooth" });
    }
  }, [inHoverPath, isHovered, node.children.length]);

  return <div className="source-tree-item" style={{ ["--tree-depth" as string]: depth }}>
    <div className="source-tree-row">
      {node.children.length ? <button className="source-tree-toggle" aria-label={expanded ? "Collapse element" : "Expand element"} onClick={() => setExpanded((value) => !value)}>{expanded ? <CaretDown size={13} /> : <CaretRight size={13} />}</button> : <span className="source-tree-spacer" />}
      <button ref={rowRef} className={`source-tree-select${selected === node.selector ? " selected" : ""}${isHovered ? " hovered" : ""}`} onClick={() => onSelect(node.selector)} title={node.selector}>
        <code>{node.label}</code>{node.summary && <span>{node.summary}</span>}
      </button>
    </div>
    {expanded && node.children.map((child, index) => <HtmlTreeItem key={`${child.selector}-${index}`} node={child} depth={depth + 1} selected={selected} hovered={hovered} hoverPath={hoverPath} onSelect={onSelect} />)}
  </div>;
}

export function SourceStudioPage() {
  const navigate = useNavigate();
  const [baseUrl, setBaseUrl] = useState("");
  const [name, setName] = useState("");
  const [lang, setLang] = useState("en");
  const [authorized, setAuthorized] = useState(false);
  const [stage, setStage] = useState<StudioStage>("catalog");
  const [mobilePane, setMobilePane] = useState<"config" | "preview" | "tree">("preview");
  const [sampleUrls, setSampleUrls] = useState<Record<StudioStage, string>>({ catalog: "", series: "", reader: "" });
  const [config, setConfig] = useState<Record<string, string>>({ pageStart: "1" });
  const [mappingKey, setMappingKey] = useState<MappingKey>("card");
  const [previewHtml, setPreviewHtml] = useState("");
  const [tree, setTree] = useState<HtmlTreeNode | null>(null);
  const [treeQuery, setTreeQuery] = useState("");
  const [selectedSelector, setSelectedSelector] = useState("");
  const [hoveredSelector, setHoveredSelector] = useState("");
  const [hoverPath, setHoverPath] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState("");
  const frameRef = useRef<HTMLIFrameElement>(null);
  const cleanupFrame = useRef<(() => void) | null>(null);
  const mappingRef = useRef(mappingKey);
  mappingRef.current = mappingKey;

  useEffect(() => () => cleanupFrame.current?.(), []);

  const loadPreview = async () => {
    setLoading(true);
    setError("");
    setReport("");
    try {
      const origin = sourceOrigin(baseUrl);
      const pageUrl = new URL(sampleUrls[stage] || origin.href, origin);
      if (pageUrl.origin !== origin.origin) throw new Error("Preview pages must use the source's exact domain");
      const page = await fetchDoc(pageUrl.href, { minGapMs: 1200, retries: 0 });
      setTree(buildHtmlTree(page.body, page, { remaining: 1800 }));
      setTreeQuery("");
      setPreviewHtml(safePreview(page, pageUrl.href));
      if (stage === "catalog" && !config.searchUrl) {
        const suggestion = suggestSearchTemplate(page, pageUrl.href);
        if (suggestion) setConfig((current) => ({ ...current, searchUrl: suggestion }));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load this page");
      setPreviewHtml("");
      setTree(null);
    } finally {
      setLoading(false);
    }
  };

  const mapElement = (target: Element, doc: Document) => {
    doc.querySelectorAll("[data-comik-picked]").forEach((element) => element.removeAttribute("data-comik-picked"));
    const key = mappingRef.current;
    const field = fields[stage].find((candidate) => candidate.key === key);
    let scope: Element | null = null;
    if (field?.scope && config[field.scope]) {
      try {
        scope = target.closest(config[field.scope]!);
      } catch {
        scope = null;
      }
    }
    const selector = selectorFor(target, doc, field?.repeated ?? false, scope);
    target.setAttribute("data-comik-picked", "");
    const treeSelector = selectorFor(target, doc, false);
    setSelectedSelector(treeSelector);
    setHoveredSelector(treeSelector);
    setHoverPath(treePath(tree, treeSelector));
    setConfig((current) => ({ ...current, [key]: selector }));
    setReport("");
  };

  const bindPreview = () => {
    cleanupFrame.current?.();
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    const onMove = (event: Event) => {
      doc.querySelectorAll("[data-comik-hover]").forEach((element) => element.removeAttribute("data-comik-hover"));
      const view = doc.defaultView;
      if (view && event.target instanceof view.Element) {
        const target = event.target;
        target.setAttribute("data-comik-hover", "");
        const selector = selectorFor(target, doc, false);
        setHoveredSelector(selector);
        setHoverPath(treePath(tree, selector));
      }
    };
    const onClick = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      const view = doc.defaultView;
      if (view && event.target instanceof view.Element) mapElement(event.target, doc);
    };
    doc.addEventListener("mouseover", onMove);
    doc.addEventListener("click", onClick, true);
    cleanupFrame.current = () => {
      doc.removeEventListener("mouseover", onMove);
      doc.removeEventListener("click", onClick, true);
    };
  };

  const clearHover = () => {
    setHoveredSelector("");
    setHoverPath([]);
  };

  const mapTreeElement = (selector: string) => {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    try {
      const element = doc.querySelector(selector);
      if (element) mapElement(element, doc);
    } catch {
      setReport("That tree selector is no longer available in this preview.");
    }
  };

  const checkPage = () => {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return setReport("Load a preview page first.");
    const results = fields[stage].filter((field) => config[field.key]).map((field) => {
      try {
        const scope = field.scope && config[field.scope] ? doc.querySelector(config[field.scope]!) : doc;
        const count = scope?.querySelectorAll(config[field.key]!).length ?? 0;
        return `${field.label}: ${count} match${count === 1 ? "" : "es"}`;
      } catch {
        return `${field.label}: invalid selector`;
      }
    });
    setReport(results.length ? results.join(" · ") : "Map at least one field to check this page.");
  };

  const useCurrentAsPopular = () => {
    try {
      const origin = sourceOrigin(baseUrl);
      const pageUrl = new URL(sampleUrls.catalog || origin.href, origin);
      if (pageUrl.origin !== origin.origin) throw new Error("Use a catalog page on the source's exact domain");
      setConfig((current) => ({ ...current, popularUrl: pageUrl.pathname + pageUrl.search }));
      setReport("Current catalog page saved as the popular-list URL.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Check the site address");
    }
  };

  const save = async () => {
    try {
      if (!authorized) throw new Error("Confirm that you are allowed to access this site with Comik");
      const origin = sourceOrigin(baseUrl);
      if (!config.popularUrl || !config.card || !config.chapterRow || !config.pageImage) throw new Error("Map the catalog card, chapter row, and reader image, then set a catalog URL");
      const savedConfig = Object.fromEntries(Object.entries(config).filter(([, value]) => value.trim())) as Record<string, string>;
      await addCustomSource({ kind: "selector", name: name.trim() || origin.host, baseUrl: origin.origin, lang: lang.trim() || "en", config: savedConfig });
      toast("Source added");
      setBaseUrl("");
      setName("");
      setSampleUrls({ catalog: "", series: "", reader: "" });
      setConfig({ pageStart: "1" });
      setPreviewHtml("");
      setTree(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this source");
    }
  };

  const stageFields = fields[stage];
  const currentUrl = sampleUrls[stage];
  const visibleTree = tree && treeQuery.trim() ? filterTree(tree, treeQuery.trim().toLowerCase()) : tree;
  let liveUrl = "";
  try {
    const origin = sourceOrigin(baseUrl);
    const candidate = new URL(currentUrl || origin.href, origin);
    if (candidate.origin === origin.origin) liveUrl = candidate.href;
  } catch {
    liveUrl = "";
  }

  return (
    <div className="page source-studio-page">
      <button className="icon-btn source-studio-back source-studio-floatbar" onClick={() => navigate("/settings#sources")} aria-label="Back to settings"><ArrowLeft size={15} /></button>

      <div className="source-studio-mobile-tabs" role="tablist" aria-label="Studio panel">
        {(["config", "preview", "tree"] as const).map((pane) => <button key={pane} className={mobilePane === pane ? "active" : ""} role="tab" aria-selected={mobilePane === pane} onClick={() => setMobilePane(pane)}>{pane === "config" ? "Config" : pane === "preview" ? "Preview" : "HTML tree"}</button>)}
      </div>
      <div className="source-studio-workspace" data-mobile-pane={mobilePane}>
        <aside className="source-studio-config" aria-label="Source configuration">
          <div className="source-studio-config-group source-studio-identity">
            <div className="source-studio-group-title">Source identity</div>
            <label className="field"><span className="label">Site domain</span><input className="input" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://reader.example" autoComplete="url" /></label>
            <label className="field"><span className="label">Source name</span><input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Defaults to domain" /></label>
            <label className="field"><span className="label">Language</span><input className="input" value={lang} onChange={(event) => setLang(event.target.value)} placeholder="en" /></label>
          </div>
          <div className="source-studio-stage-list" role="tablist" aria-label="Page type">
            {(Object.keys(stageLabels) as StudioStage[]).map((key) => <button key={key} className={`source-studio-stage${stage === key ? " active" : ""}`} role="tab" aria-selected={stage === key} onClick={() => { setStage(key); setPreviewHtml(""); setTree(null); setError(""); setReport(""); setSelectedSelector(""); setMappingKey(fields[key][0]!.key); }}><span>{stageLabels[key]}</span></button>)}
          </div>

          <div className="source-studio-config-group">
            <div className="source-studio-group-title">Fields</div>
            {stageFields.map((field) => <button key={field.key} className={`source-studio-config-item${mappingKey === field.key ? " active" : ""}`} onClick={() => setMappingKey(field.key)}>
              <span className={`source-studio-config-check${config[field.key] ? " done" : ""}`}>{config[field.key] ? <Check size={12} weight="bold" /> : null}</span>
              <span className="source-studio-config-label">{field.label}<code>{config[field.key] || "Unmapped"}</code></span>
            </button>)}
          </div>

          {stage === "catalog" && <div className="source-studio-config-group">
            <div className="source-studio-group-title">Catalog URLs</div>
            <label className="field"><span className="label">Popular list</span><input className="input mono" value={config.popularUrl ?? ""} onChange={(event) => setConfig((current) => ({ ...current, popularUrl: event.target.value }))} placeholder="/manga/?page={page}" /></label>
            <label className="field"><span className="label">Search</span><input className="input mono" value={config.searchUrl ?? ""} onChange={(event) => setConfig((current) => ({ ...current, searchUrl: event.target.value }))} placeholder="/search?q={query}&page={page}" /></label>
            <label className="field"><span className="label">Latest (optional)</span><input className="input mono" value={config.latestUrl ?? ""} onChange={(event) => setConfig((current) => ({ ...current, latestUrl: event.target.value }))} placeholder="/latest/?page={page}" /></label>
            <div className="source-studio-url-options"><button className="btn sm" disabled={!currentUrl} onClick={useCurrentAsPopular}>Use sample as popular</button><label>First page<input className="input mono" inputMode="numeric" value={config.pageStart ?? "1"} onChange={(event) => setConfig((current) => ({ ...current, pageStart: event.target.value }))} /></label></div>
          </div>}

          <div className="source-studio-config-group source-studio-validation">
            <button className="btn sm" onClick={checkPage}><Check size={15} /> Check selectors</button>
            {report && <div className="source-studio-report" role="status">{report}</div>}
            {error && <div className="err source-studio-error" role="alert">{error}</div>}
            <label className="source-studio-consent"><input type="checkbox" checked={authorized} onChange={(event) => setAuthorized(event.target.checked)} /> I have permission to access this site.</label>
            <button className="btn primary source-studio-save" disabled={!authorized} onClick={() => void save()}><FloppyDisk size={16} /> Save source</button>
          </div>
        </aside>

        <div className="source-studio-view">
          <section className="source-studio-preview" aria-label="Page preview">
            <label className="field"><span className="label">Page URL</span>
              <div className="source-studio-preview-url"><input className="input" value={currentUrl} onChange={(event) => setSampleUrls((current) => ({ ...current, [stage]: event.target.value }))} placeholder={baseUrl || "https://reader.example/catalog"} /><button className="btn" disabled={loading || !baseUrl} onClick={() => void loadPreview()}><ArrowClockwise size={16} className={loading ? "spin" : ""} />{loading ? "Loading" : "Preview"}</button><a className="btn ghost" href={liveUrl || undefined} target="_blank" rel="noopener noreferrer" aria-disabled={!liveUrl} onClick={(event) => !liveUrl && event.preventDefault()}><ArrowSquareOut size={16} />Live</a></div>
            </label>
            {previewHtml ? <iframe ref={frameRef} className="source-studio-frame" title={`${stageLabels[stage]} page preview`} sandbox="allow-same-origin" srcDoc={previewHtml} onLoad={bindPreview} onMouseLeave={clearHover} /> : <div className="source-studio-empty">{loading ? "Fetching the sample page…" : "Enter a permitted page URL and load it to inspect its structure."}</div>}
          </section>

          <aside className="source-studio-tree" aria-label="HTML tree">
            <div className="source-studio-tree-search"><MagnifyingGlass size={15} /><input value={treeQuery} onChange={(event) => setTreeQuery(event.target.value)} placeholder="Find tag, class, or text" aria-label="Search HTML tree" /></div>
            <div className="source-studio-tree-content">
              {visibleTree ? <HtmlTreeItem node={visibleTree} depth={0} selected={selectedSelector} hovered={hoveredSelector} hoverPath={hoverPath} onSelect={mapTreeElement} /> : <div className="source-studio-tree-empty">{treeQuery ? "No matches" : "No page loaded"}</div>}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}