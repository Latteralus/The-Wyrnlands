import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  net,
  protocol,
  session,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
} from 'electron';
import { contentTypeFor, rendererContentSecurityPolicy } from './contentSecurity';
import { SimulationProcess } from './simulationProcess';
import {
  APP_HOST,
  APP_ORIGIN,
  APP_SCHEME,
  createMainWindowOptions,
  isAllowedRendererUrl,
} from './windowOptions';
import type { ExportSaveResult, ImportSaveResult, StorageBackend } from '../shared/protocol';

// The Electron main process: window lifecycle, the app:// protocol that
// serves the built renderer, the security policy around both, the native
// file dialogs, and the simulation process's lifecycle. It never runs
// simulation code: the world lives in the simulation (utility) process, and
// the renderer talks to it directly over a MessagePort this process brokers.

// Only an unpackaged build may load the Vite dev server (npm run dev).
const devServerUrl = !app.isPackaged ? (process.env.WYRNLANDS_DEV_SERVER_URL ?? null) : null;

// Bundled to dist-electron/main.cjs; the renderer build lives in dist/.
const rendererRoot = path.join(__dirname, '..', 'dist');
const preloadPath = path.join(__dirname, 'preload.cjs');
const simulationEntry = path.join(__dirname, 'simHost.cjs');

// The simulation runs on native, file-backed SQLite. --sim-backend=sqljs
// runs it on the in-memory sql.js database instead (the pre-desktop
// backend), for comparison and as a fallback.
const backend: StorageBackend =
  app.commandLine.getSwitchValue('sim-backend') === 'sqljs' ? 'sqljs' : 'native';

// Chromium's --user-data-dir switch moves the browser profile; make the app's
// own userData path (and so the save library) follow it, so a run started
// with a scratch profile — the smoke tests — never sees real saves.
const userDataOverride = app.commandLine.getSwitchValue('user-data-dir');
if (userDataOverride) app.setPath('userData', path.resolve(userDataOverride));

protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// One running copy: two instances writing the same save library would race.
if (!app.requestSingleInstanceLock()) app.quit();

let mainWindow: BrowserWindow | null = null;
const simulation = new SimulationProcess();

function registerAppProtocol(): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== APP_HOST) return new Response('Not found', { status: 404 });
    const relative = decodeURIComponent(url.pathname);
    const file = path.normalize(path.join(rendererRoot, relative === '/' ? 'index.html' : relative));
    // Never serve anything outside the renderer build (path traversal).
    if (!file.startsWith(rendererRoot + path.sep)) return new Response('Forbidden', { status: 403 });
    const response = await net.fetch(pathToFileURL(file).toString());
    if (!response.ok) return new Response('Not found', { status: 404 });
    return new Response(response.body, {
      status: 200,
      headers: {
        'Content-Type': contentTypeFor(file),
        'Content-Security-Policy': rendererContentSecurityPolicy(),
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });
}

function applySessionSecurity(): void {
  // The game asks for no browser permissions (camera, notifications,
  // geolocation, …); refuse every request rather than prompting.
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
}

app.on('web-contents-created', (_event, contents) => {
  // The game window only ever shows the game.
  contents.on('will-navigate', (event, url) => {
    if (!isAllowedRendererUrl(url, devServerUrl)) event.preventDefault();
  });
  contents.on('will-redirect', (event, url) => {
    if (!isAllowedRendererUrl(url, devServerUrl)) event.preventDefault();
  });
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-attach-webview', (event) => event.preventDefault());
});

function buildMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    { label: 'Game', submenu: [{ role: 'quit' }] },
    {
      label: 'View',
      submenu: [
        ...(app.isPackaged
          ? []
          : ([{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }] as const)),
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createMainWindow(): Promise<void> {
  const window = new BrowserWindow(createMainWindowOptions(preloadPath));
  mainWindow = window;
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });
  // A crashed renderer takes nothing with it: the world lives in the
  // simulation process. Reload, and the page reconnects to it.
  window.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason !== 'clean-exit' && !window.isDestroyed()) window.webContents.reload();
  });
  await window.loadURL(devServerUrl ?? `${APP_ORIGIN}/index.html`);
}

