import type { RoutingRule } from "../types";
import { availability } from "./availability";
import { load } from "./load";
import { performance } from "./performance";
import { priorRelationship } from "./prior-relationship";
import { roundRobin } from "./round-robin";
import { specialty } from "./specialty";
import { territory } from "./territory";

/** Evaluation order is presentation order in assignment.reason. */
export const ROUTING_RULES: RoutingRule[] = [
  availability,
  priorRelationship,
  specialty,
  territory,
  load,
  performance,
  roundRobin,
];
