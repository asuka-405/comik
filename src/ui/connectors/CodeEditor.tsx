import { forwardRef, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from "react";
import type { Severity } from "@/core/connectors/diagnose";

export interface EditorHandle { jump(line: number, column?: number): void }

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Lines to colour in the gutter. */
  marks?: Record<number, Severity>;
  label: string;
  placeholder?: string;
  minRows?: number;
}

const LINE = 19;

/** A plain text area with line numbers, a caret position and a way to jump to a line, so error positions can be followed. */
export const CodeEditor = forwardRef<EditorHandle, Props>(function CodeEditor({ value, onChange, marks = {}, label, placeholder, minRows = 14 }, handle) {
  const area = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const [caret, setCaret] = useState({ line: 1, column: 1 });
  const count = useMemo(() => value.split("\n").length, [value]);

  const numbers = useMemo(() => {
    const out: ReactNode[] = [];
    let run = "";
    for (let n = 1; n <= count; n++) {
      const mark = marks[n];
      if (mark) { if (run) { out.push(run); run = ""; } out.push(<span key={n} className={`gut-${mark}`}>{n}{"\n"}</span>); }
      else run += `${n}\n`;
    }
    if (run) out.push(run);
    return out;
  }, [count, marks]);

  const track = () => {
    const el = area.current;
    if (!el) return;
    const before = el.value.slice(0, el.selectionStart);
    const line = before.split("\n").length;
    setCaret({ line, column: el.selectionStart - (before.lastIndexOf("\n") + 1) + 1 });
  };

  useImperativeHandle(handle, () => ({
    jump(line, column = 1) {
      const el = area.current;
      if (!el) return;
      const lines = el.value.split("\n");
      const row = Math.min(Math.max(line, 1), lines.length);
      const text = lines[row - 1]!;
      const col = Math.min(Math.max(column - 1, 0), text.length);
      const start = lines.slice(0, row - 1).reduce((sum, l) => sum + l.length + 1, 0) + col;
      const token = /^[\w$]+|^./.exec(text.slice(col));
      el.focus();
      el.setSelectionRange(start, start + (token ? token[0].length : 0));
      el.scrollTop = Math.max(0, (row - 4) * LINE);
      if (gutter.current) gutter.current.scrollTop = el.scrollTop;
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      track();
    },
  }));

  return (
    <div className="code-editor">
      <div className="code-editor-body" style={{ ["--rows" as string]: minRows }}>
        <div className="code-gutter" ref={gutter} aria-hidden="true"><pre>{numbers}</pre></div>
        <textarea
          ref={area}
          className="input code-area"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          wrap="off"
          value={value}
          placeholder={placeholder}
          aria-label={label}
          onChange={(event) => { onChange(event.target.value); track(); }}
          onScroll={(event) => { if (gutter.current) gutter.current.scrollTop = event.currentTarget.scrollTop; }}
          onKeyUp={track}
          onClick={track}
          onSelect={track}
        />
      </div>
      <div className="code-status mono muted"><span>Ln {caret.line}, Col {caret.column}</span><span>{count} {count === 1 ? "line" : "lines"}, {value.length.toLocaleString()} characters</span></div>
    </div>
  );
});
