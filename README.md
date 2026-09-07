# Meta Lead Ads → CRM webhook server (with one-click Connect)

This server does two jobs:
1. Lets you **click "Connect with Facebook," approve permissions on Facebook's
   own screen, and pick your Page** — no manual token copying, no curl
   commands. This is fully automated (`auth.js`).
2. Receives leads the instant someone submits your Facebook/Instagram lead
   form, and saves them (`server.js` + `store.js`).

There is exactly **one thing that cannot be automated**, because Meta
requires it to be done by a human, once: **creating the Developer App**
itself. No tool anywhere — including Privyr's own backend — can skip this;
it's Meta registering *you* as a developer. It takes about 10 minutes and
you only ever do it once. Everything after that is one click.

---

## One-time setup (you, ~10–15 minutes)

### 1. Create the Meta Developer App
1. Go to https://developers.facebook.com/apps → **Create App** → type **Business**.
2. Name it anything.
3. Add these products from the dashboard: **Facebook Login**, **Webhooks**, **Marketing API**.

### 2. Configure Facebook Login
1. In **Facebook Login → Settings**, add to **Valid OAuth Redirect URIs**:
   `https://<your-deployed-domain>/auth/facebook/callback`
   (you'll fill in the real domain after step 4 below).

### 3. Get your App ID and App Secret
Found on **App Settings → Basic**. Put them in `.env` as `FACEBOOK_APP_ID`
and `APP_SECRET`.

### 4. Deploy this server
- Push this folder to a GitHub repo.
- On **Render.com** (or Railway): New → Web Service → connect the repo.
  Build command `npm install`, start command `npm start`.
- Add your `.env` values as environment variables in the hosting dashboard.
- Once deployed you'll have a URL like `https://your-app.onrender.com`.
  Go back to step 2 and put the real callback URL in.

### 5. Register the webhook
1. In the Developer App → **Webhooks** → Page object.
2. Callback URL: `https://your-app.onrender.com/webhook`
3. Verify Token: any string, matching `VERIFY_TOKEN` in your `.env`.
4. Subscribe to the **leadgen** field.

### 6. Submit for App Review
While in Development Mode, you'll only get leads from admins/testers of the
app. To receive **real customer leads**, submit for App Review and request
Advanced Access for `leads_retrieval` and `pages_manage_metadata`. This is
Meta's manual review (fraud/privacy check) — budget a few days. One-time.

---

## Everyday setup, from here on (fully automatic)

Once the above exists, connecting a Page is one click, forever:

1. Visit `https://your-app.onrender.com/`
2. Click **Connect with Facebook**
3. Approve permissions on Facebook's own screen
4. If you manage multiple Pages, pick the one to connect
5. Done — the server automatically:
   - Generates and stores that Page's access token
   - Subscribes the Page to lead events (`leadgen`)
   - Starts saving every new lead the moment it's submitted

No Graph API Explorer, no curl, no manual token pasting. Reconnecting a
Page (e.g. after a token expires) is the same one click.

---

## API for your dashboard

- `GET /api/leads` — all captured leads, schema-matched to the PulseDesk dashboard
- `PATCH /api/leads/:id` — update a lead (e.g. change stage, add a note)

Once this is live and returning real leads, tell me and I'll point the
PulseDesk dashboard at this endpoint so leads appear there automatically.
