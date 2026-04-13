import { describe, it, expect } from "vitest";
import { bayesianAverage, BAYES_C, BAYES_PRIOR } from "../src/stats/bayesian";

describe("bayesianAverage", () => {
  it("returns the prior when there are zero ratings", () => {
    expect(bayesianAverage(0, 0)).toBe(BAYES_PRIOR);
  });
  it("pulls low-count ratings toward the prior", () => {
    // One 5-star rating → (1*5 + 5*3.5) / (1+5) = 22.5/6 = 3.75
    expect(bayesianAverage(5, 1)).toBeCloseTo(3.75, 2);
  });
  it("converges toward the true mean as count grows", () => {
    // 100 5-star ratings → (100*5 + 5*3.5) / 105 = 517.5/105 ≈ 4.928
    expect(bayesianAverage(5, 100)).toBeCloseTo(4.928, 2);
  });
  it("uses C = 5 and prior = 3.5", () => {
    expect(BAYES_C).toBe(5);
    expect(BAYES_PRIOR).toBe(3.5);
  });
});
