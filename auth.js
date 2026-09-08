const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const config = require("./config");
const { getAppSecretProof } = require("./utils");

const router = express.Router();
const GRAPH_VERSION = "v19.0";

const APP_ID = process.env.FACEBOOK_APP_ID;
const APP_SECRET = process.env.APP_SECRET;
const REDIRECT_URI = process.env.OAUTH_REDIRECT_URI; // e.g. https://your-app.onrender.com/auth/facebook/callback
const CONFIG_ID = process.env.FACEBOOK_LOGIN_CONFIG_ID; // from Facebook Login for Business > Configurations

// Bridges the callback back to the click that started it (just a CSRF-style check, no login needed)
const pendingStates = new Set();

// ---------- Step 1: "Connect with Facebook" button hits this ----------
router.get("/auth/facebook", (req, res) => {
  const state = crypto.randomBytes(12).toString("hex");
  pendingStates.add(state);

  // Business-type apps use a Login Configuration (config_id) instead of a scope list.
  const authUrl =
    `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth` +
    `?client_id=${APP_ID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&state=${state}` +
    `&config_id=${CONFIG_ID}` +
    `&response_type=code`;

  res.redirect(authUrl);
});

// ---------- Step 2: Facebook redirects back here automatically with a code ----------
router.get("/auth/facebook/callback", async (req, res) => {
  const { code, state, error, error_description } = req.query;

  if (error) {
    return res.status(400).send(`Facebook declined: ${error_description || error}`);
  }
  if (!pendingStates.has(state)) {
    return res.status(400).send("Session expired, please click Connect with Facebook again.");
  }
  pendingStates.delete(state);

  try {
    const { data: tokenRes } = await axios.get(
      `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`,
      { params: { client_id: APP_ID, redirect_uri: REDIRECT_URI, client_secret: APP_SECRET, code } }
    );

    const { data: longLived } = await axios.get(
      `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`,
      {
        params: {
          grant_type: "fb_exchange_token",
          client_id: APP_ID,
          client_secret: APP_SECRET,
          fb_exchange_token: tokenRes.access_token,
        },
      }
    );

    const { data: pagesRes } = await axios.get(
      `https://graph.facebook.com/${GRAPH_VERSION}/me/accounts`,
      { params: { access_token: longLived.access_token, appsecret_proof: getAppSecretProof(longLived.access_token) } }
    );

    const pages = pagesRes.data || [];

    if (pages.length === 0) {
      return res.send("No Facebook Pages found for this account. Make sure you're an admin of the Page you want to connect.");
    }

    if (pages.length === 1) {
      await connectPage(pages[0]);
      return res.send(successPage(pages[0].name));
    }

    const listHtml = pages
      .map(
        (p) =>
          `<li><a href="/auth/facebook/select-page?id=${p.id}&token=${encodeURIComponent(p.access_token)}&name=${encodeURIComponent(p.name)}">${p.name}</a></li>`
      )
      .join("");
    res.send(`<h2>Pick the Page to connect</h2><ul>${listHtml}</ul>`);
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).send("Something went wrong connecting to Facebook. Check server logs.");
  }
});

// ---------- Step 3 (only if multiple pages): user clicks the page they want ----------
router.get("/auth/facebook/select-page", async (req, res) => {
  const { id, token, name } = req.query;
  try {
    await connectPage({ id, access_token: token, name });
    res.send(successPage(name));
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).send("Could not connect that Page. Check server logs.");
  }
});

async function connectPage(page) {
  await axios.post(`https://graph.facebook.com/${GRAPH_VERSION}/${page.id}/subscribed_apps`, null, {
    params: {
      subscribed_fields: "leadgen",
      access_token: page.access_token,
      appsecret_proof: getAppSecretProof(page.access_token),
    },
  });

  config.saveConnectedPage({
    id: page.id,
    name: page.name,
    access_token: page.access_token,
    connectedAt: Date.now(),
  });

  console.log(`Connected Page "${page.name}" (${page.id}) and subscribed to lead events.`);
}

function successPage(pageName) {
  return `
    <div style="font-family: sans-serif; max-width: 480px; margin: 60px auto; text-align: center;">
      <h2>✅ Connected!</h2>
      <p><strong>${pageName}</strong> is now linked. New leads submitted on this Page's
      Facebook/Instagram ads will flow in automatically.</p>
      <p><a href="/leads">View leads</a> · <a href="/">Back home</a></p>
    </div>`;
}

module.exports = router;