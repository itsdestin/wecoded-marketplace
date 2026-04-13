import { env, applyD1Migrations } from "cloudflare:test";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

// Stub Workers AI: the `[env.test]` wrangler section intentionally omits the
// AI binding (miniflare + vitest-pool-workers 0.5.x can't resolve the wrapped
// AI worker). Assign the full AI object here so classifyReview() can call
// env.AI.run() in tests without hitting the network.
(env as any).AI = { run: async (_model: string, _opts: unknown) => ({ response: "safe" }) };
