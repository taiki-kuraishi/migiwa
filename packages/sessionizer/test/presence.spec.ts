import { describe, expect, test } from "bun:test";

import { presenceStatus, reducePresenceStatus } from "../src/presence";
import { presenceRow } from "./fixtures";

const NOW = 5000;

// The `extra` spread lets tests inject fields like `client_status` without widening PresenceLike itself; TS can't verify the merged literal against it, so the cast below stays asserted.
function update(
  status: string,
  extra: Record<string, unknown> = {},
): Parameters<typeof reducePresenceStatus>[1] {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test-only fixture shape, see comment above
  return { user: { id: "u1" }, guild_id: "g1", status, ...extra } as Parameters<
    typeof reducePresenceStatus
  >[1];
}

describe("presenceStatus", () => {
  test("keeps online, idle and dnd; everything else is offline", () => {
    expect(presenceStatus("online")).toBe("online");
    expect(presenceStatus("idle")).toBe("idle");
    expect(presenceStatus("dnd")).toBe("dnd");
    expect(presenceStatus("offline")).toBeNull();
    expect(presenceStatus("invisible")).toBeNull();
    expect(presenceStatus(undefined)).toBeNull();
  });
});

describe("reducePresenceStatus", () => {
  test("opens a session when nothing is open and the user is online", () => {
    const ops = reducePresenceStatus(
      [],
      update("online", { client_status: { desktop: "online", web: "idle" } }),
      NOW,
    );
    expect(ops).toEqual([
      {
        kind: "open",
        table: "presence",
        row: {
          guild_id: "g1",
          user_id: "u1",
          status: "online",
          client_desktop: "online",
          client_mobile: null,
          client_web: "idle",
          started_at: NOW,
        },
      },
    ]);
  });

  test("does nothing when the status is unchanged", () => {
    expect(
      reducePresenceStatus([presenceRow({ status: "online" })], update("online"), NOW),
    ).toEqual([]);
  });

  test("closes and reopens on a status change", () => {
    const row = presenceRow({ status: "online" }),
      ops = reducePresenceStatus([row], update("idle"), NOW);
    expect(ops).toHaveLength(2);
    expect(ops[0]).toEqual({
      kind: "close",
      table: "presence",
      id: row.id,
      ended_at: NOW,
      end_reason: "status_change",
    });
    expect(ops[1]).toMatchObject({
      kind: "open",
      table: "presence",
      row: { status: "idle", started_at: NOW },
    });
  });

  test("closes with offline and opens nothing when the user goes offline", () => {
    const row = presenceRow({ status: "dnd" });
    expect(reducePresenceStatus([row], update("offline"), NOW)).toEqual([
      { kind: "close", table: "presence", id: row.id, ended_at: NOW, end_reason: "offline" },
    ]);
  });

  test("ignores offline for a user with no open session", () => {
    expect(reducePresenceStatus([], update("offline"), NOW)).toEqual([]);
  });

  test("only looks at the row of the same guild and user", () => {
    const other = presenceRow({ user_id: "u2", status: "online" }),
      ops = reducePresenceStatus([other], update("online"), NOW);
    expect(ops).toHaveLength(1);
    expect(ops[0]?.kind).toBe("open");
  });
});
