import type { CaptureContext, LoopCandidate } from "../src/provider";

/** One real capture, exported from the store by eval/export.ts. */
export interface Fixture {
  id: string;
  text: string;
  ctx: Omit<CaptureContext, "user">;
}

/**
 * The loops a careful human would list for one fixture.
 *
 * A candidate matches an expected loop when the direction is equal and its
 * description contains at least one of `match` (case-insensitive). Anything
 * the model returns that matches nothing is a false loop.
 */
export interface ExpectedLoop {
  direction: LoopCandidate["direction"];
  match: string[];
  note?: string;
}

export interface Label {
  id: string;
  loops: ExpectedLoop[];
  /**
   * Excluded from loop scoring: the capture predates sender attribution and
   * a human cannot tell who said what either.
   */
  ambiguous?: boolean;
  note?: string;
}
