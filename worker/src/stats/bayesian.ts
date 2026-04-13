// Bayesian weighted average for star ratings.
// Formula: (n * avg + C * prior) / (n + C)
// C = strength of the prior (in "virtual votes"); prior = neutral rating value.
export const BAYES_C = 5;
export const BAYES_PRIOR = 3.5;

export function bayesianAverage(avg: number, count: number): number {
  return (count * avg + BAYES_C * BAYES_PRIOR) / (count + BAYES_C);
}
