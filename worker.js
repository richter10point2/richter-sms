// RICHTER SMS — Cloudflare Worker
// Handles inbound STOP replies from Telnyx and writes opt-outs to Google Sheets
// Deploy at: https://dash.cloudflare.com → Workers → Create Worker

const SHEET_ID = "18y5QmBjhnbPZP3RBiPQIVTsDOE3xJPRtFI_RBAumfQw";
const SERVICE_ACCOUNT_EMAIL = "richter-sms-app@brave-alliance-494621-k7.iam.gserviceaccount.com";

// Paste your private key here (from the downloaded JSON file)
const PRIVATE_KEY = `-----BEGIN RSA PRIVATE KEY-----
PASTE_YOUR_PRIVATE_KEY_HERE
-----END RSA PRIVATE KEY-----`;

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('Richter SMS Opt-Out Webhook', { status: 200 });
    }

    try {
      const body = await request.json();

      // Telnyx sends inbound messages as webhooks
      const eventType = body?.data?.event_type;
      if (eventType !== 'message.received') {
        return new Response('OK', { status: 200 });
      }

      const messageText = (body?.data?.payload?.text || '').trim().toUpperCase();
      const fromNumber = body?.data?.payload?.from?.phone_number;

      // Handle STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT
      const stopWords = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'];
      if (!stopWords.includes(messageText) && !stopWords.some(w => messageText.startsWith(w))) {
        return new Response('OK', { status: 200 });
      }

      if (!fromNumber) {
        return new Response('No phone number', { status: 400 });
      }

      // Write opt-out to Google Sheets
      const token = await getGoogleToken();
      const now = new Date().toISOString();

      const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/optouts!A:B:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;

      await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ values: [[fromNumber, now]] })
      });

      console.log(`Opt-out recorded: ${fromNumber} at ${now}`);
      return new Response('OK', { status: 200 });

    } catch (e) {
      console.error('Webhook error:', e);
      return new Response('Error', { status: 500 });
    }
  }
};

// ─── GOOGLE SHEETS AUTH ───────────────────────────────────────────────────────
async function getGoogleToken() {
  const now = Math.floor(Date.now() / 1000);

  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    iss: SERVICE_ACCOUNT_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  }));

  const signingInput = `${header}.${payload}`;
  const key = await importKey(PRIVATE_KEY);
  const sig = await sign(signingInput, key);
  const jwt = `${signingInput}.${sig}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
  });

  const data = await res.json();
  return data.access_token;
}

function b64url(str) {
  return btoa(str).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function importKey(pem) {
  const pemContents = pem
    .replace(/-----BEGIN RSA PRIVATE KEY-----/, '')
    .replace(/-----END RSA PRIVATE KEY-----/, '')
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');
  const binary = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
  return await crypto.subtle.importKey('pkcs8', binary.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

async function sign(input, key) {
  const enc = new TextEncoder();
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(input));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
