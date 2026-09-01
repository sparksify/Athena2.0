import type { SourceParser } from "../types";
import { parsePurchased } from "./purchased";
import { parseResume } from "./resume";
import { parseTradeshow } from "./tradeshow";

export const PARSERS: Record<string, SourceParser> = {
  resume: parseResume,
  tradeshow: parseTradeshow,
  purchased: parsePurchased,
};
