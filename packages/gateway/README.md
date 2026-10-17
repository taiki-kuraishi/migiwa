# @migiwa/gateway

Discord Gateway client as a pure state machine, driven by the bot Worker's Durable Object.

## Responsibilities

- Implements: the Gateway protocol state machine (HELLO, IDENTIFY, RESUME, heartbeats, op 7,
  op 9, and the reconnect decision per close code) and deriving intents from the application flags.
- Does not implement: running sockets, timers, HTTP (the Discord REST API), or persistence. The
  Durable Object passes inputs in and executes the outputs it gets back.

## Usage

`new GatewayClient({ token, intents, state })` takes the bot token, the intents
(`deriveIntents(flags)` with the flags from `GET /applications/@me`), and the persisted state
`{ sessionId, sequence, resumeUrl, gatewayUrl }` (`gatewayUrl` from `GET /gateway/bot`); `now` and
`random` are optional overrides for tests. Each input method returns the outputs to execute:

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

Persist `client.state` after each input. Heartbeat ACKs are per connection and not part of it.

## Testing

```sh
bunx vp run -r test
```
