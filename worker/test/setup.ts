import { env, applyD1Migrations } from "cloudflare:test";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

// Stub Workers AI: the `[env.test]` wrangler section intentionally omits the
// AI binding (miniflare + vitest-pool-workers 0.5.x can't resolve the wrapped
// AI worker). Assign the full AI object here so classifyReview() can call
// env.AI.run() in tests without hitting the network.
(env as any).AI = { run: async (_model: string, _opts: unknown) => ({ response: "safe" }) };

// ADMIN_USER_IDS is configured in wrangler.toml's [env.test.vars] block.
// Mutating `env` here does not propagate to `c.env` inside the worker (same
// caveat as AI — but AI needs a runtime-defined object, while a plain string
// var works fine via wrangler config).
