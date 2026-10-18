// 配列の中の ID は拾わず、最初に見つかった経路の値を使う。
export const userIdPaths = [
  ["user", "id"],
  ["user_id"],
  ["author", "id"],
  ["member", "user", "id"],
];

export const sendTimeout = 10_000;
