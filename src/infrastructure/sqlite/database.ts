import { chmodSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { applyMigrations, type MigrationOptions } from './migrations.js';

export interface IntegrityResult {
  readonly ok: boolean;
  readonly integrityMessages: readonly string[];
  readonly foreignKeyViolations: number;
}

interface IntegrityRow {
  readonly integrity_check: string;
}

function isThenable(value: unknown): boolean {
  if (
    value === null ||
    (typeof value !== 'object' && typeof value !== 'function')
  )
    return false;
  try {
    return typeof Reflect.get(value, 'then') === 'function';
  } catch {
    return true;
  }
}

/** Infrastructure-only SQLite lifecycle with bounded synchronous transactions. */
export class SqliteDatabase implements Disposable {
  readonly connection: DatabaseSync;

  constructor(
    readonly databasePath: string,
    options: {
      readonly migration: MigrationOptions;
      readonly timeoutMs?: number;
    },
  ) {
    this.connection = new DatabaseSync(databasePath, {
      allowExtension: false,
      defensive: true,
      enableDoubleQuotedStringLiterals: false,
      enableForeignKeyConstraints: true,
      timeout: options.timeoutMs ?? 2_000,
    });
    try {
      if (databasePath !== ':memory:') chmodSync(databasePath, 0o600);
      this.connection.exec('PRAGMA foreign_keys = ON');
      this.connection.exec('PRAGMA trusted_schema = OFF');
      applyMigrations(this.connection, options.migration);
    } catch (error) {
      this.connection.close();
      throw error;
    }
  }

  transaction<Value>(operation: () => Value): Value {
    if (this.connection.isTransaction) {
      throw new Error('nested-sqlite-transaction-not-supported');
    }
    try {
      this.connection.exec('BEGIN IMMEDIATE');
      const value = operation();
      if (isThenable(value)) {
        throw new Error('async-sqlite-transaction-not-supported');
      }
      this.connection.exec('COMMIT');
      return value;
    } catch (error) {
      if (this.connection.isTransaction) this.connection.exec('ROLLBACK');
      throw error;
    }
  }

  integrityCheck(): IntegrityResult {
    const rows = this.connection
      .prepare('PRAGMA integrity_check')
      .all() as unknown as readonly IntegrityRow[];
    const messages = rows.map((row) => String(row.integrity_check));
    const foreignKeys = this.connection
      .prepare('PRAGMA foreign_key_check')
      .all();
    return {
      ok:
        messages.length === 1 &&
        messages[0] === 'ok' &&
        foreignKeys.length === 0,
      integrityMessages: messages,
      foreignKeyViolations: foreignKeys.length,
    };
  }

  close(): void {
    if (this.connection.isOpen) this.connection.close();
  }

  [Symbol.dispose](): void {
    this.close();
  }
}
