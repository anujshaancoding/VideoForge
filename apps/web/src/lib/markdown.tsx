// ─────────────────────────────────────────────────────────────────────────────
// Tiny, zero-dependency Markdown → React renderer for the in-app Docs page.
//
// We render the canonical `docs/USER_GUIDE.md` directly (single source of truth)
// rather than maintaining a second hand-authored copy in JSX. This supports the
// exact GFM subset that guide uses: ATX headings (#–####), `---` rules, GFM pipe
// tables, ordered/unordered lists, paragraphs, and inline `code` / **bold** /
// *italic* / [links](url). It is deliberately NOT a general Markdown engine — if
// the guide adopts a new construct, extend the block loop below.
// ─────────────────────────────────────────────────────────────────────────────

import type { ReactNode } from "react";

export interface TocEntry {
  id: string;
  text: string;
  level: 2 | 3;
}

export interface RenderedMarkdown {
  /** Level-2/3 headings, in document order, for a sidebar table of contents. */
  toc: TocEntry[];
  content: ReactNode;
}

/** URL-safe heading id derived from heading text (stable for #anchor links). */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Matches the inline constructs the guide uses. Order matters: code first (so we
// never format inside a code span), then bold (**) before italic (*), then links.
const INLINE_RE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/g;

function renderInline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  let m: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(text)) !== null) {
    const tok = m[0] ?? "";
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyBase}-${n++}`;
    if (tok.startsWith("`")) {
      out.push(
        <code
          key={key}
          className="rounded bg-vf-surface-3 px-1.5 py-0.5 font-mono text-[0.85em] text-vf-accent-text"
        >
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith("**")) {
      out.push(
        <strong key={key} className="font-semibold text-vf-text-primary">
          {tok.slice(2, -2)}
        </strong>,
      );
    } else if (tok.startsWith("*")) {
      out.push(<em key={key}>{tok.slice(1, -1)}</em>);
    } else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok);
      const label = link?.[1] ?? tok;
      const href = link?.[2] ?? "#";
      const external = /^https?:\/\//.test(href);
      out.push(
        <a
          key={key}
          href={href}
          className="text-vf-selection underline underline-offset-2 hover:no-underline"
          {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
        >
          {label}
        </a>,
      );
    }
    last = INLINE_RE.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const isTableSeparator = (line: string): boolean =>
  line.includes("|") && line.includes("-") && /^\s*\|?[\s:|-]+\|?\s*$/.test(line);

const splitRow = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

const isBlockStart = (line: string): boolean => {
  const t = line.trim();
  return (
    t === "" ||
    /^#{1,4}\s/.test(t) ||
    /^[-*]\s+/.test(t) ||
    /^\d+\.\s+/.test(t) ||
    /^---+$/.test(t)
  );
};

export function renderMarkdown(md: string): RenderedMarkdown {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  // Safe line accessor — the strict tsconfig (noUncheckedIndexedAccess) types raw
  // index access as `string | undefined`; out-of-range reads collapse to "".
  const at = (idx: number): string => lines[idx] ?? "";
  const toc: TocEntry[] = [];
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;

  while (i < lines.length) {
    const raw = at(i);
    const line = raw.trim();

    if (line === "") {
      i++;
      continue;
    }

    // Horizontal rule.
    if (/^---+$/.test(line) || /^\*\*\*+$/.test(line)) {
      blocks.push(<hr key={k++} className="my-10 border-vf-border-subtle" />);
      i++;
      continue;
    }

    // Headings.
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = (heading[1] ?? "").length;
      const text = (heading[2] ?? "").trim();
      const id = slugify(text);
      if (level === 1) {
        blocks.push(
          <h1 key={k++} className="mb-2 text-3xl font-bold tracking-tight text-vf-text-primary">
            {renderInline(text, `h1-${k}`)}
          </h1>,
        );
      } else if (level === 2) {
        toc.push({ id, text, level: 2 });
        blocks.push(
          <h2
            key={k++}
            id={id}
            className="mb-3 mt-12 scroll-mt-24 border-b border-vf-border-subtle pb-2 text-xl font-semibold text-vf-text-primary"
          >
            {renderInline(text, `h2-${k}`)}
          </h2>,
        );
      } else if (level === 3) {
        toc.push({ id, text, level: 3 });
        blocks.push(
          <h3 key={k++} id={id} className="mb-2 mt-8 scroll-mt-24 text-base font-semibold text-vf-text-primary">
            {renderInline(text, `h3-${k}`)}
          </h3>,
        );
      } else {
        blocks.push(
          <h4 key={k++} className="mb-2 mt-6 text-sm font-semibold text-vf-text-secondary">
            {renderInline(text, `h4-${k}`)}
          </h4>,
        );
      }
      i++;
      continue;
    }

    // GFM pipe table (header row + separator + body rows).
    if (raw.includes("|") && isTableSeparator(at(i + 1))) {
      const header = splitRow(raw);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && at(i).includes("|") && at(i).trim() !== "") {
        rows.push(splitRow(at(i)));
        i++;
      }
      blocks.push(
        <div key={k++} className="my-5 overflow-x-auto rounded-md border border-vf-border-subtle">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {header.map((c, ci) => (
                  <th
                    key={ci}
                    className="border-b border-vf-border-subtle bg-vf-surface-2 px-3 py-2 text-left font-semibold text-vf-text-primary"
                  >
                    {renderInline(c, `th-${k}-${ci}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="even:bg-vf-surface-1/40">
                  {r.map((c, ci) => (
                    <td
                      key={ci}
                      className="border-t border-vf-border-subtle px-3 py-2 align-top text-vf-text-secondary"
                    >
                      {renderInline(c, `td-${k}-${ri}-${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // Unordered list.
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(at(i))) {
        items.push(at(i).replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      blocks.push(
        <ul
          key={k++}
          className="my-3 list-disc space-y-1.5 pl-6 text-sm leading-relaxed text-vf-text-secondary marker:text-vf-text-tertiary"
        >
          {items.map((it, ii) => (
            <li key={ii}>{renderInline(it, `ul-${k}-${ii}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    // Ordered list.
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(at(i))) {
        items.push(at(i).replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      blocks.push(
        <ol
          key={k++}
          className="my-3 list-decimal space-y-1.5 pl-6 text-sm leading-relaxed text-vf-text-secondary marker:text-vf-text-tertiary"
        >
          {items.map((it, ii) => (
            <li key={ii}>{renderInline(it, `ol-${k}-${ii}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    // Paragraph — gather consecutive plain lines.
    const para: string[] = [];
    while (
      i < lines.length &&
      at(i).trim() !== "" &&
      !isBlockStart(at(i)) &&
      !(at(i).includes("|") && isTableSeparator(at(i + 1)))
    ) {
      para.push(at(i).trim());
      i++;
    }
    // Defensive: if nothing was gathered (shouldn't happen), consume one line.
    if (para.length === 0) {
      para.push(line);
      i++;
    }
    blocks.push(
      <p key={k++} className="my-3 text-sm leading-relaxed text-vf-text-secondary">
        {renderInline(para.join(" "), `p-${k}`)}
      </p>,
    );
  }

  return { toc, content: <>{blocks}</> };
}
