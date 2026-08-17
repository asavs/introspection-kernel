import { seededRandom, shuffle } from "./deep_practice_protocol.js";
import { SIGN_PROTOCOL, buildSignSchedule } from "./sign_stratified_protocol.js";

export const SIGN_PROTOCOL_V2 = Object.freeze({
  ...SIGN_PROTOCOL,
  schema: "ik.sign-stratified-practice-preregistration.v2",
  run_id: "sign-stratified-practice-preregistered-20260816-002",
  randomization_seed: "ik-sign-stratified-practice-v2-20260816",
  practice_pool_count: 25
});

export function buildSignScheduleV2() {
  return buildSignSchedule(SIGN_PROTOCOL_V2);
}

export function buildPracticePoolPermutations(protocol = SIGN_PROTOCOL_V2) {
  return [...Array(protocol.practice_pool_count)].map((_, index) =>
    shuffle([0, 1, 2, 3, 4], seededRandom(`${protocol.randomization_seed}:practice-pool-panel:${index}`)));
}

