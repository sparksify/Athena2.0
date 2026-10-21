import { describe, expect, it } from "vitest";
import { extractContacts } from "../src/outreach/dnc";

describe("do-not-contact upload", () => {
  it("finds emails and phones in any layout, normalized and deduplicated", () => {
    const csv = [
      "Name,Email,Phone,Notes",
      "Pat Example,Pat@Example.com,(555) 010-0100,asked to stop",
      "Sam Example,\"Sam Example <sam@example.com>\",555-010-0100,",
      "Nobody,,,no contact info",
      "Dup,pat@example.com,+1 555 010 0199,",
    ].join("\n");
    const r = extractContacts(csv);
    expect(r.emails.sort()).toEqual(["pat@example.com", "sam@example.com"]);
    expect(r.phones.sort()).toEqual(["+15550100100", "+15550100199"]);
  });

  it("accepts a plain list, one entry per line, and ignores short numbers", () => {
    const r = extractContacts("a@example.com\n5550100100\n123\nb@example.com\n");
    expect(r.emails).toEqual(["a@example.com", "b@example.com"]);
    expect(r.phones).toEqual(["+15550100100"]);
  });
});
