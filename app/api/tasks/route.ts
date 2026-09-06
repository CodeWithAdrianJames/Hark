import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}

/**
 * GET /api/tasks?userId=<uuid>
 * Fetches all tasks for the user with associated course codes, plus all courses.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId');

  if (!userId) {
    return NextResponse.json(
      { error: 'Missing "userId" query parameter.' },
      { status: 400, headers: corsHeaders }
    );
  }

  try {
    const sql = getDb();

    // Query tasks joined with course details
    const tasks = await sql`
      SELECT 
        t.id,
        t.user_id,
        t.course_id,
        t.assignment_id,
        t.title,
        t.description,
        t.due_date,
        t.source_type,
        t.source_url,
        COALESCE(t.deep_link, t.source_url) AS deep_link,
        t.raw_message_hash,
        t.status,
        t.created_at,
        c.code AS course_code,
        c.name AS course_name
      FROM tasks t
      LEFT JOIN courses c ON t.course_id = c.id
      WHERE t.user_id = ${userId}::uuid
      ORDER BY t.due_date ASC, t.created_at DESC;
    `;

    // Query all courses for course filters
    const courses = await sql`
      SELECT id, code, name, channel_id
      FROM courses
      WHERE user_id = ${userId}::uuid
      ORDER BY code ASC;
    `;

    return NextResponse.json({ tasks, courses }, { status: 200, headers: corsHeaders });
  } catch (err: unknown) {
    console.error('Error fetching tasks from Neon:', err);
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500, headers: corsHeaders });
  }
}

/**
 * PATCH /api/tasks
 * Updates the status of an existing task ('pending', 'in_progress', 'completed').
 */
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, status } = body;

    if (!id || !['pending', 'in_progress', 'completed'].includes(status)) {
      return NextResponse.json(
        { error: 'Invalid payload: "id" and a valid "status" (pending, in_progress, completed) are required.' },
        { status: 400, headers: corsHeaders }
      );
    }

    const sql = getDb();
    const [updatedTask] = await sql`
      UPDATE tasks
      SET status = ${status}
      WHERE id = ${id}::uuid
      RETURNING *;
    `;

    if (!updatedTask) {
      return NextResponse.json(
        { error: 'Task not found with the provided ID.' },
        { status: 404, headers: corsHeaders }
      );
    }

    return NextResponse.json(updatedTask, { status: 200, headers: corsHeaders });
  } catch (err: unknown) {
    console.error('Error updating task status in Neon:', err);
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500, headers: corsHeaders });
  }
}
