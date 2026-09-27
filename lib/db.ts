import { Pool, type PoolClient } from "pg";

const connectionString = process.env.DATABASE_URL;

const globalForDb = globalThis as unknown as { foreseePool?: Pool };

export function getPool(): Pool {
  if (!connectionString) throw new Error("DATABASE_URL is not configured");
  if (!globalForDb.foreseePool) {
    globalForDb.foreseePool = new Pool({
      connectionString,
      max: 5,
      ssl: connectionString.includes("sslmode=disable") ? false : { rejectUnauthorized: false },
    });
  }
  return globalForDb.foreseePool;
}

export async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
