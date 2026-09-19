"use client";
import { Fragment, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import VanteloqAiLogo from "./vanteloq-ai-logo";

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";
const subscribeMotion = (changed: () => void) => {
  const query = window.matchMedia(reducedMotionQuery);
  query.addEventListener("change", changed);
  return () => query.removeEventListener("change", changed);
};
const motionSnapshot = () => window.matchMedia(reducedMotionQuery).matches;
const serverMotionSnapshot = () => true;

type AnswerBlock =
  | { kind: "paragraph" | "heading"; text: string }
  | { kind: "code"; text: string; language: string }
  | { kind: "list"; ordered: boolean; start: number; items: AnswerBlock[][] }
  | { kind: "quote"; blocks: AnswerBlock[] }
  | { kind: "rule" }
  | { kind: "table"; headers: string[]; rows: string[][]; align: Array<"left" | "center" | "right"> };

const listLine = (line: string) => /^( *)([-+*]|\d+[.)])\s+(.*)$/.exec(line);
const fenceLine = (line: string) => /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
const isRule = (line: string) => /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line);
function tableCells(line: string) {
  const value = line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "");
  const cells: string[] = [];
  let cell = "", code = false;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (character === "\\" && value[index + 1] === "|") { cell += "|"; index++; }
    else if (character === "`") { code = !code; cell += character; }
    else if (character === "|" && !code) { cells.push(cell.trim()); cell = ""; }
    else cell += character;
  }
  cells.push(cell.trim());
  return cells;
}
function tableStart(lines: string[], index: number) {
  if (!lines[index]?.includes("|") || !lines[index + 1]?.includes("|")) return false;
  const headers = tableCells(lines[index]), separators = tableCells(lines[index + 1]);
  return headers.length === separators.length && separators.every(cell => /^:?-{3,}:?$/.test(cell));
}
function beginsBlock(lines: string[], index: number) {
  const line = lines[index];
  return /^ {0,3}#{1,6}\s/.test(line) || listLine(line) || fenceLine(line) || /^ {0,3}>/.test(line) || isRule(line) || tableStart(lines, index);
}

/** A bounded Markdown subset. Links and HTML always remain inert text. */
function parseBlocks(lines: string[], depth = 0): AnswerBlock[] {
  if (depth > 24) return [{ kind: "paragraph", text: lines.join("\n") }];
  const blocks: AnswerBlock[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.trim()) { index++; continue; }
    const fence = fenceLine(line);
    if (fence) {
      const content: string[] = [], marker = fence[1][0], size = fence[1].length;
      index++;
      while (index < lines.length) {
        const closing = lines[index].trim();
        if (closing.length >= size && [...closing].every(character => character === marker)) { index++; break; }
        content.push(lines[index++]);
      }
      const language = fence[2].trim();
      blocks.push({ kind: "code", text: content.join("\n"), language: /^[\w+-]{1,32}$/.test(language) ? language : "" });
    } else if (tableStart(lines, index)) {
      const headers = tableCells(line), separators = tableCells(lines[index + 1]), rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].trim() && lines[index].includes("|") && !beginsBlock(lines, index)) rows.push(tableCells(lines[index++]));
      blocks.push({ kind: "table", headers, rows, align: separators.map(cell => cell.endsWith(":") ? cell.startsWith(":") ? "center" : "right" : "left") });
    } else if (/^ {0,3}#{1,6}\s/.test(line)) {
      blocks.push({ kind: "heading", text: line.trim().replace(/^#{1,6}\s+/, "").replace(/\s+#+\s*$/, "") }); index++;
    } else if (isRule(line)) {
      blocks.push({ kind: "rule" }); index++;
    } else if (/^ {0,3}>/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^ {0,3}>/.test(lines[index])) quote.push(lines[index++].replace(/^ {0,3}> ?/, ""));
      blocks.push({ kind: "quote", blocks: parseBlocks(quote, depth + 1) });
    } else if (listLine(line)) {
      const first = listLine(line)!, indent = first[1].length, ordered = /^\d/.test(first[2]), items: AnswerBlock[][] = [];
      while (index < lines.length) {
        const item = listLine(lines[index]);
        if (!item || item[1].length !== indent || /^\d/.test(item[2]) !== ordered) break;
        const contentIndent = lines[index].length - item[3].length;
        const content = [item[3]];
        index++;
        while (index < lines.length) {
          if (!lines[index].trim()) {
            let next = index + 1;
            while (next < lines.length && !lines[next].trim()) next++;
            if (next < lines.length && lines[next].match(/^ */)![0].length > indent) { content.push(""); index++; continue; }
            if (next < lines.length && listLine(lines[next])?.[1].length === indent) index = next;
            break;
          }
          const whitespace = lines[index].match(/^ */)![0].length;
          if (whitespace <= indent) break;
          content.push(lines[index++].slice(Math.min(contentIndent, whitespace)));
        }
        items.push(parseBlocks(content, depth + 1));
      }
      blocks.push({ kind: "list", ordered, start: ordered ? Number.parseInt(first[2], 10) : 1, items });
    } else {
      const paragraph = [line.trim()]; index++;
      while (index < lines.length && lines[index].trim() && !beginsBlock(lines, index)) paragraph.push(lines[index++].trim());
      blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
    }
  }
  return blocks;
}

