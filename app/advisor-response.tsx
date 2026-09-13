import type { ReactNode } from "react";
import VanteloqAiLogo from "./vanteloq-ai-logo";

function inline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => part.startsWith("**") && part.endsWith("**") ? <strong key={index}>{part.slice(2, -2)}</strong> : part);
}

/** Render a small, safe Markdown subset as React text; never interpret HTML. */
export function AdvisorAnswerContent({ text }: { text: string }) {
  const lines = text.split(/\r?\n/), blocks: ReactNode[] = [];
  const cells = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|").map(cell => cell.trim());
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line) continue;
    if (line.includes("|") && lines[index + 1]?.includes("|") && cells(lines[index + 1]).every(cell => /^:?-{3,}:?$/.test(cell))) {
      const headers = cells(line), rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) rows.push(cells(lines[index++]));
      index--;
      blocks.push(<div className="ai-answer-table" key={index}><table><caption>Analysis data</caption><thead><tr>{headers.map((header, i) => <th scope="col" key={i}>{inline(header)}</th>)}</tr></thead><tbody>{rows.map((row, r) => <tr key={r}>{headers.map((_, c) => <td key={c}>{inline(row[c] ?? "")}</td>)}</tr>)}</tbody></table></div>);
    } else if (/^#{1,6}\s/.test(line)) {
      blocks.push(<h4 key={index}>{inline(line.replace(/^#{1,6}\s+/, ""))}</h4>);
    } else if (/^(?:[-*]\s|\d+\.\s)/.test(line)) {
      const ordered = /^\d+\./.test(line), items: string[] = [];
      const pattern = ordered ? /^\d+\.\s+/ : /^[-*]\s+/;
      const start = ordered ? Number.parseInt(line, 10) : undefined;
      while (index < lines.length && pattern.test(lines[index].trim())) items.push(lines[index++].trim().replace(pattern, ""));
      index--;
      const content = items.map((item, i) => <li key={i}>{inline(item)}</li>);
      blocks.push(ordered ? <ol start={start} key={index}>{content}</ol> : <ul key={index}>{content}</ul>);
    } else blocks.push(<p key={index}>{inline(line)}</p>);
  }
  return <div className="ai-answer-content">{blocks}</div>;
}

export default function AdvisorResponse({ title, body, limitation, children }: { title: string; body: string; limitation: string; children?: ReactNode }) {
  return <article className="advisor-answer">
    <header className="advisor-response-heading"><VanteloqAiLogo size={36} decorative/><strong>Vanteloq AI</strong></header>
    <h3>{title}</h3>
    <AdvisorAnswerContent text={body}/>
    <div>{limitation}</div>
    {children}
  </article>;
}
