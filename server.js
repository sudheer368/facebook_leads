require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const axios = require("axios");
const cors = require("cors");
const store = require("./store");
const config = require("./config");
const authRouter = require("./auth");

const app = express();
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const APP_SECRET = process.env.APP_SECRET;
const GRAPH_VERSION = "v19.0";

app.use(cors());
app.use(authRouter);

// ---------- 0. Landing page with the one-click connect button ----------
app.get("/", (req, res) => {
  const pages = config.getConnectedPages();
  const connectedList = pages.length
    ? `<ul>${pages.map((p) => `<li>${p.name} — connected</li>`).join("")}</ul>`
    : `<p>No Pages connected yet.</p>`;
  res.send(`
    <div style="font-family: sans-serif; max-width: 480px; margin: 60px auto; text-align: center;">
      <h2>Meta Leads Server</h2>
      ${connectedList}
      <a href="/auth/facebook" style="display:inline-block; background:#1877F2; color:#fff; padding:12px 22px; border-radius:8px; text-decoration:none; font-weight:600; margin-bottom:20px;">Connect with Facebook</a>
      <p><a href="/leads">View leads</a></p>
    </div>`);
});

// ---------- Plain page listing every lead received so far ----------
app.get("/leads", (req, res) => {
  const leads = store.getLeads();
  const rows = leads
    .map(
      (l) => `
      <tr>
        <td>${l.name}</td>
        <td>${l.phone}</td>
        <td>${l.email || ""}</td>
        <td>${l.campaign}</td>
        <td>${l.stage}</td>
        <td>${new Date(l.receivedAt).toLocaleString()}</td>
      </tr>`
    )
    .join("");
  res.send(`
    <div style="font-family: sans-serif; max-width: 900px; margin: 40px auto;">
      <p><a href="/">&larr; Back</a></p>
      <h2>Leads (${leads.length})</h2>
      <table border="1" cellpadding="8" cellspacing="0" style="border-collapse: collapse; width: 100%;">
        <tr style="background:#f0f0f0;"><th>Name</th><th>Phone</th><th>Email</th><th>Campaign</th><th>Stage</th><th>Received</th></tr>
        ${rows || "<tr><td colspan='6' style='text-align:center;color:#888;'>No leads yet.</td></tr>"}
      </table>
    </div>`);
});

// ---------- 1. Webhook verification (Meta calls this once, when you save the webhook URL) ----------
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verified by Meta.");
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ---------- 2. Actual lead events (Meta POSTs here every time someone submits your lead form) ----------
app.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  res.sendStatus(200); // respond fast, Meta retries aggressively otherwise

  const signature = req.headers["x-hub-signature-256"];
  if (!isValidSignature(req.body, signature)) {
    console.warn("Invalid webhook signature — ignoring payload.");
    return;
  }

  let payload;
  try {
    payload = JSON.parse(req.body.toString("utf8"));
  } catch (e) {
    console.error("Could not parse webhook payload:", e.message);
    return;
  }

  const entries = payload.entry || [];
  for (const entry of entries) {
    const changes = entry.changes || [];
    for (const change of changes) {
      if (change.field !== "leadgen") continue;
      const { leadgen_id, form_id, page_id, ad_id, created_time } = change.value || {};
      if (!leadgen_id) continue;
      try {
        await handleNewLead({ leadgen_id, form_id, page_id, ad_id, created_time });
      } catch (err) {
        console.error("Failed to process lead", leadgen_id, err.response?.data || err.message);
      }
    }
  }
});

function isValidSignature(rawBody, signatureHeader) {
  if (!signatureHeader || !APP_SECRET) return false;
  const expected =
    "sha256=" + crypto.createHmac("sha256", APP_SECRET).update(rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  } catch {
    return false;
  }
}

async function handleNewLead({ leadgen_id, form_id, page_id, ad_id, created_time }) {
  const { getAppSecretProof } = require("./utils");
  const pageAccessToken = config.getPageToken(page_id);
  if (!pageAccessToken) {
    console.warn(`Got a lead for Page ${page_id}, but that Page isn't connected. Visit / and click Connect with Facebook.`);
    return;
  }

  const { data: lead } = await axios.get(
    `https://graph.facebook.com/${GRAPH_VERSION}/${leadgen_id}`,
    { params: { access_token: pageAccessToken, appsecret_proof: getAppSecretProof(pageAccessToken) } }
  );

  const fields = {};
  (lead.field_data || []).forEach((f) => {
    fields[f.name] = f.values && f.values[0];
  });

  let formName = "Facebook Lead Form";
  try {
    const { data: form } = await axios.get(
      `https://graph.facebook.com/${GRAPH_VERSION}/${form_id}`,
      { params: { access_token: pageAccessToken, appsecret_proof: getAppSecretProof(pageAccessToken), fields: "name" } }
    );
    formName = form.name || formName;
  } catch {
    // optional, ignore failures
  }

  const record = {
    id: leadgen_id,
    name: fields.full_name || [fields.first_name, fields.last_name].filter(Boolean).join(" ") || "Unknown",
    phone: fields.phone_number || "",
    email: fields.email || "",
    source: "facebook",
    campaign: formName,
    budget: fields.budget || "Not specified",
    message: fields.message || "",
    stage: "new",
    receivedAt: created_time ? new Date(created_time * 1000).getTime() : Date.now(),
    activity: [
      { id: leadgen_id + "-captured", type: "system", text: "Captured from Facebook lead form", at: Date.now() },
    ],
  };

  store.addLead(record);
  console.log("New lead saved:", record.name, record.phone);
}

// ---------- 3. API for a dashboard to read leads from, if you want one later ----------
app.get("/api/leads", (req, res) => {
  res.json(store.getLeads());
});

app.patch("/api/leads/:id", express.json(), (req, res) => {
  const updated = store.updateLead(req.params.id, req.body);
  if (!updated) return res.sendStatus(404);
  res.json(updated);
});

app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));