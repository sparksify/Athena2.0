// Live GoHighLevel read smoke test — run once credentials exist:
//
//   GHL_API_KEY=... GHL_LOCATION_ID=... pnpm exec tsx scripts/smoke/ghl-lookup.ts someone@example.com
//
// Prints everything Athena would pull for that person: tags, DND, pipeline
// stage, opportunities, message history, appointments, notes. Read-only.
import { GhlCrmAdapter } from "@athena/crm-ghl";

async function main() {
  const [q] = process.argv.slice(2);
  if (!q) {
    console.error("usage: tsx scripts/smoke/ghl-lookup.ts <email-or-phone>");
    process.exit(1);
  }
  const crm = new GhlCrmAdapter();
  const h = await crm.lookupContact(q.includes("@") ? { email: q } : { phone: q });
  if (!h) {
    console.log("not in GHL:", q);
    return;
  }
  console.log(JSON.stringify({
    contactRef: h.contactRef, tags: h.tags, dnd: h.dnd, source: h.source, addedAt: h.addedAt, assignedTo: h.assignedTo,
    opportunities: h.opportunities, appointments: h.appointments, notes: h.notes.length,
    messages: { total: h.messages.length, inbound: h.messages.filter((m) => m.direction === "inbound").length, first: h.messages[0], last: h.messages.at(-1) },
    customFields: Object.keys(h.customFields),
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
