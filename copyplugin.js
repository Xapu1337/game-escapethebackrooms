const fs = require('fs').promises;
const path = require('path');

const VORTEX_PLUGINS = path.join(process.env.APPDATA, 'Vortex', 'Plugins');

async function removeOldPlugins(name) {
  const entries = await fs.readdir(VORTEX_PLUGINS);
  for (const entry of entries.filter(e => e.startsWith(name))) {
    await fs.rm(path.join(VORTEX_PLUGINS, entry), { recursive: true, force: true });
  }
}

async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  for (const entry of await fs.readdir(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(s, d);
    } else {
      await fs.copyFile(s, d);
    }
  }
}

async function start() {
  const data = JSON.parse(await fs.readFile(path.join(__dirname, 'package.json'), 'utf8'));
  const destination = path.join(VORTEX_PLUGINS, `${data.name}-${data.version}`);
  try {
    await removeOldPlugins(data.name);
  } catch (err) {
    console.error('Failed to remove old plugins:', err);
  }
  await copyDir(path.join(__dirname, 'dist'), destination);
  console.log(`Copied to ${destination}`);
}

start().catch(console.error);
