"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "./supabase-browser";
import { fileProviderName, LINKED_FILE_NOTICE_VERSION, type FileProvider, type LinkedSheetSnapshot } from "../domain/linked-files";
import "./linked-files-panel.css";

type Connection = { id: string; provider: FileProvider };
type Source = { id: string; connectionId: string; provider: FileProvider; name: string; kind: string; sheetName: string; enabled: number; lastCheckedAt: number | null; lastChangedAt: number | null; errorCode: string | null; documentId: string | null };
type State = { providers: { provider: FileProvider; available: boolean }[]; connections: Connection[]; sources: Source[] };
type RemoteFile = { id: string; name: string; mimeType: string };
const stamp = (value: number | null) => value ? new Date(value * 1000).toLocaleString() : "Not checked yet";

export default function LinkedFilesPanel({ onUseCsv, onDocumentsChanged }: { onUseCsv?: (file: File) => void; onDocumentsChanged?: () => Promise<void> }) {
  const [data, setData] = useState<State | null>(null), [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [consent, setConsent] = useState<FileProvider | null>(null), [accepted, setAccepted] = useState(false);
  const [picker, setPicker] = useState<Connection | null>(null), [files, setFiles] = useState<RemoteFile[]>([]), [cursor, setCursor] = useState(""), [limited, setLimited] = useState(false), [folder, setFolder] = useState("");
  const [chosen, setChosen] = useState<{ id: string; name: string; kind: string; tabs: string[] } | null>(null), [tab, setTab] = useState("");
  const [preview, setPreview] = useState<{ source: Source; snapshot: LinkedSheetSnapshot | null } | null>(null), [page, setPage] = useState(0);
  const [confirm, setConfirm] = useState<{ action: "disconnect" | "unlink"; id: string; name: string } | null>(null);
  const alive = useRef(true), running = useRef(false), latest = useRef(data);
  useEffect(() => { latest.current = data; }, [data]);
  const request = useCallback(async (query = "", body?: Record<string, unknown>) => {
    const response = await apiFetch(`/api/v1/linked-files${query}`, { ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60_000) });
    if (response.status === 401 || response.status === 403) {
      if (alive.current) { setData(null); setPreview(null); setFiles([]); setPicker(null); setChosen(null); }
      throw new Error("Linked files are available to the workspace owner with an active plan.");
    }
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || "The file connection could not be completed. Try again.");
    return result;
  }, []);
  const load = useCallback(async () => { const result = await request(); if (alive.current) setData(result); }, [request]);
  useEffect(() => { alive.current = true; void load().catch(() => {}); return () => { alive.current = false; }; }, [load]);
  async function act(work: () => Promise<void>) {
    if (running.current) return;
    running.current = true; setBusy(true); setError(""); setMessage("");
    try { await work(); } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "Please try again."); }
    finally { running.current = false; if (alive.current) setBusy(false); }
  }
  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(async () => {
      if (document.visibilityState !== "visible" || running.current) return;
      const next = (latest.current?.sources || []).filter(s => s.enabled && !s.errorCode).sort((a, b) => (a.lastCheckedAt || 0) - (b.lastCheckedAt || 0)).slice(0, 2);
      if (!next.length) return;
      running.current = true;
      try {
        let documentsUpdated = false;
        for (const source of next) { const result = await request("", { action: "refresh", id: source.id }); documentsUpdated ||= Boolean(result.updated && result.documentId); }
        await load();
        if (documentsUpdated) await onDocumentsChanged?.();
      } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "Automatic refresh paused. Try checking the file again."); }
      finally { running.current = false; }
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [open, load, request, onDocumentsChanged]);
  async function browse(connection: Connection, nextFolder = "", nextCursor = "") {
    const result = await request(`?connection=${encodeURIComponent(connection.id)}&folder=${encodeURIComponent(nextFolder)}&cursor=${encodeURIComponent(nextCursor)}`);
    if (!alive.current) return;
    setPicker(connection); setFiles(result.files); setCursor(result.nextCursor || ""); setLimited(Boolean(result.limited)); setFolder(nextFolder); setChosen(null); setTab("");
  }
  if (!data) return null;
  return <details className="linked-files card" onToggle={e => setOpen(e.currentTarget.open)}>
    <summary><span>Linked Files</span><small>{data.sources.length ? `${data.sources.length} linked` : "Google & Microsoft"}</small></summary>
    <div className="linked-files-body">
      <header><h3>Your Files, in One Place</h3><p>Link a sheet or document you already use. Review the latest version here without making it public.</p></header>
      <div className="linked-provider-grid">{data.providers.map(provider => <section key={provider.provider}><b>{fileProviderName(provider.provider)}</b><p>{provider.provider === "google-files" ? "Sheet tables, Docs, Slides and PDFs." : "Excel, PowerPoint, Word and PDFs as readable document copies."}</p><button type="button" disabled={!provider.available || busy} onClick={() => { setConsent(provider.provider); setAccepted(false); }}>{provider.available ? "Connect Account" : "Coming Soon"}</button></section>)}</div>
      {consent && <section className="linked-consent" aria-label="File connection privacy notice"><h4>Connect {fileProviderName(consent)}</h4><p>{consent === "google-files" ? "Google grants read access to your Drive files. Vanteloq lists supported files so you can choose what to link; it imports only the files you select." : "Microsoft grants read access to files in your OneDrive and continued access until you disconnect. Vanteloq imports only the files you select."} These provider permissions can cover files you do not select. Vanteloq imports only your chosen files and cannot edit your originals.</p><p>Selected sheets are stored as encrypted table snapshots. Documents are stored privately and must pass the existing security scan before reading. Nothing posts to your books automatically.</p><p>Enabled files are checked while this panel is open and the page is visible, or when you choose Check Now. Disconnecting removes local access and linked table snapshots. Previously imported documents and accounting records remain until deleted separately under the <a href="/privacy#retention" target="_blank" rel="noopener noreferrer">retention policy</a>. You can also revoke the app in your Google or Microsoft account.</p><label><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)}/><span>I authorise this file connection under <a href="/privacy#linked-files" target="_blank" rel="noreferrer">Vanteloq’s Privacy Policy</a> and acknowledge <a href={consent === "google-files" ? "https://policies.google.com/privacy" : "https://privacy.microsoft.com/privacystatement"} target="_blank" rel="noreferrer">{consent === "google-files" ? "Google’s" : "Microsoft’s"} Privacy Policy</a>.</span></label><div className="linked-actions"><button disabled={busy} onClick={() => setConsent(null)}>Cancel</button><button disabled={!accepted || busy} onClick={() => void act(async () => { const result = await request("", { action: "authorize", provider: consent, accepted, noticeVersion: LINKED_FILE_NOTICE_VERSION }); window.location.assign(result.authorizationUrl); })}>Agree & Continue</button></div></section>}
      {data.connections.map(connection => <div className="linked-account" key={connection.id}><span><b>{fileProviderName(connection.provider)}</b><small>Connected account</small></span><div className="linked-actions"><button disabled={busy} onClick={() => void act(() => browse(connection))}>Choose File</button><button disabled={busy} onClick={() => setConfirm({ action: "disconnect", id: connection.id, name: fileProviderName(connection.provider) })}>Disconnect</button></div></div>)}
      {picker && <section className="linked-picker" aria-label="Choose a file"><header><h4>Choose From {fileProviderName(picker.provider)}</h4><button onClick={() => { setPicker(null); setChosen(null); }} aria-label="Close file picker">Close</button></header><p>Your originals stay in your connected account. Only selected files are copied to Vanteloq.</p>{folder && <button disabled={busy} onClick={() => void act(() => browse(picker))}>Back to OneDrive</button>}<div className="linked-picker-list">{files.map(file => <button key={file.id} disabled={busy} onClick={() => void act(async () => { if (file.mimeType === "folder") return browse(picker, file.id); const meta = await request(`?connection=${encodeURIComponent(picker.id)}&remote=${encodeURIComponent(file.id)}`); if (alive.current) { setChosen(meta); setTab(meta.tabs?.[0] || ""); } })}><span>{file.name}</span><small>{file.mimeType === "folder" ? "Open Folder" : "Select"}</small></button>)}{!files.length && <p>No supported files in this location.</p>}</div>{cursor && <button disabled={busy} onClick={() => void act(() => browse(picker, folder, cursor))}>Next Files</button>}{limited && <p>This folder contains more than 100 items. Move the desired file into a smaller folder to find it here.</p>}{chosen && <div className="linked-selection"><b>{chosen.name}</b>{chosen.kind === "sheet" && <label>Sheet Tab<select value={tab} onChange={e => setTab(e.target.value)}>{chosen.tabs.map(name => <option key={name}>{name}</option>)}</select></label>}<p>{chosen.kind === "sheet" ? "Use a header row followed by up to 1,000 rows and 52 columns. The table preview keeps the underlying values." : "Each changed version is imported as a PDF for security scanning and your review."}</p><button disabled={busy || (chosen.kind === "sheet" && !tab)} onClick={() => void act(async () => { await request("", { action: "attach", connectionId: picker.id, remoteId: chosen.id, sheetName: tab }); setPicker(null); setChosen(null); await load(); setMessage("File linked. Select Check Now to read its latest version."); })}>Link This File</button></div>}</section>}
      {data.sources.length > 0 && <div className="linked-source-list">{data.sources.map(source => <article key={source.id}><div><h4>{source.name}</h4><p>{source.sheetName || "Document copy"} · {source.enabled ? "Refresh enabled" : "Paused"}</p><small>Last checked: {stamp(source.lastCheckedAt)}</small><small>Latest change: {source.lastChangedAt ? stamp(source.lastChangedAt) : "Awaiting first read"}</small>{source.errorCode && <p className="linked-warning">This file needs attention. Your last valid copy is preserved. Check Now for details.</p>}</div><div className="linked-actions"><button disabled={busy || !source.enabled} onClick={() => void act(async () => { const result = await request("", { action: "refresh", id: source.id }); await load(); if (result.documentId) await onDocumentsChanged?.(); setMessage(result.updated ? "New version ready for review." : result.coalesced ? "This file was checked recently. Try again shortly." : "Your copy is up to date."); })}>Check Now</button><button disabled={busy} onClick={() => void act(async () => { const result = await request(`?id=${encodeURIComponent(source.id)}`); setPreview({ source, snapshot: result.snapshot }); setPage(0); })}>Review</button><button disabled={busy} onClick={() => void act(async () => { await request("", { action: source.enabled ? "pause" : "resume", id: source.id }); await load(); })}>{source.enabled ? "Pause" : "Resume"}</button><button disabled={busy} onClick={() => setConfirm({ action: "unlink", id: source.id, name: source.name })}>Unlink</button></div></article>)}</div>}
      {preview && <section className="linked-preview" aria-label="Linked file review"><header><h4>{preview.source.name}</h4><button onClick={() => setPreview(null)}>Close Preview</button></header>{preview.snapshot ? <><p>{preview.snapshot.rows.length} source rows · {preview.snapshot.headers.length} columns · Snapshot, not posted accounting data</p><div className="linked-table" tabIndex={0} role="region" aria-label="Source table"><table><thead><tr>{preview.snapshot.headers.map((name, index) => <th key={index}>{name}</th>)}</tr></thead><tbody>{preview.snapshot.rows.slice(page * 50, page * 50 + 50).map((row, index) => <tr key={index}>{row.map((cell, column) => <td key={column}>{cell}</td>)}</tr>)}</tbody></table></div><div className="linked-actions"><button disabled={page === 0} onClick={() => setPage(page - 1)}>Previous Rows</button><span>Page {page + 1} of {Math.max(1, Math.ceil(preview.snapshot.rows.length / 50))}</span><button disabled={(page + 1) * 50 >= preview.snapshot.rows.length} onClick={() => setPage(page + 1)}>Next Rows</button>{onUseCsv && <button disabled={busy} onClick={() => void act(async () => { const result = await request(`?id=${encodeURIComponent(preview.source.id)}&format=csv`); onUseCsv(new File([result.csv], `${result.name}.csv`, { type: "text/csv" })); setMessage("Table selected below. Use the daily import template, review the validation, then choose Import. No figures have been posted."); })}>Use in Daily Import</button>}</div><p>Only a table matching the daily import template can update daily sales totals. Other tables remain reference information.</p></> : <p>{preview.source.documentId ? "The latest document is in Documents. Select Scan and Read there after reviewing the processing notice." : "Select Check Now to read the first version. The resulting document appears in Documents for review."}</p>}</section>}
      {confirm && <section className="linked-confirm" aria-label="Confirm file disconnection"><p>{confirm.action === "disconnect" ? "Disconnect" : "Unlink"} <strong>{confirm.name}</strong>? Linked table snapshots will be removed. Previously imported documents and accounting records remain until you delete them separately.</p><div className="linked-actions"><button onClick={() => setConfirm(null)} disabled={busy}>Keep Connection</button><button disabled={busy} onClick={() => void act(async () => { await request("", { action: confirm.action, ...(confirm.action === "disconnect" ? { connectionId: confirm.id } : { id: confirm.id }) }); setConfirm(null); setPreview(null); setPicker(null); setChosen(null); await load(); setMessage("Connection removed. Existing imported documents are unchanged."); })}>Confirm {confirm.action === "disconnect" ? "Disconnect" : "Unlink"}</button></div></section>}
      <p className="linked-footnote">While this panel is open and visible, Vanteloq checks up to 2 enabled files each minute. More files take longer to cycle through. Close the panel or pause a file to stop automatic checks. Files with errors wait for your review.</p>
      {busy && <p role="status">Working on your file connection…</p>}{error && <p className="linked-warning" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    </div>
  </details>;
}
