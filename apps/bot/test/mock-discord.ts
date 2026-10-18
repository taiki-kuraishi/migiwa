import type { WebSocketHandlerConnection } from "msw/ws";

import { http, HttpResponse } from "msw";
import { ws } from "msw/ws";

export const gatewayHost = "gateway.discord.gg";
export const resumeHost = "gateway-resume.discord.gg";

interface Frame {
  op: number;
  d: unknown;
}

interface Connection {
  host: string;
  frames: Frame[];
  closeCodes: number[];
  client: WebSocketHandlerConnection["client"];
}

/**
 * Discord の REST と Gateway を差し替える msw の handler と、その Gateway を操作する関数を返す。
 * Gateway は HELLO を送り、IDENTIFY には READY、RESUME には RESUMED（resumable が false なら op 9）、
 * heartbeat には ACK（ackHeartbeats が false なら返さない）を返す。helloOnFirstConnection が false
 * なら、最初の socket にだけ HELLO を送らない。
 */
export const mockDiscord = (args: {
  sessionId: string;
  heartbeatInterval?: number;
  ackHeartbeats?: boolean;
  resumable?: boolean;
  helloOnFirstConnection?: boolean;
}) => {
  const connections: Connection[] = [];
  let stopping = false;

  const reply = (args2: { client: Connection["client"]; payload: unknown }) => {
    args2.client.send(JSON.stringify(args2.payload));
  };

  const onFrame = (frame: Frame, connection: Connection) => {
    connection.frames.push(frame);

    if (frame.op === 1 && args.ackHeartbeats !== false) {
      reply({ client: connection.client, payload: { op: 11 } });
    }

    if (frame.op === 2) {
      reply({
        client: connection.client,
        payload: {
          op: 0,
          t: "READY",
          s: 1,
          d: {
            session_id: args.sessionId,
            resume_gateway_url: `wss://${resumeHost}`,
            user: { id: "bot-user" },
          },
        },
      });
    }

    if (frame.op === 6 && args.resumable === false) {
      reply({ client: connection.client, payload: { op: 9, d: false } });
    }

    if (frame.op === 6 && args.resumable !== false) {
      reply({ client: connection.client, payload: { op: 0, t: "RESUMED", s: 100, d: {} } });
    }
  };

  const onConnection = ({ client }: WebSocketHandlerConnection) => {
    // 片付けの後に届いた再接続は、bot が止まるように 4004 で閉じる。
    if (stopping) {
      client.close(4004, "test finished");
      return;
    }
    const connection: Connection = { host: client.url.host, frames: [], closeCodes: [], client };
    connections.push(connection);
    client.addEventListener("message", (event) => {
      onFrame(JSON.parse(String(event.data)), connection);
    });
    client.addEventListener("close", (event) => {
      connection.closeCodes.push(event.code);
    });

    // HELLO の代わりに、bot が無視する ACK を送る。mock の socket は最初の送信で accept されるので、
    // 何も送らないと bot が閉じたことを受け取れない。
    const silent = connections.length === 1 && args.helloOnFirstConnection === false;
    reply({
      client,
      payload: silent
        ? { op: 11 }
        : { op: 10, d: { heartbeat_interval: args.heartbeatInterval ?? 45_000 } },
    });
  };

  const handlers = [
    http.get("https://discord.com/api/v10/applications/@me", () => HttpResponse.json({ flags: 0 })),
    http.get("https://discord.com/api/v10/gateway/bot", () =>
      HttpResponse.json({ url: `wss://${gatewayHost}` }),
    ),
    ws.link(`wss://${gatewayHost}`).addEventListener("connection", onConnection),
    ws.link(`wss://${resumeHost}`).addEventListener("connection", onConnection),
  ];

  return {
    handlers,
    connections,
    /**
     * 最後に開いた socket へ payload を送る。
     */
    send: (payload: unknown) => {
      const connection = connections.at(-1);

      if (connection !== undefined) {
        reply({ client: connection.client, payload });
      }
    },
    /**
     * 最後に開いた socket を code で閉じる。
     */
    close: (code: number) => {
      connections.at(-1)?.client.close(code, "closed by the test");
    },
    /**
     * 開いている socket とこれから開く socket を 4004 で閉じ、bot を止める。
     */
    stop: () => {
      stopping = true;
      for (const connection of connections) {
        connection.client.close(4004, "test finished");
      }
    },
  };
};
