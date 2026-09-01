import type { SourceParser } from "../types.js";
import { parsePurchased } from "./purchased.js";
import { parseResume } from "./resume.js";
import { parseTradeshow } from "./tradeshow.js";

export const PARSERS: Record<string, SourceParser> = {
  resume: parseResume,
  tradeshow: parseTradeshow,
  purchased: parsePurchased,
};
