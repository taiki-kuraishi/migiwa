import type { CustomStatusUpdate } from "../../client/basin-sql-client";
import type { CustomStatusInterval } from "./types";

import { orderBySeq } from "../../utils/order-by-seq";

/**
 * 各 user のカスタムステータスの変化を、カスタムステータスが現れた時刻と消えた時刻で切った区間につなぐ。
 */
export class CustomStatusIntervalService {
  /**
   * [from, to) の変化を、from で閉じた各 user・カスタムステータスの区間から順につなぎ、書く区間を返す。from で閉じた区間が
   * 続くなら、同じ開始時刻で終了時刻を延ばした区間として返す。
   * 1. From で閉じた区間は、event が無ければそのカスタムステータスを続けているとみなして開いておく
   * 2. 変化を時刻の順にたどり、消えたカスタムステータスの区間を閉じ、現れたカスタムステータスの区間を開く
   * 3. 開いている区間を to で閉じる
   */
  public connect(args: {
    from: Date;
    to: Date;
    closedAtFrom: CustomStatusInterval[];
    updates: CustomStatusUpdate[];
  }) {
    const closed: CustomStatusInterval[] = [];

    // Step 1: From で閉じた区間は、event が無ければそのカスタムステータスを続けているとみなして開いておく
    const open = Map.groupBy(args.closedAtFrom, (interval) => interval.userId);

    // Step 2: 変化を時刻の順にたどり、消えたカスタムステータスの区間を閉じ、現れたカスタムステータスの区間を開く
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
   * 1. 変化に無いカスタムステータスの区間を、変化の時刻で閉じる
   * 2. 開いていないカスタムステータスの区間を、変化の時刻から開く
   */
  private apply(args: {
    open: CustomStatusInterval[];
    closed: CustomStatusInterval[];
    update: CustomStatusUpdate;
  }) {
    const playing = new Set(args.update.customStatuses.map((customStatus) => customStatus.state));
    const opened = new Set(args.open.map((interval) => interval.state));

    // Step 1: 変化に無いカスタムステータスの区間を、変化の時刻で閉じる
    // 同じ時刻に現れて消えた長さ 0 の区間は残さない。
    for (const interval of args.open) {
      if (!playing.has(interval.state) && interval.startedAt < args.update.receivedAt) {
        args.closed.push({ ...interval, endedAt: args.update.receivedAt });
      }
    }

    // Step 2: 開いていないカスタムステータスの区間を、変化の時刻から開く
    return [
      ...args.open.filter((interval) => playing.has(interval.state)),
      ...args.update.customStatuses
        .filter((customStatus) => !opened.has(customStatus.state))
        .map((customStatus) => ({
          userId: args.update.userId,
          state: customStatus.state,
          startedAt: args.update.receivedAt,
          endedAt: args.update.receivedAt,
        })),
    ];
  }
}
