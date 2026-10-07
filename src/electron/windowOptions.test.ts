import { describe, expect, it } from 'vitest';
import { rendererContentSecurityPolicy } from './contentSecurity';
import { APP_ORIGIN, createMainWindowOptions, isAllowedRendererUrl } from './windowOptions';

describe('Electron security configuration', () => {
  it('runs the renderer sandboxed, isolated, without Node', () => {
    const prefs = createMainWindowOptions('/app/preload.cjs').webPreferences;
    expect(prefs).toMatchObject({
      preload: '/app/preload.cjs',
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    });
  });

  it('lets the window show only the game itself', () => {
    expect(isAllowedRendererUrl(`${APP_ORIGIN}/index.html`, null)).toBe(true);
    expect(isAllowedRendererUrl('https://example.com/', null)).toBe(false);
    expect(isAllowedRendererUrl('file:///C:/Windows/', null)).toBe(false);
    expect(isAllowedRendererUrl('app://elsewhere/index.html', null)).toBe(false);
    expect(isAllowedRendererUrl('not a url', null)).toBe(false);
    // The dev server only when one is configured (never in a packaged app).
    expect(isAllowedRendererUrl('http://127.0.0.1:5173/', null)).toBe(false);
    expect(isAllowedRendererUrl('http://127.0.0.1:5173/src/x', 'http://127.0.0.1:5173/')).toBe(true);
  });

  it('allows only same-origin scripts — no eval, no WebAssembly, no remote code', () => {
    const csp = rendererContentSecurityPolicy();
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/unsafe-eval|wasm-unsafe-eval|https?:/);
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(rendererContentSecurityPolicy({ meta: true })).not.toContain('frame-ancestors');
  });
});
