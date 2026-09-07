import { describe, expect, test } from "bun:test";

import { presenceStatus, reducePresenceStatus } from "../src/presence";
import { presenceRow, presenceUpdate } from "./fixtures";

const NOW = 5000;

describe("presenceStatus", () => {
  test("keeps online, idle and dnd; everything else is untracked (null)", () => {
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
      presenceUpdate({ status: "online", client_status: { desktop: "online", web: "idle" } }),
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
      reducePresenceStatus(
        [presenceRow({ status: "online" })],
        presenceUpdate({ status: "online" }),
        NOW,
      ),
    ).toEqual([]);
  });

  test("closes and reopens on a status change", () => {
    const row = presenceRow({ status: "online" }),
      ops = reducePresenceStatus([row], presenceUpdate({ status: "idle" }), NOW);
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
    expect(reducePresenceStatus([row], presenceUpdate({ status: "offline" }), NOW)).toEqual([
      { kind: "close", table: "presence", id: row.id, ended_at: NOW, end_reason: "offline" },
    ]);
  });

  test("ignores offline for a user with no open session", () => {
    expect(reducePresenceStatus([], presenceUpdate({ status: "offline" }), NOW)).toEqual([]);
  });

  test("only looks at the row of the same guild and user", () => {
    const otherUser = presenceRow({ user_id: "u2", status: "online" }),
      otherGuild = presenceRow({ guild_id: "g2", status: "online" }),
      opsForOtherUser = reducePresenceStatus(
        [otherUser],
        presenceUpdate({ status: "online" }),
        NOW,
      ),
      opsForOtherGuild = reducePresenceStatus(
        [otherGuild],
        presenceUpdate({ status: "online" }),
        NOW,
      );
    expect(opsForOtherUser).toHaveLength(1);
    expect(opsForOtherUser[0]?.kind).toBe("open");
    expect(opsForOtherGuild).toHaveLength(1);
    expect(opsForOtherGuild[0]?.kind).toBe("open");
  });
});
