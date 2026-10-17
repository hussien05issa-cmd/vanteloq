import { access } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

// plugin-rsc 0.5.34 collects dependencies before Vite 8 removes CSS-only
// JavaScript placeholders. Collect after that cleanup, from the final bundle.
export function orderRscAssetManifest(plugins) {
  const plugin = plugins.find(item => item.name === "rsc:virtual:vite-rsc/assets-manifest");
  const hook = plugin?.generateBundle;
  if (!plugin || !hook) throw new Error("RSC assets-manifest build hook changed; review asset ordering.");
  plugin.generateBundle = typeof hook === "function"
    ? { order: "post", handler: hook }
    : { ...hook, order: "post" };
}

export async function assertRscAssetFiles(manifest, clientDirectory) {
  const groups = [manifest.clientEntryDeps, ...Object.values(manifest.clientReferenceDeps ?? {}), ...Object.values(manifest.serverResources ?? {})];
  const urls = new Set([manifest.clientEntryUrl, ...groups.flatMap(group => [...(group?.js ?? []), ...(group?.css ?? [])])].filter(Boolean));
  for (const url of urls) {
    if (!url.startsWith("/") || url.startsWith("//")) throw new Error(`Unexpected RSC asset URL: ${url}`);
    const file = resolve(clientDirectory, `.${url.split(/[?#]/)[0]}`);
    const path = relative(clientDirectory, file);
    if (path.startsWith("..") || isAbsolute(path)) throw new Error(`RSC asset escapes client directory: ${url}`);
    try { await access(file); } catch { throw new Error(`RSC manifest references missing client asset: ${url}`); }
  }
  return urls.size;
}
