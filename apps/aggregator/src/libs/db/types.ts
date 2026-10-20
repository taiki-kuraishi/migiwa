import type * as schema from "@migiwa/db";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { LibSQLDatabase, LibSQLTransaction } from "drizzle-orm/libsql";

// Native と web の client で同じ repository を使えるよう、client の種類を型に含めない。
export type Db = LibSQLDatabase<typeof schema>;

export type Tx = LibSQLTransaction<typeof schema, ExtractTablesWithRelations<typeof schema>>;
