export const hour = 3_600_000;

// 止まっていた後の 1 回で、溜まった時間の event をすべて memory に読まないための上限。cron ごとにこの時間ずつ
// 追いつく。
export const maxHoursPerRun = 24;
