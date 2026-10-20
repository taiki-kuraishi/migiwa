import { createClient } from "@libsql/client";
import * as schema from "@migiwa/db";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

/**
 * 本番と同じ migration を当てた in-memory の空の DB を作り、test の終わりに閉じる。schema から push すると、
 * migration の書き忘れを見逃す。
 */
// 呼ぶ側から test の終了処理を受け取り、接続を確実に閉じる。
export const createTestDb = async (args: { onTestFinished: (cleanup: () => void) => void }) => {
  // Libsql は transaction を始めると次の query から接続を作り直すので、ただの :memory: では transaction の
  // 後に中身が消える。共有 cache の :memory: にし、test の間は別の接続を開けたままにして中身を残す。
  // 共有 cache は process の中の全接続で 1 つなので、test を並行に走らせない（file は別 process で走る）。
  const url = "file::memory:?cache=shared";
  const keeper = createClient({ url });
  const client = createClient({ url });
  args.onTestFinished(() => {
    client.close();
    keeper.close();
  });
  const db = drizzle({ client, schema });
  await migrate(db, {
    migrationsFolder: new URL("../../../../packages/db/drizzle", import.meta.url).pathname,
  });
  // Libsql は transaction の接続を閉じないので、前の test の DB が残っている。行を消して空から始める。
  await Promise.all(Object.values(schema).map(async (table) => db.delete(table)));
  return db;
};
