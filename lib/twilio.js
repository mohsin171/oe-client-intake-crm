// Shared Twilio outbound send. Used by the WhatsApp/SMS channel and the
// missed-call text-back. Ready to activate: needs TWILIO_ACCOUNT_SID +
// TWILIO_AUTH_TOKEN. Throws if called without credentials (callers guard).

const SID = process.env.TWILIO_ACCOUNT_SID;
const TOKEN = process.env.TWILIO_AUTH_TOKEN;

export function twilioConfigured() {
  return Boolean(SID && TOKEN);
}

export async function sendTwilio({ to, from, body }) {
  if (!SID || !TOKEN) throw new Error("Twilio not configured");
  const url = `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`;
  const form = new URLSearchParams({ To: to, From: from, Body: body });
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${SID}:${TOKEN}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  if (!res.ok) throw new Error("Twilio " + res.status + " " + (await res.text()));
  return true;
}
