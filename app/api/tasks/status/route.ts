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
 * Handles status and completion state mutations for a specific task.
 * Strictly scopes database update to (id, user_id) to eliminate IDOR vulnerabilities (SEC-03).
 */
async function handleStatusUpdate(req: NextRequest) {
  try {
    const body = await req.json();
    const taskId = body.taskId || body.id;
    const userId = body.userId || body.user_id;
    const { completed, status } = body;

    if (!taskId || !userId) {
      return NextResponse.json(
        { error: 'Missing required fields: Both "taskId" (or "id") and "userId" are required.' },
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
        { error: 'Provide either "completed" (boolean) or valid "status".' },
        { status: 400, headers: corsHeaders }
      );
    }

    if (!updatedTask) {
      return NextResponse.json(
        { error: 'Task not found or not owned by user.' },
        { status: 404, headers: corsHeaders }
      );
    }

    return NextResponse.json(
      { success: true, task: updatedTask },
      { status: 200, headers: corsHeaders }
    );
  } catch (err: unknown) {
    console.error('Error updating task in /api/tasks/status:', err);
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500, headers: corsHeaders });
  }
}

export async function PATCH(req: NextRequest) {
  return handleStatusUpdate(req);
}

export async function POST(req: NextRequest) {
  return handleStatusUpdate(req);
}
