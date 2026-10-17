import WorkspaceIcon from "./workspace-icon";

/** Open the first-party access page without sharing account context or leaving unsaved work. */
export default function WorkspaceLauncher() {
  return <a
    className="workspace-suite-launcher"
    href="/datstudio"
    target="_blank"
    rel="noopener noreferrer"
    referrerPolicy="no-referrer"
    aria-label="Open Vanteloq Data Studio in a new tab"
    title="Data Studio opens separately with its own sign-in and saved files."
  >
    <WorkspaceIcon name="Dashboard"/>
    <span>Data Studio<small>Open</small></span>
  </a>;
}
