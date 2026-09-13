/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  POS_SYNC_SECRET?: string;
  ASSETS: Fetcher;
  DB: D1Database;
  BUCKET: R2Bucket;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
  LIGHTSPEED_CLIENT_ID?: string;
  LIGHTSPEED_CLIENT_SECRET?: string;
  LIGHTSPEED_REDIRECT_URI?: string;
  LIGHTSPEED_API_VERSION?: string;
  LIGHTSPEED_X_CLIENT_ID?: string;
  LIGHTSPEED_X_CLIENT_SECRET?: string;
  LIGHTSPEED_X_REDIRECT_URI?: string;
  LIGHTSPEED_X_API_VERSION?: string;
  LIGHTSPEED_X_TOKEN_ENCRYPTION_KEY?: string;
  LIGHTSPEED_R_CLIENT_ID?: string;
  LIGHTSPEED_R_CLIENT_SECRET?: string;
  LIGHTSPEED_R_REDIRECT_URI?: string;
  CLOVER_CLIENT_ID?: string;
  CLOVER_CLIENT_SECRET?: string;
  CLOVER_REDIRECT_URI?: string;
  CLOVER_ENV?: string;
  CLOVER_WEBHOOK_AUTH?: string;
  STRIPE_CLIENT_ID?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_REDIRECT_URI?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_BILLING_WEBHOOK_SECRET?: string;
  STRIPE_API_VERSION?: string;
  PLAID_CLIENT_ID?: string;
  PLAID_SECRET?: string;
  PLAID_ENV?: string;
  PLAID_WEBHOOK_URL?: string;
  PLAID_REDIRECT_URI?: string;
  GOOGLE_MARKETING_CLIENT_ID?: string;
  GOOGLE_MARKETING_CLIENT_SECRET?: string;
  GOOGLE_MARKETING_REDIRECT_URI?: string;
  META_MARKETING_APP_ID?: string;
  META_MARKETING_APP_SECRET?: string;
  META_MARKETING_REDIRECT_URI?: string;
  META_GRAPH_API_VERSION?: string;
  INTEGRATION_ENCRYPTION_KEY?: string;
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_AUTH_MODE?: string;
  SUPABASE_SCHEMA?: string;
  SUPABASE_BACKEND_MODE?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_EXPECTED_ACTION?: string;
  TURNSTILE_ALLOWED_HOSTNAMES?: string;
  SUPABASE_CAPTCHA_ENABLED?: string;
  BOOKLOQ_DEMO_ENABLED?: string;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const NOT_FOUND_TITLE = "Page not found | Vanteloq";
const NOT_FOUND_DESCRIPTION = "The requested Vanteloq page could not be found.";

function rewriteNotFoundMetadata(html: string) {
  return html
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${NOT_FOUND_TITLE}</title>`)
    .replace(/<meta property="og:title" content="[^"]*"\/>/i, `<meta property="og:title" content="${NOT_FOUND_TITLE}"/>`)
    .replace(/<meta name="twitter:title" content="[^"]*"\/>/i, `<meta name="twitter:title" content="${NOT_FOUND_TITLE}"/>`)
    .replace(/<meta name="description" content="[^"]*"\/>/i, `<meta name="description" content="${NOT_FOUND_DESCRIPTION}"/>`)
    .replace(/<meta property="og:description" content="[^"]*"\/>/i, `<meta property="og:description" content="${NOT_FOUND_DESCRIPTION}"/>`)
    .replace(/<meta name="twitter:description" content="[^"]*"\/>/i, `<meta name="twitter:description" content="${NOT_FOUND_DESCRIPTION}"/>`)
    .replace(/<meta property="og:url" content="[^"]*"\/>/i, "")
    .replace(/<link rel="canonical" href="[^"]*"\/>/i, "")
    // The runtime and page metadata can both emit robots directives for a 404.
    // Normalize the server HTML to one directive before it reaches crawlers.
    .replace(/<meta\b[^>]*\bname=["']robots["'][^>]*\/?>/gi, "")
    .replace(/<\/head>/i, '<meta name="robots" content="noindex, follow"/></head>');
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    (globalThis as typeof globalThis & { __vanteloqEnv?: Env }).__vanteloqEnv = env;
    const url = new URL(request.url);

    if (url.hostname === "vanteloq.hussien05issa.chatgpt.site") {
      const destination = new URL("https://vanteloq.com");
      destination.pathname = url.pathname;
      destination.search = url.search;
      return Response.redirect(destination, 308);
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    const response = await handler.fetch(request, env, ctx);
    const headers = new Headers(response.headers);
    headers.delete("Server");
    headers.delete("X-Powered-By");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
    headers.set("X-Frame-Options", "DENY");
    headers.set("X-DNS-Prefetch-Control", "off");
    headers.set(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://cdn.plaid.com https://www.googletagmanager.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://www.google-analytics.com https://region1.google-analytics.com; font-src 'self'; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://challenges.cloudflare.com https://api.pwnedpasswords.com https://*.plaid.com https://www.google-analytics.com https://region1.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com; object-src 'none'; frame-src https://challenges.cloudflare.com https://*.plaid.com https://cdn.plaid.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; worker-src 'self'; manifest-src 'self'; upgrade-insecure-requests",
    );
    headers.delete("Content-Security-Policy-Report-Only");
    if (url.protocol === "https:") headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    if (url.pathname.startsWith("/api/")) {
      headers.set("Cache-Control", "no-store, max-age=0");
      headers.set("Cross-Origin-Resource-Policy", "same-origin");
    }

    const isNotFoundHtml = response.status === 404 && headers.get("Content-Type")?.includes("text/html");
    if (isNotFoundHtml) {
      const html = rewriteNotFoundMetadata(await response.text());
      headers.delete("Content-Length");
      headers.set("X-Robots-Tag", "noindex, follow");
      return new Response(html, { status: response.status, statusText: response.statusText, headers });
    }

    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
};

export default worker;
