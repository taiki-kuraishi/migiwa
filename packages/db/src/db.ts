import type { LibSQLDatabase } from "drizzle-orm/libsql";

import { createClient } from "@libsql/client/web";
import { drizzle } from "drizzle-orm/libsql/web";

import * as schema from "./schema";

/**
 * Repository が受け取る DB。test の in-memory の DB もこの型で渡せるよう、client の種類を含めない。
 */
export type Db = LibSQLDatabase<typeof schema>;

/**
 * Turso（libSQL）の DB に繋ぐ。Workers には native の libSQL が無いので、HTTP / WebSocket だけで
 * 繋ぐ web 版の client を使う。
 */
export const createDb = (args: { url: string; authToken: string }) =>
  drizzle({ client: createClient(args), schema });
