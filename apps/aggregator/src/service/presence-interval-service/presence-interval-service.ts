import type { PresenceUpdate } from "../../client/basin-sql-client";
import type { PresenceInterval } from "./types";

import { hour, maxHoursPerRun } from "./constants";

/**
 * Presence の変化を、状態が変わった時刻で切った区間につなぐ。
 */
export class PresenceIntervalService {
  /**
   * まだ集計していない時間を、1 回で maxHoursPerRun 時間まで返す。集計してよいのは、now の delayMinutes 分前を
   * 時の頭に切り捨てた時刻までで、そこまで済んでいれば undefined を返す。初回は、その時刻の 1 時間前から
   * 始める。
   */
  public pendingRange(args: { processedUntil: Date | undefined; now: Date; delayMinutes: number }) {
    const until = Math.floor((args.now.getTime() - args.delayMinutes * 60_000) / hour) * hour;
    const from = args.processedUntil?.getTime() ?? until - hour;
    const to = Math.min(until, from + maxHoursPerRun * hour);

    if (from >= to) {
      return undefined;
    }
    return { from: new Date(from), to: new Date(to) };
  }

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
    const updates = this.orderBySeq(
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
   * 受けた時刻の順に並んだ変化のうち、同じ ms・同じ session で seq のあるものを、それらがいた位置のまま seq の順
   * に並べ替える。ほかの変化は位置を変えない。
   */
  // 同じ ms に届いた変化（RESUME の再送など）は、status の順にすると online → offline が逆になり、offline の
  // user を online のまま延ばしてしまう。seq は session の中でしか比べられないので、比較関数で sort すると別
  // session や seq の無い変化を挟んだときに順序が推移的でなくなる。位置ごとに入れ替えて、挟まれても seq の順に
  // する。
  private orderBySeq(updates: PresenceUpdate[]) {
    const ordered = [...updates];
    const groups = Map.groupBy(
      ordered.flatMap((update, position) =>
        update.seq === null ? [] : [{ update, position, seq: update.seq }],
      ),
      ({ update }) => `${update.receivedAt.getTime()}/${update.sessionId}`,
    );
    for (const group of groups.values()) {
      const positions = group.map(({ position }) => position);
      const bySeq = group.toSorted((a, b) => a.seq - b.seq);
      for (const [index, { update }] of bySeq.entries()) {
        ordered.splice(positions[index] ?? ordered.length, 1, update);
      }
    }
    return ordered;
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
