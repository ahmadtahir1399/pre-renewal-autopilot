// Prices used for the cost estimate. TYPED BY THE PROJECT AUTHOR from the provider's pricing page
// (2026-10-19, Standard tier). Not checked by code. The page lists "gpt-5.4-nano" (not the dated
// snapshot used here) and shows "$" without a currency code: treated as USD. Re-check before reuse.

export interface Pricing {
  model: string;
  currency: string;
  inputPerMillion: number;
  cachedInputPerMillion: number;
  outputPerMillion: number;
  source: string;
}

export const PRICING: Pricing = {
  model: 'gpt-5.4-nano',
  currency: 'USD (assumed; the page shows "$" without a code)',
  inputPerMillion: 0.2,
  cachedInputPerMillion: 0.02,
  outputPerMillion: 1.25,
  source: "Typed by the project author from OpenAI's pricing page, Standard tier, on 2026-10-19; listed for gpt-5.4-nano, not the dated snapshot.",
};

export const COST_FORMULA =
  'cost = (inputTokens - cachedInputTokens) x inputPerMillion / 1,000,000 + cachedInputTokens x cachedInputPerMillion / 1,000,000 + outputTokens x outputPerMillion / 1,000,000';

/** Cost in the pricing currency. cachedInputTokens null = not reported, billed at the full input price (an upper bound). */
export function costOf(tokens: { inputTokens: number; outputTokens: number; cachedInputTokens: number | null }, pricing: Pricing = PRICING): number {
  const cached = Math.min(tokens.cachedInputTokens ?? 0, tokens.inputTokens);
  return ((tokens.inputTokens - cached) * pricing.inputPerMillion + cached * pricing.cachedInputPerMillion + tokens.outputTokens * pricing.outputPerMillion) / 1_000_000;
}
