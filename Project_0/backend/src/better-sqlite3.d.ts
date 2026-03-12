declare module 'better-sqlite3' {
  namespace Database {
    interface RunResult {
      changes: number;
      lastInsertRowid: number | bigint;
    }

    interface Statement<Result = any> {
      run(...params: any[]): RunResult;
      get(...params: any[]): Result;
      all(...params: any[]): Result[];
    }

    interface Transaction<Args extends any[] = any[], Result = unknown> {
      (...args: Args): Result;
    }

    interface Database {
      pragma(statement: string): unknown;
      exec(sql: string): void;
      prepare<Result = any>(sql: string): Statement<Result>;
      transaction<Args extends any[] = any[], Result = unknown>(
        fn: (...args: Args) => Result
      ): Transaction<Args, Result>;
      close(): void;
    }
  }

  class Database implements Database.Database {
    constructor(filename: string, options?: Record<string, unknown>);
    pragma(statement: string): unknown;
    exec(sql: string): void;
    prepare<Result = any>(sql: string): Database.Statement<Result>;
    transaction<Args extends any[] = any[], Result = unknown>(
      fn: (...args: Args) => Result
    ): Database.Transaction<Args, Result>;
    close(): void;
  }

  export = Database;
}
