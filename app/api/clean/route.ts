import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import {
  computeCanonicalTaskHash,
  normalizeCourseCode,
  normalizeTitle,
  REAL_DELIVERABLES,
} from '@/lib/schema';

export const dynamic = 'force-dynamic';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}

function jsonResponse(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: corsHeaders,
  });
}

const DEFAULT_USER_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

/**
 * Executes cleanup and aligns the user's tasks strictly to the 6 real deliverables.
 */
async function performDatabaseClean(targetUserId: string) {
  const sql = getDb();

  // 1. Delete explicit mock tasks
  const mockDeleteResult = await sql`
    DELETE FROM tasks
    WHERE user_id = ${targetUserId}::uuid
      AND (
        title ILIKE '%Case Analysis 1: Agile Sprints in Industry%'
        OR title ILIKE '%Milestone 2 Architecture & Schema Submission%'
        OR title ILIKE '%Case Analysis%'
        OR title ILIKE '%Milestone 2%'
      )
    RETURNING id, title;
  `;

  // 2. Fetch existing courses for this user
  const existingCourses = await sql`
    SELECT id, code, name
    FROM courses
    WHERE user_id = ${targetUserId}::uuid;
  `;

  const courseMap = new Map<string, string>(); // code -> course_id
  for (const c of existingCourses) {
    const code = normalizeCourseCode(c.code as string);
    if (!courseMap.has(code)) {
      courseMap.set(code, c.id as string);
    }
  }

  // Ensure courses exist for all 6 deliverables
  for (const item of REAL_DELIVERABLES) {
    const code = normalizeCourseCode(item.courseCode);
    if (!courseMap.has(code)) {
      try {
        const [newCourse] = await sql`
          INSERT INTO courses (user_id, code, name)
          VALUES (${targetUserId}::uuid, ${code}, ${item.courseBadge})
          RETURNING id;
        `;
        if (newCourse) {
          courseMap.set(code, newCourse.id as string);
        }
      } catch (err) {
        console.warn(`Could not create course ${code}:`, err);
      }
    }
  }

  // 3. Fetch all current tasks for this user
  const currentTasks = await sql`
    SELECT id, title, due_date, raw_message_hash, course_id
    FROM tasks
    WHERE user_id = ${targetUserId}::uuid;
  `;

  // Identify matching tasks for each deliverable and clean up duplicates / stale clones
  const preservedTaskIds = new Set<string>();
  const toDeleteTaskIds: string[] = [];

  for (const def of REAL_DELIVERABLES) {
    const matches = currentTasks.filter((t: any) => {
      const norm = normalizeTitle(t.title);
      return norm.includes(def.titlePattern);
    });

    if (matches.length === 0) {
      // Missing item: insert fresh canonical task
      const courseId = courseMap.get(normalizeCourseCode(def.courseCode)) || null;
      const canonicalHash = computeCanonicalTaskHash(targetUserId, def.courseCode, def.canonicalTitle);

      const specificDeepLink = `https://teams.microsoft.com/l/entity/2a84b049-50bc-4535-a646-5677a8207868/assignments?context=${encodeURIComponent(
        JSON.stringify({ title: def.canonicalTitle, course: def.courseCode })
      )}`;

      const [inserted] = await sql`
        INSERT INTO tasks (
          user_id,
          course_id,
          title,
          description,
          due_date,
          source_type,
          source_url,
          raw_message_hash,
          status
        )
        VALUES (
          ${targetUserId}::uuid,
          ${courseId},
          ${def.canonicalTitle},
          'Extracted from MS Teams EDU Assignments Hub',
          ${def.canonicalDueIso}::timestamptz,
          'official_assignment',
          ${specificDeepLink},
          ${canonicalHash},
          'pending'
        )
        ON CONFLICT (raw_message_hash)
        DO UPDATE SET
          title = EXCLUDED.title,
          due_date = EXCLUDED.due_date,
          course_id = EXCLUDED.course_id,
          source_url = EXCLUDED.source_url
        RETURNING id;
      `;
      if (inserted) {
        preservedTaskIds.add(inserted.id as string);
      }
    } else {
      // Find the best match: prefer the one matching canonicalDueIso or the one with the correct date
      let bestMatch = matches[0];
      const targetTime = new Date(def.canonicalDueIso).getTime();

      for (const m of matches) {
        const mTime = new Date(m.due_date).getTime();
        if (Math.abs(mTime - targetTime) < Math.abs(new Date(bestMatch.due_date).getTime() - targetTime)) {
          bestMatch = m;
        }
      }

      preservedTaskIds.add(bestMatch.id as string);

      // All other duplicates for this deliverable are marked for deletion
      for (const m of matches) {
        if (m.id !== bestMatch.id) {
          toDeleteTaskIds.push(m.id as string);
        }
      }

      // Update best match to canonical due date, course, canonical hash, and specific deep link
      const canonicalHash = computeCanonicalTaskHash(targetUserId, def.courseCode, def.canonicalTitle);
      const courseId = courseMap.get(normalizeCourseCode(def.courseCode)) || bestMatch.course_id;
      const currentUrl = bestMatch.source_url || (bestMatch as any).deep_link || '';
      const isInvalid = !currentUrl ||
        currentUrl.endsWith('/classes/all/list') ||
        currentUrl.endsWith('/classes/all/list/') ||
        currentUrl.includes('/assignments?context=');
      const finalUrl = isInvalid
        ? (def.portalUrl || 'https://teams.microsoft.com/_#/assignments/')
        : currentUrl;

      await sql`
        UPDATE tasks
        SET
          title = ${def.canonicalTitle},
          due_date = ${def.canonicalDueIso}::timestamptz,
          course_id = ${courseId},
          source_url = ${finalUrl},
          deep_link = ${finalUrl},
          raw_message_hash = ${canonicalHash},
          updated_at = NOW()
        WHERE id = ${bestMatch.id}::uuid;
      `;
    }
  }

  // 4. Any task that is NOT one of the 6 real deliverables should also be deleted
  for (const t of currentTasks) {
    if (!preservedTaskIds.has(t.id as string) && !toDeleteTaskIds.includes(t.id as string)) {
      toDeleteTaskIds.push(t.id as string);
    }
  }

  if (toDeleteTaskIds.length > 0) {
    await sql`
      DELETE FROM tasks
      WHERE id = ANY(${toDeleteTaskIds}::uuid[]);
    `;
  }

  // 5. Query and return the clean list of 6 deliverables joined with course information
  const finalTasks = await sql`
    SELECT 
      t.id,
      t.user_id,
      t.course_id,
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
    WHERE t.user_id = ${targetUserId}::uuid
    ORDER BY t.due_date ASC;
  `;

  return {
    success: true,
    deletedMockCount: mockDeleteResult.length,
    deletedCloneCount: toDeleteTaskIds.length,
    cleanTaskCount: finalTasks.length,
    tasks: finalTasks,
  };
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId') || DEFAULT_USER_ID;
    const result = await performDatabaseClean(userId);
    return jsonResponse(result, 200);
  } catch (err: unknown) {
    console.error('[Clean API] Error performing clean:', err);
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return jsonResponse({ error: message }, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const userId = body.userId || DEFAULT_USER_ID;
    const result = await performDatabaseClean(userId);
    return jsonResponse(result, 200);
  } catch (err: unknown) {
    console.error('[Clean API] Error performing clean:', err);
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return jsonResponse({ error: message }, 500);
  }
}
