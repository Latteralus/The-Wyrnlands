import type { BrowserWindowConstructorOptions } from 'electron';

// Kept free of runtime Electron imports so the security-relevant window
// configuration can be unit-tested in plain Node (windowOptions.test.ts).

// The renderer is served from a privileged custom scheme rather than file://
// (Electron security checklist: file:// pages get broad local-file access and
// a null origin). Everything the renderer loads in production comes from
// app://wyrnlands/ — see main.ts's protocol handler.
export const APP_SCHEME = 'app';
export const APP_HOST = 'wyrnlands';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

export function createMainWindowOptions(preloadPath: string): BrowserWindowConstructorOptions {
  return {
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'The Wyrnlands',
    backgroundColor: '#1f1a14',
    show: false,
    webPreferences: {
      preload: preloadPath,
      // The renderer is a plain web page: no Node, no Electron internals.
      // Everything it may do goes through the narrow bridge preload.ts
      // exposes with contextBridge.
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webviewTag: false,
      spellcheck: false,
    },
  };
}

// Whether a URL may be shown in the game window: the packaged renderer's own
// origin, or (unpackaged development only) the Vite dev server.
export function isAllowedRendererUrl(url: string, devServerUrl: string | null): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === `${APP_SCHEME}:` && parsed.host === APP_HOST) return true;
  if (devServerUrl) return parsed.origin === new URL(devServerUrl).origin;
  return false;
}
