# @migiwa/gateway

Discord Gateway client as a pure state machine, driven by the bot Worker's Durable Object.

## Responsibilities

- Implements: the Gateway protocol state machine (HELLO, IDENTIFY, RESUME, heartbeats, op 7,
  op 9, the reconnect decision per close code, and the reconnect backoff) and deriving intents
  from the application flags.
- Does not implement: running sockets, timers, HTTP (the Discord REST API), or persistence. The
  Durable Object passes inputs in and executes the outputs it gets back.

## Usage

`new GatewayClient({ token, intents, state })` takes the bot token, the intents
(`deriveIntents(flags)` with the flags from `GET /applications/@me`), and the persisted state
`{ sessionId, sequence, resumeUrl, gatewayUrl }` (`gatewayUrl` from `GET /gateway/bot`); `now` and
`random` are optional overrides for tests. Each input method returns the outputs to execute
(`GatewayOutput`):

| Input                | When                                   |
| -------------------- | -------------------------------------- |
| `start()`            | the Durable Object boots               |
| `connected()`        | the socket opened                      |
| `received(text)`     | a text frame arrived                   |
| `disconnected(code)` | the socket closed or failed to open    |
| `heartbeatDue()`     | the time from `scheduleHeartbeat` came |

| Output              | Action                                                                  |
| ------------------- | ----------------------------------------------------------------------- |
| `send`              | `JSON.stringify(payload)` and send it                                   |
| `scheduleHeartbeat` | call `heartbeatDue()` at `at`, replacing any earlier schedule           |
| `dispatch`          | store the event                                                         |
| `disconnect`        | close the socket with `code`; pass nothing from it, its close included  |
| `reconnect`         | open a socket to `url` at `at`; `connected()` once it opens             |
| `stop`              | stop reconnecting; `reason` names the close code                        |

Persist `client.state` (`GatewayState`) after each input. Heartbeat ACKs are per connection and not
part of it, nor is the backoff: a reconnect after a close, a missed heartbeat ACK, or an unreadable
frame waits 1 s doubling up to 5 min, spread to 1/2–1 of that, and READY or RESUMED resets it to
1 s. Op 7 reconnects at once and op 9 after 1–5 s, as Discord asks.

## Testing

```sh
bunx vp run -r test
```
