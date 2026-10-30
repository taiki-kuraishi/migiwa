const hour = 3_600_000;

// 止まっていた後の 1 回で、溜まった時間の event をすべて memory に読まないための上限。cron ごとにこの時間ずつ
// 追いつく。
const maxHoursPerRun = 24;

/**
 * まだ集計していない時間を、1 回で maxHoursPerRun 時間まで返す。集計してよいのは、now の delayMinutes 分前を
 * 時の頭に切り捨てた時刻までで、そこまで済んでいれば undefined を返す。初回は、その時刻の 1 時間前から
 * 始める。
 */
export const pendingRange = (args: {
  processedUntil: Date | undefined;
  now: Date;
  delayMinutes: number;
}) => {
  const until = Math.floor((args.now.getTime() - args.delayMinutes * 60_000) / hour) * hour;
  const from = args.processedUntil?.getTime() ?? until - hour;
  const to = Math.min(until, from + maxHoursPerRun * hour);

  if (from >= to) {
    return undefined;
  }
  return { from: new Date(from), to: new Date(to) };
};
