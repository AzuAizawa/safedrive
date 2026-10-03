// The rule that keeps the subscription plans in order (CHAPTER 115): paying
// more always buys more. The database enforces it on every settings change;
// this lets the admin form say so before a proposal is sent. No client
// imports, so it is testable on its own.

export type PlanValues = {
  free: number;
  proExtra: number;
  premiumExtra: number;
  proPricePhp: number;
  premiumPricePhp: number;
};

/** Why these plan values are out of order, or null when they are fine. */
export const planOrderProblem = (plan: PlanValues): string | null => {
  if (!(plan.proExtra >= 1)) {
    return "Pro must give more vehicle slots than Free: its extra slots must be at least 1.";
  }
  if (!(plan.premiumExtra > plan.proExtra)) {
    return `Premium must give more vehicle slots than Pro (${plan.free + plan.proExtra} total).`;
  }
  if (!(plan.premiumPricePhp > plan.proPricePhp)) {
    return `Premium must cost more than Pro (PHP ${plan.proPricePhp}).`;
  }
  return null;
};
