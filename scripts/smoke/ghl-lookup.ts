// Live GoHighLevel read smoke test — run once credentials exist:
//
//   GHL_API_KEY=<agency token> GHL_COMPANY_ID=<agency id> pnpm exec tsx scripts/smoke/ghl-lookup.ts someone@example.com
//
// Prints everything Athena would pull for that person: tags, DND, pipeline
// stage, opportunities, message history, appointments, notes. Read-only.
import { GhlAgencyReader } from "@athena/crm-ghl";
import { getDb } from "@athena/db";
import { crmLookupScope } from "@athena/core";

async function main() {
  const [q] = process.argv.slice(2);
  if (!q) {
    console.error("usage: tsx scripts/smoke/ghl-lookup.ts <email-or-phone>");
    process.exit(1);
  }
  const crm = await GhlAgencyReader.scoped(process.env.DATABASE_URL ? await crmLookupScope(getDb()) : []);
  console.log(`scope: ${crm.scope} (${(await crm.listLocations()).length} of ${crm.total} sub-accounts)`);
  console.log("sub-accounts:", (await crm.listLocations()).map((l) => `${l.name ?? "?"} (${l.id})`).join(", "));
  const h = await crm.lookupContact(q.includes("@") ? { email: q } : { phone: q });
  if (!h) {
    console.log("not in GHL:", q);
    return;
  }
  console.log(JSON.stringify({
    locations: h.locations, contactRef: h.contactRef, tags: h.tags, dnd: h.dnd, source: h.source, addedAt: h.addedAt, assignedTo: h.assignedTo,
    opportunities: h.opportunities, appointments: h.appointments, notes: h.notes.length,
    messages: { total: h.messages.length, inbound: h.messages.filter((m) => m.direction === "inbound").length, first: h.messages[0], last: h.messages.at(-1) },
    customFields: Object.keys(h.customFields),
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