// IPC is accepted only from the game's own page, in its own window.
function isTrustedSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame;
  return (
    frame !== null &&
    frame === event.sender.mainFrame &&
    mainWindow !== null &&
    event.sender === mainWindow.webContents &&
    isAllowedRendererUrl(frame.url, devServerUrl)
  );
}

function startSimulation(): void {
  const userData = app.getPath('userData');
  simulation.start(simulationEntry, {
    savesDir: path.join(userData, 'saves'),
    logFile: path.join(userData, 'logs', 'simulation.log'),
    backend,
  });
}

// The simulation process should never die; if it does, start a new one and
// reload the window. The player is back at the title screen, and Continue
// resumes from the last save.
simulation.onUnexpectedExit = (code) => {
  console.error(`[main] simulation process exited unexpectedly (${code}); restarting`);
  startSimulation();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.reload();
    void dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'The Wyrnlands',
      message: 'The simulation stopped unexpectedly and has been restarted.',
      detail: 'Use Continue to resume from your last save.',
    });
  }
};

function registerIpc(): void {
  // The preload asks for its MessagePort to the simulation on every page load.
  ipcMain.on('wyrnlands:connect', (event) => {
    if (!isTrustedSender(event)) return;
    simulation.connect(event.sender).catch((error: unknown) => {
      console.error('[main] could not connect the renderer to the simulation:', error);
    });
  });

  ipcMain.handle('wyrnlands:export-save', async (event): Promise<ExportSaveResult> => {
    if (!isTrustedSender(event) || !mainWindow) return { status: 'failed', message: 'Not allowed.' };
    try {
      const suggested = await simulation.control('suggestedExportName');
      const choice = await dialog.showSaveDialog(mainWindow, {
        title: 'Export save',
        defaultPath: path.join(app.getPath('documents'), suggested),
        filters: [{ name: 'Wyrnlands save', extensions: ['sqlite'] }],
      });
      if (choice.canceled || !choice.filePath) return { status: 'cancelled' };
      await simulation.control('exportTo', choice.filePath);
      return { status: 'saved', fileName: path.basename(choice.filePath) };
    } catch (error) {
      return {
        status: 'failed',
        message: error instanceof Error ? error.message : 'The save could not be exported.',
      };
    }
  });

  ipcMain.handle('wyrnlands:import-save', async (event): Promise<ImportSaveResult> => {
    if (!isTrustedSender(event) || !mainWindow) return { status: 'failed', message: 'Not allowed.' };
    try {
      const choice = await dialog.showOpenDialog(mainWindow, {
        title: 'Import save',
        properties: ['openFile'],
        filters: [{ name: 'Wyrnlands save', extensions: ['sqlite'] }],
      });
      const file = choice.filePaths[0];
      if (choice.canceled || !file) return { status: 'cancelled' };
      return { status: 'imported', save: await simulation.control('importFrom', file) };
    } catch (error) {
      return {
        status: 'failed',
        message: error instanceof Error ? error.message : 'The save could not be imported.',
      };
    }
  });
}

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.on('window-all-closed', () => app.quit());

// Shutdown safety (MigrationPlan.md Phase 23): before the app exits, the
// simulation stops its clock, saves and closes its database; only then does
// the app quit.
let shutdown: 'running' | 'stopping' | 'done' = 'running';
app.on('before-quit', (event) => {
  if (shutdown === 'done') return;
  event.preventDefault();
  if (shutdown === 'stopping') return;
  shutdown = 'stopping';
  simulation
    .stop()
    .catch((error: unknown) => console.error('[main] simulation did not shut down cleanly:', error))
    .finally(() => {
      shutdown = 'done';
      app.quit();
    });
});

void app.whenReady().then(async () => {
  registerAppProtocol();
  applySessionSecurity();
  buildMenu();
  registerIpc();
  startSimulation();
  await createMainWindow();
});
