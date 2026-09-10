import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}

/**
 * GET /api/courses?userId=<uuid>&activeOnly=true
 * Returns active student enrolled courses filtered strictly from ghost/archived channels.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId') || 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    const activeOnly = searchParams.get('activeOnly') !== 'false';

    const sql = getDb();

    // Query courses strictly filtering out phantom courses (e.g. MAIN / Main Channels)
    // and optionally filtering to courses that have active/past-due deliverables
    const courses = activeOnly
      ? await sql`
          SELECT 
            c.id, 
            c.code, 
            c.name, 
            c.channel_id,
            c.created_at,
            COUNT(t.id)::int AS task_count
          FROM courses c
          LEFT JOIN tasks t ON t.course_id = c.id
          WHERE c.user_id = ${userId}::uuid
            AND c.code != 'MAIN'
            AND c.name NOT ILIKE '%main channels%'
            AND c.name NOT ILIKE '%teams and channels%'
          GROUP BY c.id, c.code, c.name, c.channel_id, c.created_at
          HAVING COUNT(t.id) > 0
          ORDER BY c.code ASC;
        `
      : await sql`
          SELECT 
            c.id, 
            c.code, 
            c.name, 
            c.channel_id,
            c.created_at,
            COUNT(t.id)::int AS task_count
          FROM courses c
          LEFT JOIN tasks t ON t.course_id = c.id
          WHERE c.user_id = ${userId}::uuid
            AND c.code != 'MAIN'
            AND c.name NOT ILIKE '%main channels%'
            AND c.name NOT ILIKE '%teams and channels%'
          GROUP BY c.id, c.code, c.name, c.channel_id, c.created_at
          ORDER BY c.code ASC;
        `;

    return NextResponse.json({ courses, count: courses.length }, { status: 200, headers: corsHeaders });
  } catch (err: unknown) {
    console.error('Error in /api/courses:', err);
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500, headers: corsHeaders });
  }
}
