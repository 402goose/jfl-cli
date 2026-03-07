declare module 'inquirer';
declare module 'sql.js' {
  interface Database {
    run(sql: string, params?: any[]): Database;
    exec(sql: string, params?: any[]): any[];
    prepare(sql: string): any;
    close(): void;
    export(): Uint8Array;
  }
  interface SqlJsStatic {
    Database: new (data?: ArrayLike<number>) => Database;
  }
  export type { Database };
  export default function initSqlJs(config?: any): Promise<SqlJsStatic>;
}
