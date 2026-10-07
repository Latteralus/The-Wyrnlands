// The production renderer's Content-Security-Policy, sent as a response
// header by main.ts's app:// protocol handler (and mirrored into the built
// index.html as a meta tag by vite.config.ts). Everything is same-origin:
// the game is offline, ships no remote code, and loads no webfonts.
//
// 'unsafe-inline' for styles only: React's style={{…}} props (progress bars,
// chart geometry) are inline style attributes. Scripts stay 'self'-only.
// `meta`: the <meta http-equiv> copy, which must omit frame-ancestors
// (browsers only honour that directive in a response header).
export function rendererContentSecurityPolicy(options: { meta?: boolean } = {}): string {
  const directives = [
    "default-src 'self'",
    // No 'wasm-unsafe-eval': the renderer runs no WebAssembly — the SQLite
    // database lives in the simulation process.
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ];
  if (!options.meta) directives.push("frame-ancestors 'none'");
  return directives.join('; ');
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
};

export function contentTypeFor(filePath: string): string {
  const dot = filePath.lastIndexOf('.');
  return (dot >= 0 && CONTENT_TYPES[filePath.slice(dot).toLowerCase()]) || 'application/octet-stream';
}
