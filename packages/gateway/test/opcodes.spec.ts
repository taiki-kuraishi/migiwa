import { describe, expect, test } from "bun:test";

import { Opcode } from "../src/opcodes";

describe("Opcode", () => {
  test("matches the Discord Gateway opcode table", () => {
    expect(Opcode).toEqual({
      Dispatch: 0,
      Heartbeat: 1,
      Identify: 2,
      Resume: 6,
      Reconnect: 7,
      InvalidSession: 9,
      Hello: 10,
      HeartbeatAck: 11,
    });
  });
});
