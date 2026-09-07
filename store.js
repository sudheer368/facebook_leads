const fs = require("fs");
const path = require("path");

const DB_FILE = path.join(__dirname, "leads.json");

function readAll() {
  if (!fs.existsSync(DB_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {
    return [];
  }
}

function writeAll(leads) {
  fs.writeFileSync(DB_FILE, JSON.stringify(leads, null, 2));
}

function addLead(lead) {
  const leads = readAll();
  if (leads.some((l) => l.id === lead.id)) return; // avoid duplicates on webhook retries
  leads.unshift(lead);
  writeAll(leads);
}

function getLeads() {
  return readAll().sort((a, b) => b.receivedAt - a.receivedAt);
}

function updateLead(id, patch) {
  const leads = readAll();
  const idx = leads.findIndex((l) => l.id === id);
  if (idx === -1) return null;
  leads[idx] = { ...leads[idx], ...patch };
  writeAll(leads);
  return leads[idx];
}

module.exports = { addLead, getLeads, updateLead };
