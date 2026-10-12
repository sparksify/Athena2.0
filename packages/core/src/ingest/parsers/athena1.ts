import { genericParser } from "./generic";

/** Source type "athena1" — see ../source-types.ts. Column-tolerant; grows its own rules here when needed. */
export const parse_athena1 = genericParser("athena1");
