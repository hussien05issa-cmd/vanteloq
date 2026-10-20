"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useMotionPreference } from "./use-motion-preference";
import { playProductFilm } from "./play-product-film";
import "./home-data-studio.css";

const sheets = ["Overview", "Sales", "Margin", "Inventory", "Cash", "Data Quality", "Sources"] as const;
type Sheet = typeof sheets[number];
const sampleSales = [
  { id: "0001", date: "2026-09-01", sales: 870000, cost: 550000 },
  { id: "0002", date: "2026-09-02", sales: 570000, cost: 360000 },
  { id: "0003", date: "2026-09-03", sales: -20000, cost: -10000 },
];
const net = sampleSales.reduce((sum, row) => sum + row.sales, 0);
const profit = sampleSales.reduce((sum, row) => sum + row.sales - row.cost, 0);
const money = (cents: number) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(cents / 100);

function SheetPreview({ sheet }: { sheet: Sheet }) {
  if (sheet === "Overview") return <><div className="home-studio-metrics"><div><span>Recorded net sales</span><strong>{money(net)}</strong></div><div><span>Recorded gross profit</span><strong>{money(profit)}</strong></div><div><span>Weighted gross margin</span><strong>{(profit / net * 100).toFixed(1)}%</strong></div></div><p className="home-studio-description">One review. Seven sheets. The source notes travel with it.</p><p>Choose the period and scope in Reports → Data Studio.</p></>;
  if (sheet === "Sales" || sheet === "Margin") return <><div className="home-studio-table-scroll" tabIndex={0} role="region" aria-label={`${sheet} sample records`}><table><caption>{sheet === "Sales" ? "Recorded daily sales" : "Recorded sales less known costs"}</caption><thead><tr><th scope="col">Record</th><th scope="col">Date</th><th scope="col">{sheet === "Sales" ? "Net sales" : "Gross profit"}</th></tr></thead><tbody>{sampleSales.map(row => <tr key={row.id}><td>{row.id}</td><td>{row.date}</td><td>{money(sheet === "Sales" ? row.sales : row.sales - row.cost)}</td></tr>)}</tbody></table></div><p>{sheet === "Margin" ? "Missing costs stay blank. They never become zero." : "Identifiers stay text. Exact minor units are retained in the workbook."}</p></>;
  if (sheet === "Inventory" || sheet === "Cash") return <><p className="home-studio-description">{sheet === "Cash" ? "Posted ledger cash" : "Posted ledger inventory"}</p><div className="home-studio-boundary"><strong>No posted balance in this sample</strong><span>BookLoQ figures appear only when the scope and your permissions allow them.</span></div><p>{sheet === "Cash" ? "A posted ledger balance is separate from a current bank balance." : "A posted ledger value is separate from physical stock quantities."}</p></>;
  if (sheet === "Data Quality") return <><p className="home-studio-description">Know what the review covers.</p><dl className="home-studio-checks"><div><dt>Stored row extraction</dt><dd>Complete selected scope</dd></div><div><dt>Provider history</dt><dd>Not certified</dd></div><div><dt>Missing information</dt><dd>Labelled in the review</dd></div></dl><p>Recorded dates do not prove the business was closed on other dates.</p></>;
  return <><p className="home-studio-description">Keep the trail behind the total.</p><dl className="home-studio-checks"><div><dt>Period, location and source</dt><dd>Kept with the review</dd></div><div><dt>Extraction and generation</dt><dd>UTC timestamps</dd></div><div><dt>Calculation and snapshot</dt><dd>Version and fingerprint</dd></div></dl><p>Restricted fields are omitted before export.</p></>;
}