function inline(text: string, reveal: (value: string) => ReactNode, depth = 0): ReactNode {
  if (depth > 8) return reveal(text);
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*|(?<![A-Za-z0-9])__[^_]+__(?![A-Za-z0-9])|\*[^*\n]+\*|(?<![A-Za-z0-9])_[^_\n]+_(?![A-Za-z0-9]))/g).map((part, index) => {
    if (/^`[^`]+`$/.test(part)) return <code key={index}>{reveal(part.slice(1, -1))}</code>;
    if (/^(\*\*[^*]+\*\*|__[^_]+__)$/.test(part)) return <strong key={index}>{inline(part.slice(2, -2), reveal, depth + 1)}</strong>;
    if (/^(\*[^*\n]+\*|_[^_\n]+_)$/.test(part)) return <em key={index}>{inline(part.slice(1, -1), reveal, depth + 1)}</em>;
    return <Fragment key={index}>{reveal(part)}</Fragment>;
  });
}

function renderAnswerContent(text: string, animate: boolean) {
  let words = 0;
  const transition = (value: string) => {
    const delay = Math.min(1200, Math.floor(words / 6) * 30);
    words += value.match(/\S+/g)?.length ?? 0;
    return animate ? { className: "ai-reply-chunk", style: { "--ai-reveal-delay": `${delay}ms` } as CSSProperties } : {};
  };
  const reveal = (value: string) => {
    if (!animate) return value;
    const tokens = value.match(/\s*\S+\s*/g);
    if (!tokens) return value;
    const chunks: ReactNode[] = [];
    for (let index = 0; index < tokens.length; index += 6) {
      const chunk = tokens.slice(index, index + 6).join("");
      chunks.push(<span key={index} {...transition(chunk)}>{chunk}</span>);
    }
    return chunks;
  };
  const rendered = (value: string) => inline(value, reveal);
  const renderBlocks = (blocks: AnswerBlock[], inList = false): ReactNode => blocks.map((block, index) => {
    switch (block.kind) {
      case "paragraph": return inList && index === 0 ? <Fragment key={index}>{rendered(block.text)}</Fragment> : <p key={index}>{rendered(block.text)}</p>;
      case "heading": return <h4 key={index}>{rendered(block.text)}</h4>;
      case "rule": return <hr key={index}/>;
      case "quote": return <blockquote key={index}>{renderBlocks(block.blocks)}</blockquote>;
      case "list": {
        const items = block.items.map((item, itemIndex) => <li key={itemIndex}>{renderBlocks(item, true)}</li>);
        return block.ordered ? <ol start={block.start} key={index}>{items}</ol> : <ul key={index}>{items}</ul>;
      }
      case "code": return <div className="ai-answer-code" key={index}><div {...transition(block.text)}>{block.language && <span className="ai-code-language">{block.language}</span>}<pre tabIndex={0} aria-label="Code example"><code>{block.text}</code></pre></div></div>;
      case "table": {
        const animation = transition([block.headers, ...block.rows].flat().join(" "));
        return <div className="ai-answer-table" key={index} tabIndex={0} role="region" aria-label="Analysis data table"><table {...animation}><caption>Analysis data</caption><thead><tr>{block.headers.map((header, cell) => <th scope="col" key={cell} style={{ textAlign: block.align[cell] }}>{inline(header, value => value)}</th>)}</tr></thead><tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{block.headers.map((_, cell) => <td key={cell} style={{ textAlign: block.align[cell] }}>{inline(row[cell] ?? "", value => value)}</td>)}</tr>)}</tbody></table></div>;
      }
    }
  });
  return <div className="ai-answer-content">{renderBlocks(parseBlocks(text.split(/\r?\n/)))}</div>;
}

export function AdvisorAnswerContent({ text, animate = false }: { text: string; animate?: boolean }) {
  return renderAnswerContent(text, animate);
}

export default function AdvisorResponse({ title, body, limitation, children, animate = false }: { title: string; body: string; limitation: string; children?: ReactNode; animate?: boolean }) {
  const reducedMotion = useSyncExternalStore(subscribeMotion, motionSnapshot, serverMotionSnapshot);
  // Text and final geometry are present immediately. Only opacity is staggered,
  // so assistive technology can read the answer without waiting for animation.
  return <article className="advisor-answer" aria-label="Vanteloq AI response">
    <header className="advisor-response-heading"><VanteloqAiLogo size={36} decorative/><strong>Vanteloq AI</strong></header>
    {title !== "Vanteloq AI" && <h3>{title}</h3>}
    <div className="ai-response-body"><AdvisorAnswerContent key={body} text={body} animate={animate && !reducedMotion}/></div>
    <span className="ai-visually-hidden" role="status">Reply ready.</span>
    <footer className="ai-response-footer"><p>{limitation}</p>{children}</footer>
  </article>;
}
