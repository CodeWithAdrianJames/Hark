import { neon } from '@neondatabase/serverless';

/**
 * Returns a configured Neon serverless SQL query function.
 * Uses HTTP-based serverless connections, ideal for Next.js App Router and Edge/Node runtimes.
 */
export function getDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      'Missing DATABASE_URL: Please ensure DATABASE_URL is defined in your environment variables (.env.local).'
    );
  }

  return neon(databaseUrl);
}

export type DbClient = ReturnType<typeof getDb>;
