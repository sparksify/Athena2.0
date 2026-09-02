// Live Smartlead smoke test — run the moment credentials exist:
//
//   SMARTLEAD_API_KEY=... SMARTLEAD_API_CAMPAIGN_ID=... \
//     pnpm exec tsx scripts/smoke/smartlead-send.ts you@yourdomain.com [email_account_id]
//
// Sends ONE plainly-labeled test email through the adapter and prints the
// provider reference. Confirms the per-lead custom-content send path before
// any campaign goes live. This bypasses campaign/draft gates on purpose —
// it must only ever be pointed at our own test inbox.
import { SmartleadProvider } from "@athena/email-smartlead";

async function main() {
  const [to, mailboxRef = ""] = process.argv.slice(2);
  if (!to || !to.includes("@")) {
    console.error("usage: tsx scripts/smoke/smartlead-send.ts <our-test-inbox@...> [email_account_id]");
    process.exit(1);
  }
  const provider = new SmartleadProvider();
  const res = await provider.sendEmail({
    to,
    subject: "Athena smoke test — ignore",
    bodyText:
      "This is a one-off Athena 2.0 → Smartlead integration test sent to our own inbox. If the per-message custom content and the reply webhook both arrive intact, Phase 5 goes live.",
    mailboxRef,
  });
  console.log("sent:", res);
  console.log("now reply to it from the inbox and confirm the webhook lands at /api/webhooks/smartlead");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
