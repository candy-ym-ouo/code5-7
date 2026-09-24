import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_SQL } from './schema.ts';

export class Store {
  readonly db: DatabaseSync;

  constructor(databasePath: string) {
    if (databasePath !== ':memory:') {
      fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    }
    this.db = new DatabaseSync(databasePath);
    this.db.exec(SCHEMA_SQL);
    this.migrate();
  }

  private migrate(): void {
    const samplesColumns = this.db.prepare('PRAGMA table_info(samples)').all() as unknown as Array<{ name: string }>;
    if (!samplesColumns.some((column) => column.name === 'slot')) {
      this.db.exec('ALTER TABLE samples ADD COLUMN slot INTEGER NOT NULL DEFAULT 1');
    }

    const speciesColumns = this.db.prepare('PRAGMA table_info(species_states)').all() as unknown as Array<{ name: string }>;
    if (!speciesColumns.some((column) => column.name === 'capacity_multiplier')) {
      this.db.exec('ALTER TABLE species_states ADD COLUMN capacity_multiplier REAL NOT NULL DEFAULT 1');
    }

    const siteColumns = this.db.prepare('PRAGMA table_info(site_states)').all() as unknown as Array<{ name: string }>;
    if (!siteColumns.some((column) => column.name === 'winter_climate_json')) {
      this.db.exec("ALTER TABLE site_states ADD COLUMN winter_climate_json TEXT NOT NULL DEFAULT 'null'");
    }
  }

  transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }
}
