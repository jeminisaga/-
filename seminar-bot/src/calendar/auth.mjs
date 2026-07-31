// Google OAuth (installed-app / desktop loopback flow). Run once interactively:
//   npm run auth
// which opens the consent screen, captures the code on a localhost redirect,
// and stores a refresh token in config/token.json. Subsequent runs load and
// silently refresh it.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { google } from "googleapis";
import { ROOT } from "../config.mjs";
import { makeLogger } from "../logger.mjs";

const log = makeLogger("auth");
const SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"];
const CRED_PATH = path.join(ROOT, "config", "credentials.json");
const TOKEN_PATH = path.join(ROOT, "config", "token.json");

function loadCredentials() {
  if (!fs.existsSync(CRED_PATH)) {
    throw new Error(
      `Missing ${CRED_PATH}. Create an OAuth 2.0 "Desktop app" client in Google Cloud Console ` +
        `(APIs & Services > Credentials), download the JSON, and save it there.`
    );
  }
  const raw = JSON.parse(fs.readFileSync(CRED_PATH, "utf8"));
  const c = raw.installed || raw.web || raw;
  if (!c.client_id || !c.client_secret) throw new Error("credentials.json missing client_id/client_secret");
  return c;
}

function makeOAuthClient(redirectUri) {
  const c = loadCredentials();
  return new google.auth.OAuth2(c.client_id, c.client_secret, redirectUri);
}

/** Returns an authorized OAuth2 client, or throws if not yet authorized. */
export function getAuthClient() {
  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error(`Not authorized yet. Run \`npm run auth\` first (creates ${TOKEN_PATH}).`);
  }
  const token = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
  const oauth = makeOAuthClient("http://127.0.0.1");
  oauth.setCredentials(token);
  // Persist refreshed tokens so the refresh_token is never lost.
  oauth.on("tokens", (t) => {
    const merged = { ...token, ...t };
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(merged, null, 2));
  });
  return oauth;
}

/** Interactive one-time authorization via a localhost loopback redirect. */
export async function runAuthFlow() {
  const server = http.createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const redirectUri = `http://127.0.0.1:${port}`;
  const oauth = makeOAuthClient(redirectUri);

  const authUrl = oauth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
  });

  log.info("Open this URL in your browser to authorize (calendar read-only):");
  log.info(authUrl);

  const code = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("authorization timed out")), 5 * 60 * 1000);
    server.on("request", (req, res) => {
      const url = new URL(req.url, redirectUri);
      const c = url.searchParams.get("code");
      const err = url.searchParams.get("error");
      res.end("You can close this tab and return to the terminal.");
      clearTimeout(timeout);
      if (err) reject(new Error(`authorization denied: ${err}`));
      else resolve(c);
    });
  });

  const { tokens } = await oauth.getToken(code);
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  log.info(`Saved token to ${TOKEN_PATH}. Authorization complete.`);
  server.close();
}

// Run the flow when executed directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  runAuthFlow().catch((e) => {
    log.error(String(e));
    process.exit(1);
  });
}
