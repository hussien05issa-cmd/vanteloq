"use client";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import VanteloqAiLogo from "./vanteloq-ai-logo";

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";
const subscribeMotion = (changed: () => void) => {
  const query = window.matchMedia(reducedMotionQuery);
  query.addEventListener("change", changed);
  return () => query.removeEventListener("change", changed);
};
const motionSnapshot = () => window.matchMedia(reducedMotionQuery).matches;
const serverMotionSnapshot = () => true;

function inline(text: string, reveal: (text: string) => ReactNode = text => text) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => part.startsWith("**") && part.endsWith("**") ? <strong key={index}>{reveal(part.slice(2, -2))}</strong> : reveal(part));
}

/** Render a small, safe Markdown subset as React text; never interpret HTML. */
export function AdvisorAnswerContent({ text, visibleWords = Infinity }: { text: string; visibleWords?: number }) {
  const lines = text.split(/\r?\n/), blocks: ReactNode[] = [];
  let word = 0;
  const reveal = (value: string) => !Number.isFinite(visibleWords) ? value : value.split(/(\s+)/).map((part, index) => {
    if (!part.trim()) return word <= visibleWords ? part : null;
    word++;
    return word <= visibleWords ? <span className={Number.isFinite(visibleWords) ? "ai-reply-word" : undefined} key={index}>{part}</span> : null;
  });
  const rendered = (value: string) => inline(value, reveal);
  const cells = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|").map(cell => cell.trim());
  for (let index = 0; index < lines.length; index++) {
    if (word >= visibleWords) break;
    const line = lines[index].trim();
    if (!line) continue;
    if (line.includes("|") && lines[index + 1]?.includes("|") && cells(lines[index + 1]).every(cell => /^:?-{3,}:?$/.test(cell))) {
      const headers = cells(line), rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) rows.push(cells(lines[index++]));
      index--;
      // Financial tables appear as complete units, never partial numbers or cells.
      word += [headers, ...rows].flat().join(" ").split(/\s+/).length;
      blocks.push(<div className="ai-answer-table" key={index}><table><caption>Analysis data</caption><thead><tr>{headers.map((header, i) => <th scope="col" key={i}>{inline(header)}</th>)}</tr></thead><tbody>{rows.map((row, r) => <tr key={r}>{headers.map((_, c) => <td key={c}>{inline(row[c] ?? "")}</td>)}</tr>)}</tbody></table></div>);
    } else if (/^#{1,6}\s/.test(line)) {
      blocks.push(<h4 key={index}>{rendered(line.replace(/^#{1,6}\s+/, ""))}</h4>);
    } else if (/^(?:[-*]\s|\d+\.\s)/.test(line)) {
      const ordered = /^\d+\./.test(line), items: string[] = [];
      const pattern = ordered ? /^\d+\.\s+/ : /^[-*]\s+/;
      const start = ordered ? Number.parseInt(line, 10) : undefined;
      while (index < lines.length && pattern.test(lines[index].trim())) items.push(lines[index++].trim().replace(pattern, ""));
      index--;
      const content = items.map((item, i) => word >= visibleWords ? null : <li key={i}>{rendered(item)}</li>);
      blocks.push(ordered ? <ol start={start} key={index}>{content}</ol> : <ul key={index}>{content}</ul>);
    } else blocks.push(<p key={index}>{rendered(line)}</p>);
  }
  return <div className="ai-answer-content">{blocks}</div>;
}

export default function AdvisorResponse({ title, body, limitation, children, animate = false }: { title: string; body: string; limitation: string; children?: ReactNode; animate?: boolean }) {
  const [wordProgress, setVisibleWords] = useState(0);
  const reducedMotion = useSyncExternalStore(subscribeMotion, motionSnapshot, serverMotionSnapshot);
  const visibleWords = animate && !reducedMotion ? wordProgress : Infinity;
  const end = useRef<HTMLSpanElement>(null);
  const following = useRef(true);
  const finish = useRef(false);
  const revealing = Number.isFinite(visibleWords);
  useEffect(() => {
    if (!animate || reducedMotion) return;
    const total = body.split(/\s+/).length;
    finish.current = false;
    const duration = Math.min(18_000, total * 65);
    const started = performance.now();
    const timer = setInterval(() => {
      if (finish.current) { clearInterval(timer); setVisibleWords(Infinity); return; }
      const progress = Math.min(1, (performance.now() - started) / Math.max(1, duration));
      setVisibleWords(progress === 1 ? Infinity : Math.max(1, Math.ceil(total * progress)));
      if (progress === 1) clearInterval(timer);
    }, 45);
    const trackScroll = () => {
      const bottom = end.current?.getBoundingClientRect().bottom ?? 0;
      following.current = bottom <= window.innerHeight + 110 && bottom >= 0;
    };
    trackScroll();
    window.addEventListener("scroll", trackScroll, { passive: true });
    return () => { clearInterval(timer); window.removeEventListener("scroll", trackScroll); };
  }, [body, animate, reducedMotion]);
  useEffect(() => {
    if (revealing && following.current && end.current && end.current.getBoundingClientRect().bottom > window.innerHeight - 40)
      end.current.scrollIntoView({ block: "nearest", behavior: "auto" });
  }, [visibleWords, revealing]);
  return <article className={"advisor-answer" + (revealing ? " is-revealing" : "")} aria-label="Vanteloq AI response">
    <header className="advisor-response-heading"><VanteloqAiLogo size={36} active={revealing} decorative/><strong>Vanteloq AI</strong>{revealing && <span className="ai-writing-label" aria-hidden="true">Writing</span>}</header>
    {title !== "Vanteloq AI" && <h3>{title}</h3>}
    <div className="ai-response-body" aria-hidden={revealing || undefined}><AdvisorAnswerContent text={body} visibleWords={visibleWords}/></div>
    <span className="ai-visually-hidden" role="status">{revealing ? "Vanteloq AI is writing a reply." : "Reply ready."}</span>
    <span ref={end} className="ai-reply-end" aria-hidden="true"/>
    {revealing ? <button type="button" className="ai-text-button" onClick={() => { finish.current = true; setVisibleWords(Infinity); }}>Show full answer</button> : <footer className="ai-response-footer"><p>{limitation}</p>{children}</footer>}
  </article>;
}
