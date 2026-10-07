// The environment to launch Electron with. Tools built on Electron (VS Code's
// extension host, for one) export ELECTRON_RUN_AS_NODE=1 to their children;
// inherited, it makes Electron start as plain Node and the game never opens.
export function electronEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}
