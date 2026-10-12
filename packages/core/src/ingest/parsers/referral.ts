import { genericParser } from "./generic";

/** Source type "referral" — see ../source-types.ts. Column-tolerant; grows its own rules here when needed. */
export const parse_referral = genericParser("referral");
