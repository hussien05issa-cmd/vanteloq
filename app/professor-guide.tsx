"use client";
import "./professor-guide.css";

/** Optional education uses the same consent and message flow as the conversation. */
export default function ProfessorGuide({compact=false,onExplain,summary}:{compact?:boolean;onExplain?:()=>void;summary?:string}) {
  return <details className={`professor-guide${compact?" is-compact":""}`}>
    <summary><span className="professor-guide-portrait">
      {/* A small local, pre-compressed asset keeps the guide independent of remote image services. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/professor-vantatalk-guide.webp" alt="" width={52} height={58} loading="lazy" decoding="async"/>
    </span><span><strong>VantaTalk™ guide</strong><small>{compact?"Make the numbers easier to understand":"A practical way to read this guide"}</small></span></summary>
    <div><p>{summary??"Start with what changed. Check the records and the comparison period, then separate known facts from possible causes. Choose one next step you can review and measure."}</p>
      {onExplain&&<button type="button" onClick={onExplain}>Prepare a plain-language question</button>}
      <small>{onExplain?"A draft question opens in your composer. Your existing data-use controls still apply; nothing is sent automatically.":"An educational character, not professional accounting or legal advice."}</small>
    </div>
  </details>;
}
