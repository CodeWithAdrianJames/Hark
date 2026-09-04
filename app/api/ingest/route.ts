import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { GoogleGenAI, Type } from '@google/genai';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface IngestMessage {
  id: string;
  text: string;
  sender: string;
  timestamp: string;
  url: string;
}

interface IngestPayload {
  userId: string;
  channelName: string;
  messages: IngestMessage[];
}

interface GeminiExtractionResult {
  is_assignment: boolean;
  title?: string | null;
  description?: string | null;
  due_date_iso?: string | null;
  course_code?: string | null;
}

/**
 * Computes a deterministic SHA-256 hash for duplicate detection.
 */
function computeMessageHash(msg: IngestMessage): string {
  const identifier = msg.id
    ? `msg_id:${msg.id}`
    : `sender:${msg.sender || ''}:ts:${msg.timestamp || ''}:text:${msg.text || ''}`;
  return crypto.createHash('sha256').update(identifier).digest('hex');
}

/**
 * Schema for Gemini structured JSON output
 */
const geminiResponseSchema = {
  type: Type.OBJECT,
  properties: {
    is_assignment: {
      type: Type.BOOLEAN,
      description:
        'True if the message explicitly announces or discusses an academic assignment, homework, project, lab, problem set, quiz, exam, or deadline. False for casual conversations, general questions, or general discussion.',
    },
    title: {
      type: Type.STRING,
      description:
        'Concise, clear deliverable title (e.g., "Homework 4: Binary Trees", "Lab 2 Report"). Empty or null if is_assignment is false.',
      nullable: true,
    },
    description: {
      type: Type.STRING,
      description:
        'Instructions, guidelines, requirements, or submission links mentioned in the message. Empty or null if none.',
      nullable: true,
    },
    due_date_iso: {
      type: Type.STRING,
      description:
        'Strict ISO 8601 timestamp string representing the deadline. Resolve relative references (e.g., "tomorrow 11:59pm", "next Monday at noon") against the message reference timestamp. If only a date is given, default to 23:59:59 on that date.',
      nullable: true,
    },
    course_code: {
      type: Type.STRING,
      description:
        'Inferred course code (e.g., CS101, MATH200, PHYS211) from the message text or channel name, or null if cannot be inferred.',
      nullable: true,
    },
  },
  required: ['is_assignment'],
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<IngestPayload>;
    const { userId, channelName, messages } = body;

    // Validate request payload
    if (!userId || typeof userId !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid "userId" field in request payload.' },
        { status: 400 }
      );
    }

    if (!Array.isArray(messages)) {
      return NextResponse.json(
        { error: 'Missing or invalid "messages" field: must be an array.' },
        { status: 400 }
      );
    }

    if (messages.length === 0) {
      return NextResponse.json([], { status: 200 });
    }

    const sql = getDb();

    // 1. Deduplicate incoming messages locally & compute hashes
    const messageEntries: Array<{ hash: string; msg: IngestMessage }> = [];
    const seenHashesInBatch = new Set<string>();

    for (const msg of messages) {
      if (!msg || (!msg.text && !msg.id)) continue;
      const hash = computeMessageHash(msg);
      if (!seenHashesInBatch.has(hash)) {
        seenHashesInBatch.add(hash);
        messageEntries.push({ hash, msg });
      }
    }

    if (messageEntries.length === 0) {
      return NextResponse.json([], { status: 200 });
    }

    // Query Neon database for existing hashes and raw IDs
    const queryHashes = messageEntries.map((e) => e.hash);
    const queryIds = messageEntries.map((e) => e.msg.id).filter(Boolean);
    const allLookupKeys = Array.from(new Set([...queryHashes, ...queryIds]));

    let existingHashSet = new Set<string>();
    if (allLookupKeys.length > 0) {
      const existingRows = await sql`
        SELECT raw_message_hash
        FROM tasks
        WHERE raw_message_hash = ANY(${allLookupKeys}::text[])
      `;
      existingHashSet = new Set(
        existingRows
          .map((row: Record<string, unknown>) => row.raw_message_hash as string)
          .filter(Boolean)
      );
    }

    // Filter out messages that already exist in the database
    const newMessages = messageEntries.filter(
      (e) => !existingHashSet.has(e.hash) && (!e.msg.id || !existingHashSet.has(e.msg.id))
    );

    if (newMessages.length === 0) {
      return NextResponse.json([], { status: 200 });
    }

    // Initialize Google Gen AI client
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'Server misconfiguration: GEMINI_API_KEY is not set.' },
        { status: 500 }
      );
    }
    const ai = new GoogleGenAI({ apiKey });

    // Fetch user's existing courses from Neon
    const existingCourses = await sql`
      SELECT id, code, channel_id
      FROM courses
      WHERE user_id = ${userId}::uuid
    `;

    const userCourses: Array<{ id: string; code: string; channel_id: string | null }> =
      existingCourses.map((c: Record<string, unknown>) => ({
        id: c.id as string,
        code: c.code as string,
        channel_id: (c.channel_id as string | null) ?? null,
      }));

    // 2 & 3. Process new messages through Gemini 2.5 Flash
    const parsedAssignments: Array<{
      hash: string;
      msg: IngestMessage;
      extraction: GeminiExtractionResult;
    }> = [];

    await Promise.all(
      newMessages.map(async ({ hash, msg }) => {
        const referenceTimestamp = msg.timestamp || new Date().toISOString();
        const prompt = `You are an academic assistant analyzing messages from a university course channel.

Message Details:
- Channel: "${channelName || 'General'}"
- Sender: "${msg.sender || 'Unknown'}"
- Sent Timestamp (Base Reference Time): "${referenceTimestamp}"
- Message URL: "${msg.url || 'N/A'}"

Message Content:
"""
${msg.text}
"""

Task:
Analyze whether this message announces or contains an academic assignment, project, homework, lab, problem set, quiz, exam, or deadline.
- Resolve any relative deadlines (e.g. "tomorrow 11:59pm", "next Tuesday", "in 3 days") relative to the Sent Timestamp ("${referenceTimestamp}"). If no time is specified, default to 23:59:59 on the due date.
- Extract concise title, description (instructions or submission links), due date in ISO 8601 format, and course code if present or inferrable from the message/channel.
- Return false for is_assignment if this is casual communication, greetings, or general Q&A without a clear actionable assignment or deadline.`;

        try {
          const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
              responseMimeType: 'application/json',
              responseSchema: geminiResponseSchema,
              temperature: 0.1,
            },
          });

          const rawText = response.text?.trim() || '{}';
          const extraction = JSON.parse(rawText) as GeminiExtractionResult;

          if (extraction && extraction.is_assignment) {
            parsedAssignments.push({ hash, msg, extraction });
          }
        } catch (err) {
          console.error(`Failed to process message ID ${msg.id} with Gemini:`, err);
        }
      })
    );

    if (parsedAssignments.length === 0) {
      return NextResponse.json([], { status: 200 });
    }

    // 4. Map and insert records into Neon 'tasks'
    const tasksToInsert: Array<{
      user_id: string;
      course_id: string | null;
      title: string;
      description: string | null;
      due_date: string;
      source_type: 'official_assignment' | 'chat_announcement';
      source_url: string | null;
      raw_message_hash: string;
      status: 'pending';
    }> = [];

    for (const { hash, msg, extraction } of parsedAssignments) {
      // Resolve course association
      let courseId: string | null = null;
      const targetCode = extraction.course_code?.trim().toUpperCase();
      const safeChannelName = channelName?.trim();

      if (targetCode || safeChannelName) {
        const matched = userCourses.find(
          (c) =>
            (targetCode && c.code?.toUpperCase() === targetCode) ||
            (safeChannelName && c.channel_id === safeChannelName)
        );

        if (matched) {
          courseId = matched.id;
        } else {
          // Optionally create the course if it doesn't exist yet
          const rawCode = targetCode || safeChannelName || 'COURSE';
          const code = rawCode.toUpperCase().slice(0, 50);
          const name = safeChannelName || code;

          const [newCourse] = await sql`
            INSERT INTO courses (user_id, code, name, channel_id)
            VALUES (${userId}::uuid, ${code}, ${name}, ${safeChannelName || null})
            RETURNING id, code, channel_id
          `;

          if (newCourse) {
            courseId = newCourse.id as string;
            userCourses.push({
              id: newCourse.id as string,
              code: newCourse.code as string,
              channel_id: (newCourse.channel_id as string | null) ?? null,
            });
          }
        }
      }

      // Resolve valid due_date
      let dueDate = extraction.due_date_iso ? new Date(extraction.due_date_iso) : null;
      if (!dueDate || isNaN(dueDate.getTime())) {
        const base = msg.timestamp ? new Date(msg.timestamp) : new Date();
        const baseTime = isNaN(base.getTime()) ? Date.now() : base.getTime();
        dueDate = new Date(baseTime + 7 * 24 * 60 * 60 * 1000);
        dueDate.setHours(23, 59, 59, 0);
      }

      tasksToInsert.push({
        user_id: userId,
        course_id: courseId,
        title: extraction.title?.trim() || 'Untitled Assignment',
        description: extraction.description?.trim() || null,
        due_date: dueDate.toISOString(),
        source_type: 'chat_announcement',
        source_url: msg.url || null,
        raw_message_hash: hash,
        status: 'pending',
      });
    }

    if (tasksToInsert.length === 0) {
      return NextResponse.json([], { status: 200 });
    }

    // Batch insert tasks into Neon database
    const createdTasks = await Promise.all(
      tasksToInsert.map(async (task) => {
        const [insertedRow] = await sql`
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
          ) VALUES (
            ${task.user_id}::uuid,
            ${task.course_id}::uuid,
            ${task.title},
            ${task.description},
            ${task.due_date}::timestamptz,
            ${task.source_type},
            ${task.source_url},
            ${task.raw_message_hash},
            ${task.status}
          )
          RETURNING *
        `;
        return insertedRow;
      })
    );

    // Return 200 with an array of newly created tasks
    return NextResponse.json(createdTasks || [], { status: 200 });
  } catch (error: unknown) {
    console.error('Unhandled error in /api/ingest:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
