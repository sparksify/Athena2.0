import { genericParser } from "./generic";

/** Source type "bulk" — see ../source-types.ts. Column-tolerant; grows its own rules here when needed. */
export const parse_bulk = genericParser("bulk");