export default function HomeDataStudio({ openReports }: { openReports: () => void }) {
  const id = useId();
  const [sheet, setSheet] = useState<Sheet>("Overview");
  const [film, setFilm] = useState(false);
  const [failed, setFailed] = useState(false);
  const [playbackMessage, setPlaybackMessage] = useState("");
  const stage = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const retryButton = useRef<HTMLButtonElement>(null);
  const previousFilm = useRef(false);
  const motion = useMotionPreference();
  useEffect(() => { if (!motion) video.current?.pause(); }, [motion]);
  useEffect(() => {
    const wasFilm = previousFilm.current;
    previousFilm.current = film;
    if (!film) { if (wasFilm) tabRefs.current[sheets.indexOf(sheet)]?.focus(); return; }
    if (failed) { retryButton.current?.focus(); return; }
    const element = video.current;
    element?.focus({ preventScroll: true });
    return () => element?.pause();
  }, [film, failed, sheet]);
  useEffect(() => {
    const pause = () => { if (document.hidden) video.current?.pause(); };
    document.addEventListener("visibilitychange", pause);
    const observer = "IntersectionObserver" in window ? new IntersectionObserver(entries => {
      if (!entries[0]?.isIntersecting) video.current?.pause();
    }, { threshold: .1 }) : null;
    if (stage.current) observer?.observe(stage.current);
    return () => { document.removeEventListener("visibilitychange", pause); observer?.disconnect(); };
  }, []);
  const select = (value: Sheet) => { setFilm(false); setSheet(value); };
  const watch = () => {
    setFilm(true); setFailed(false); setPlaybackMessage("");
    playProductFilm(video.current, () => setPlaybackMessage("Select Play to watch the review, or use the player’s controls."));
  };
  const returnToPreview = () => { video.current?.pause(); setFilm(false); };
  const keys = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = event.key === "ArrowRight" ? (index + 1) % sheets.length : event.key === "ArrowLeft" ? (index + sheets.length - 1) % sheets.length : event.key === "Home" ? 0 : event.key === "End" ? sheets.length - 1 : null;
    if (next === null) return;
    event.preventDefault(); select(sheets[next]); tabRefs.current[next]?.focus();
  };
  return <section className="home-data-studio" id="data-studio" aria-labelledby={`${id}-title`}>
    <div className="home-studio-copy" data-motion-item="0"><p className="demo-eyebrow">VANTELOQ DATA STUDIO</p><h2 id={`${id}-title`}>Your data.<br/>{" "}<em>Your own workspace.</em></h2><p>Build dashboards, work in Sheets and explore supported SQL. Save your analysis, pin it to your overview and trace results to their sources.</p><button type="button" onClick={openReports}>Open Data Studio <span aria-hidden="true">↗</span></button><small>Choose Data Studio in your workspace sidebar. Existing source, location and export permissions apply.</small></div>
    <div className="home-studio-preview" data-motion-item="1" ref={stage}>
      <header><div><strong>Executive Review</strong><span>Fictional sample records · CAD</span></div><button type="button" aria-expanded={film} aria-controls={`${id}-film`} onClick={film ? returnToPreview : watch}>{film ? "Back to preview" : "Watch Data Studio"}<span aria-hidden="true">{film ? "↩" : "▶"}</span></button></header>
      <div className="home-studio-film" id={`${id}-film`} hidden={!film}>
        {failed && <div className="home-studio-film-error"><p role="alert">The film could not load. Please try again.</p><button ref={retryButton} type="button" onClick={watch}>Try again</button><button type="button" onClick={returnToPreview}>Return to preview</button></div>}
        <video ref={video} src="/brand/homepage-glass-2026-10-13/data-studio-film.mp4" hidden={failed} tabIndex={0} controls playsInline muted preload="none" poster="/brand/homepage-glass-2026-10-13/data-studio-poster.webp" onPlay={() => setPlaybackMessage("")} onError={() => setFailed(true)} aria-label="Data Studio review film. Fictional sample figures and a seven-sheet Excel review."/>
        {playbackMessage && !failed && <><p role="status">{playbackMessage}</p><button type="button" onClick={watch}>Play Data Studio</button></>}
        <p>Data Studio review · 12 seconds · Sound off</p>
      </div>
      {!film && <>
        <button className="home-studio-teaser" type="button" onClick={watch} aria-label="Watch the 12-second Data Studio review">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/homepage-glass-2026-10-13/data-studio-poster.webp" alt="" width={1920} height={1080} loading="lazy" decoding="async"/>
          <span className="home-studio-teaser-label"><span aria-hidden="true">▶</span><span><strong>Watch the Data Studio review</strong><small>12 seconds · Sound off</small></span></span>
        </button>
        <div className="home-studio-tabs" role="tablist" aria-label="Executive Review sheets">{sheets.map((value, index) => <button ref={element => { tabRefs.current[index] = element; }} key={value} type="button" role="tab" id={`${id}-tab-${index}`} aria-selected={sheet === value} aria-controls={`${id}-sheet`} tabIndex={sheet === value ? 0 : -1} onKeyDown={event => keys(event, index)} onClick={() => select(value)}>{value}</button>)}</div>
        <div className="home-studio-sheet" key={sheet} id={`${id}-sheet`} role="tabpanel" aria-labelledby={`${id}-tab-${sheets.indexOf(sheet)}`} tabIndex={0}><SheetPreview sheet={sheet}/></div>
      </>}
      <footer><span>Seven sheets</span><span>Precomputed values</span><span>Read-only export</span></footer>
    </div>
  </section>;
}
