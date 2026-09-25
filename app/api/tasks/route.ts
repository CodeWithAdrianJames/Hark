import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PATCH, POST, OPTIONS',
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

    // Query tasks joined with course details using composite ordering index (PRF-03)
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
        COALESCE(t.is_completed, t.status = 'completed') AS is_completed,
        COALESCE(t.is_completed, t.status = 'completed') AS completed,
        t.created_at,
        c.code AS course_code,
        c.name AS course_name,
        c.channel_id AS class_id
      FROM tasks t
      LEFT JOIN courses c ON t.course_id = c.id
      WHERE t.user_id = ${userId}::uuid
      ORDER BY t.due_date ASC, t.created_at DESC;
    `;

    // Query active student enrolled courses for course view and filters (filtering ghost/phantom courses)
    const courses = await sql`
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
 * Updates the status or completion state of an existing task.
 * Accepts: { id, status, userId }, { taskId, completed, userId }, or { id, completed, userId }
 * Strictly scopes mutation to (id, user_id) to eliminate IDOR vulnerabilities (SEC-03).
 */
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const taskId = body.taskId || body.id;
    const userId = body.userId || body.user_id;
    const { status, completed } = body;

    if (!taskId || !userId) {
      return NextResponse.json(
        { error: 'Invalid payload: Both "taskId" (or "id") and "userId" are required.' },
        { status: 400, headers: corsHeaders }
      );
    }

    const sql = getDb();
    let updatedTask;

    if (completed !== undefined) {
      const isComp = Boolean(completed);
      const newStatus = isComp ? 'completed' : 'pending';
      [updatedTask] = await sql`
        UPDATE tasks
        SET 
          is_completed = ${isComp},
          status = ${newStatus}
        WHERE id = ${taskId}::uuid
          AND user_id = ${userId}::uuid
        RETURNING *;
      `;
    } else if (status && ['pending', 'in_progress', 'completed'].includes(status)) {
      const isComp = status === 'completed';
      [updatedTask] = await sql`
        UPDATE tasks
        SET 
          status = ${status},
          is_completed = ${isComp}
        WHERE id = ${taskId}::uuid
          AND user_id = ${userId}::uuid
        RETURNING *;
      `;
    } else {
      return NextResponse.json(
        { error: 'Invalid payload: provide either a boolean "completed" or valid "status".' },
        { status: 400, headers: corsHeaders }
      );
    }

    if (!updatedTask) {
      return NextResponse.json(
        { error: 'Task not found or not owned by user.' },
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
