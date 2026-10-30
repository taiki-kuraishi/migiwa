import { createScheduledController } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, test, vi } from "vitest";

import worker from "../../src/entry";

test("Secrets Store の token を読めない cron は、集計せずに SecretReadError をログに残す", async () => {
  // Arrange
  // テストの Secrets Store は空だが、その reject は miniflare 側で uncaught として残るので、binding の get を差し替える。
  vi.spyOn(env.BASIN_SQL_TOKEN, "get").mockRejectedValue(new Error("Secret not found"));
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});

  // Act
  await worker.scheduled(createScheduledController({ cron: "30 * * * *" }), env);

  // Assert
  expect(errors).toHaveBeenCalledWith({
    message: "Failed to read the secrets",
    error: expect.objectContaining({ _tag: "SecretReadError" }),
  });
});
