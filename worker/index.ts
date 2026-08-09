/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
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

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    (globalThis as typeof globalThis & { __vanteloqEnv?: Env }).__vanteloqEnv = env;
    const url = new URL(request.url);

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
      "default-src 'self'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://challenges.cloudflare.com; object-src 'none'; frame-src https://challenges.cloudflare.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; worker-src 'self'; manifest-src 'self'; upgrade-insecure-requests",
    );
    headers.delete("Content-Security-Policy-Report-Only");
    if (url.protocol === "https:") headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    if (url.pathname.startsWith("/api/")) {
      headers.set("Cache-Control", "no-store, max-age=0");
      headers.set("Cross-Origin-Resource-Policy", "same-origin");
    }
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
};

export default worker;
