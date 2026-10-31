import type { StreamingUpdate } from "../../client/basin-sql-client";
import type { StreamingInterval } from "./types";

import { orderBySeq } from "../../utils/order-by-seq";

/**
 * 各 user の配信の変化を、配信が現れた時刻と消えた時刻で切った区間につなぐ。
 */
export class StreamingIntervalService {
  /**
   * [from, to) の変化を、from で閉じた各 user・配信の区間から順につなぎ、書く区間を返す。from で閉じた区間が
   * 続くなら、同じ開始時刻で終了時刻を延ばした区間として返す。
   * 1. From で閉じた区間は、event が無ければその配信を続けているとみなして開いておく
   * 2. 変化を時刻の順にたどり、消えた配信の区間を閉じ、現れた配信の区間を開く
   * 3. 開いている区間を to で閉じる
   */
  public connect(args: {
    from: Date;
    to: Date;
    closedAtFrom: StreamingInterval[];
    updates: StreamingUpdate[];
  }) {
    const closed: StreamingInterval[] = [];

    // Step 1: From で閉じた区間は、event が無ければその配信を続けているとみなして開いておく
    const open = Map.groupBy(args.closedAtFrom, (interval) => interval.userId);

    // Step 2: 変化を時刻の順にたどり、消えた配信の区間を閉じ、現れた配信の区間を開く
    const updates = orderBySeq(
      args.updates.toSorted((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime()),
    );
    for (const update of updates) {
      open.set(update.userId, this.apply({ open: open.get(update.userId) ?? [], closed, update }));
    }

    // Step 3: 開いている区間を to で閉じる
    for (const interval of [...open.values()].flat()) {
      closed.push({ ...interval, endedAt: args.to });
    }
    return closed;
  }

  /**
   * 1 つの変化を、その user の開いている区間に当て、当てた後に開いている区間を返す。
   * 1. 変化に無い配信の区間を、変化の時刻で閉じる
   * 2. 開いていない配信の区間を、変化の時刻から開く
   */
  private apply(args: {
    open: StreamingInterval[];
    closed: StreamingInterval[];
    update: StreamingUpdate;
  }) {
    const playing = new Set(args.update.streamings.map((streaming) => streaming.key));
    const opened = new Set(args.open.map((interval) => interval.streamingKey));

    // Step 1: 変化に無い配信の区間を、変化の時刻で閉じる
    // 同じ時刻に現れて消えた長さ 0 の区間は残さない。
    for (const interval of args.open) {
      if (!playing.has(interval.streamingKey) && interval.startedAt < args.update.receivedAt) {
        args.closed.push({ ...interval, endedAt: args.update.receivedAt });
      }
    }

    // Step 2: 開いていない配信の区間を、変化の時刻から開く
    // 続いている配信は、タイトルが変わっても区間を切らず、開いたときの値を残す。
    return [
      ...args.open.filter((interval) => playing.has(interval.streamingKey)),
      ...args.update.streamings
        .filter((streaming) => !opened.has(streaming.key))
        .map((streaming) => ({
          userId: args.update.userId,
          streamingKey: streaming.key,
          url: streaming.url,
          name: streaming.name,
          details: streaming.details,
          startedAt: args.update.receivedAt,
          endedAt: args.update.receivedAt,
        })),
    ];
  }
}
