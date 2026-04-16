/**
 * Production Baseline Seed Runner
 *
 * Executes seed.sql against the configured PostgreSQL database.
 * Safe to run multiple times — all INSERTs use ON CONFLICT DO NOTHING.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... npx tsx backend/src/scripts/run-seed.ts
 *
 * Or set DATABASE_URL in .env first, then:
 *   npx tsx backend/src/scripts/run-seed.ts
 */

import 'dotenv/config';
import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌  DATABASE_URL is not set. Copy .env.example → .env and fill in the values.');
  process.exit(1);
}

const seedPath = path.join(__dirname, '../db/seed.sql');
let seedSql: string;
try {
  seedSql = readFileSync(seedPath, 'utf8');
} catch {
  console.error(`❌  Cannot read seed file at: ${seedPath}`);
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

async function run() {
  const client = await pool.connect();
  try {
    console.log('🌱  Running production seed...');
    console.log(`    Database: ${DATABASE_URL!.replace(/:\/\/[^@]+@/, '://<credentials>@')}`);
    console.log(`    Seed file: ${seedPath}`);
    console.log('');

    await client.query(seedSql);

    // Print row counts to confirm
    const tables = [
      'sectors', 'regions', 'stages', 'column_groups', 'column_catalog',
      'kpi_templates', 'kpi_rules', 'role_definitions', 'role_column_permissions',
      'integrations', 'users',
    ];
    console.log('✅  Seed complete. Final row counts:');
    for (const t of tables) {
      const r = await client.query(`SELECT COUNT(*) FROM ${t}`);
      console.log(`    ${t.padEnd(28)} ${r.rows[0].count} rows`);
    }
  } catch (err: any) {
    console.error('❌  Seed failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(() => process.exit(1));
