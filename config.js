const fs = require("fs");
const path = require("path");

const CONFIG_FILE = path.join(__dirname, "config.json");

function readConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return { pages: [] };
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return { pages: [] };
  }
}

function writeConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

function saveConnectedPage(page) {
  const cfg = readConfig();
  const existing = cfg.pages.findIndex((p) => p.id === page.id);
  if (existing >= 0) cfg.pages[existing] = page;
  else cfg.pages.push(page);
  writeConfig(cfg);
}

function getConnectedPages() {
  return readConfig().pages;
}

// Look up a page's access token by page_id — used when a webhook event comes in
function getPageToken(pageId) {
  const page = readConfig().pages.find((p) => p.id === pageId);
  return page ? page.access_token : null;
}

module.exports = { saveConnectedPage, getConnectedPages, getPageToken };
