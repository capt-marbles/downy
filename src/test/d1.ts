import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync } from "node:fs";

// Execute real SQLite SQL, including guarded updates; no query-string mocks.
export function testDb(migrations: string[]): D1Database {
  const db = new DatabaseSync(":memory:");
  for (const file of migrations)
    db.exec(readFileSync(`migrations/${file}`, "utf8"));
  // This SQLite test double implements only D1 methods exercised by the tests.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  return {
    async batch(statements: D1PreparedStatement[]) {
      db.exec("BEGIN");
      try {
        const results = await Promise.all(
          statements.map((statement) => statement.run()),
        );
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    prepare(sql: string) {
      const stmt = db.prepare(sql);
      let values: SQLInputValue[] = [];
      const query = {
        bind(...args: SQLInputValue[]) {
          values = args;
          return query;
        },
        async first() {
          return stmt.get(...values) ?? null;
        },
        async all() {
          return { results: stmt.all(...values), success: true };
        },
        async run() {
          return {
            meta: { changes: Number(stmt.run(...values).changes) },
            success: true,
          };
        },
      };
      return query;
    },
  } as unknown as D1Database;
}
