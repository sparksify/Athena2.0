import type { SourceParser } from "../types";
import { parse_athena1 } from "./athena1";
import { parse_bulk } from "./bulk";
import { parse_consultant_handback } from "./consultant_handback";
import { parse_cq } from "./cq";
import { parsePurchased } from "./purchased";
import { parse_referral } from "./referral";
import { parseResume } from "./resume";
import { parseTradeshow } from "./tradeshow";
import { parse_web_inquiry } from "./web_inquiry";

export const PARSERS: Record<string, SourceParser> = {
  cq: parse_cq,
  referral: parse_referral,
  web_inquiry: parse_web_inquiry,
  consultant_handback: parse_consultant_handback,
  tradeshow: parseTradeshow,
  resume: parseResume,
  athena1: parse_athena1,
  purchased: parsePurchased,
  bulk: parse_bulk,
};
