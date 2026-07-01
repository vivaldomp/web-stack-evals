// Canonical time/units convention (D-26): one unit everywhere, no mixed durations.

/** Integer epoch milliseconds, UTC. */
export type EpochMs = number;

/** Integer milliseconds (wall/build/startup/render/TTFT durations). */
export type DurationMs = number;

/** Decimal USD cost, verbatim from Pi (never pre-rounded). */
export type UsdCost = number;
