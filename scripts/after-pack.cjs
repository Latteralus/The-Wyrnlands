// electron-builder afterPack hook: the packaged app copies Electron's own
// distribution (electronDist), which includes Electron's sample "default
// app". The game never loads it (the onlyLoadAppFromAsar fuse forces
// app.asar), so it isn't shipped.
const { rmSync } = require('node:fs');
const path = require('node:path');

exports.default = async function afterPack(context) {
  rmSync(path.join(context.appOutDir, 'resources', 'default_app.asar'), { force: true });
};
