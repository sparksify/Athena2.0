import { genericParser } from "./generic";

/** Source type "cq" — see ../source-types.ts. Column-tolerant; grows its own rules here when needed. */
export const parse_cq = genericParser("cq");
