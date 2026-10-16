const DESTINATIONS: Readonly<Record<string, string>> = Object.freeze({
  "": "/",
  compose: "/compose",
  model: "/workspace#app=model",
  deckly: "/workspace#app=deckly",
  blueprint: "/workspace#app=blueprint",
  calendar: "/workspace#app=calendar",
  studio: "/workspace#app=studio",
  files: "/workspace",
  demo: "/demo",
});

export const dynamic = "force-dynamic";

/** Navigation only. Never proxy sessions, request bodies or customer records. */
export function GET(request: Request) {
  const path = new URL(request.url).pathname.replace(/\/$/, "");
  const key = path === "/datstudio" ? "" : path.slice("/datstudio/".length);
  const destination = Object.hasOwn(DESTINATIONS, key) ? DESTINATIONS[key] : undefined;
  const headers = {
    "Cache-Control": "no-store, max-age=0",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, follow",
  };
  if (!destination) return new Response("Page not found", { status: 404, headers });
  // The fixed origin and allowlist discard any incoming query string or fragment.
  return new Response(null, {
    status: 302,
    headers: { ...headers, Location: "https://vanteloq-workspace.hussien05issa.chatgpt.site" + destination },
  });
}

export const HEAD = GET;
