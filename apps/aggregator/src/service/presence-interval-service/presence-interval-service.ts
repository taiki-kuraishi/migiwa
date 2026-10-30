import type { PresenceUpdate } from "../../client/basin-sql-client";
import type { PresenceInterval } from "./types";

import { orderBySeq } from "../../utils/order-by-seq";

/**
 * Presence の変化を、状態が変わった時刻で切った区間につなぐ。
 */
export class PresenceIntervalService {
  /**
   * [from, to) の presence の変化を、from で閉じた各 user の区間から順につなぎ、書く区間を返す。from で閉じた
   * 区間が続くなら、同じ開始時刻で終了時刻を延ばした区間として返す。
   * 1. From で閉じた区間は、event が無ければその状態のまま続いているとみなして開いておく
   * 2. 変化を時刻の順にたどり、状態が変われば開いている区間を閉じて新しい区間を開く
   * 3. 開いている区間を to で閉じる
   */
  public connect(args: {
    from: Date;
    to: Date;
    closedAtFrom: PresenceInterval[];
    updates: PresenceUpdate[];
  }) {
    const closed: PresenceInterval[] = [];

    // Step 1: From で閉じた区間は、event が無ければその状態のまま続いているとみなして開いておく
    const open = new Map(args.closedAtFrom.map((interval) => [interval.userId, interval]));

    // Step 2: 変化を時刻の順にたどり、状態が変われば開いている区間を閉じて新しい区間を開く
    const updates = orderBySeq(
      args.updates.toSorted((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime()),
    );
    for (const update of updates) {
      this.apply({ open, closed, update });
    }

    // Step 3: 開いている区間を to で閉じる
    for (const interval of open.values()) {
      closed.push({ ...interval, endedAt: args.to });
    }
    return closed;
  }

  /**
   * 1 つの変化を、その user の開いている区間に当てる。
   * 1. 開いている区間と同じ状態なら、区間を切らずにつなげる
   * 2. 開いている区間があれば、変化の時刻で閉じる
   * 3. 変化の時刻から新しい区間を開く
   */
  private apply(args: {
    open: Map<string, PresenceInterval>;
    closed: PresenceInterval[];
    update: PresenceUpdate;
  }) {
    const current = args.open.get(args.update.userId);

    // Step 1: 開いている区間と同じ状態なら、区間を切らずにつなげる
    // Activity だけの変化や、ほかの server から届いた同じ変化がこれにあたる。
    if (current?.status === args.update.status) {
      return;
    }

    // Step 2: 開いている区間があれば、変化の時刻で閉じる
    // 同じ時刻に別の状態が届いて長さが 0 になった区間は残さない（開始時刻が次の区間と重なる）。
    if (current !== undefined && current.startedAt < args.update.receivedAt) {
      args.closed.push({ ...current, endedAt: args.update.receivedAt });
    }

    // Step 3: 変化の時刻から新しい区間を開く
    args.open.set(args.update.userId, {
      userId: args.update.userId,
      status: args.update.status,
      startedAt: args.update.receivedAt,
      endedAt: args.update.receivedAt,
    });
  }
}
