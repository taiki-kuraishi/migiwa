import { createClient } from "@libsql/client/web";
import * as schema from "@migiwa/db";
import { Result } from "better-result";
import { drizzle } from "drizzle-orm/libsql/web";

import type { Db, Tx } from "./types";

import { DbTransactionError } from "./errors";

/**
 * Turso（libSQL）の DB に繋ぐ。Workers には native の libSQL が無いので、HTTP / WebSocket だけで
 * 繋ぐ web 版の client を使う。
 */
export const createDb = (args: { url: string; authToken: string }) =>
  drizzle({ client: createClient(args), schema });

/**
 * Run を 1 つの transaction の中で走らせ、その Result を返す。run が Err を返せば transaction を取り消して
 * その Err を返し、transaction の開始や確定に失敗すれば DbTransactionError を返す。
 */
export const transaction = async <T, E>(args: {
  db: Db;
  run: (tx: Tx) => Promise<Result<T, E>>;
}) => {
  // Callback の中で書き、取り消しの例外を受けた catch で読む。
  const rolledBack: { result?: Result<T, E> } = {};
  try {
    return await args.db.transaction(async (tx) => {
      const result = await args.run(tx);

      // Drizzle は callback が throw した transaction を取り消し、その例外を投げ直す。
      if (result.isErr()) {
        rolledBack.result = result;
        tx.rollback();
      }
      return result;
    });
  } catch (error) {
    return (
      rolledBack.result ??
      Result.err(new DbTransactionError({ cause: error, message: "Failed to run the transaction" }))
    );
  }
};
