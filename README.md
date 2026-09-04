# Academic Assignment Ingestion Engine

An automated pipeline built with Next.js (App Router), Neon Serverless PostgreSQL (`@neondatabase/serverless`), and Google Gemini (`@google/genai` model `gemini-2.5-flash`) to detect, extract, and track assignments, labs, projects, and deadlines from university communication channels (Discord, Slack, Canvas, Teams).

---

## 1. Setup & Environment Variables

Copy `.env.example` to `.env.local` and populate the required keys:

```bash
cp .env.example .env.local
```

```env
# Google Gen AI API Key (Gemini 2.5 Flash)
GEMINI_API_KEY=your_google_gemini_api_key

# Neon Serverless PostgreSQL Connection String
DATABASE_URL=postgresql://username:password@ep-sample-123456.us-east-2.aws.neon.tech/neondb?sslmode=require
```

---

## 2. Database Migration (Neon)

Run the SQL migration in your [Neon Console](https://console.neon.tech) SQL Editor:

- Schema file: [`migrations/0001_init_schema.sql`](file:///c:/Users/Adrian/Documents/01_Programming/Active_Projects/Personal/Hark/migrations/0001_init_schema.sql)

It configures:
- Tables: `users`, `courses`, `tasks`
- Primary keys: UUIDs with `gen_random_uuid()`
- Foreign keys with `ON DELETE CASCADE`
- Performance indexes on `user_id`, `due_date`, `status`, `channel_id`, and `raw_message_hash`
- Deduplication constraint on `tasks.raw_message_hash`

---

## 3. Ingestion API Endpoint

### `POST /api/ingest`

Accepts a batch of channel messages and extracts actionable academic tasks.

#### Request Payload
```json
{
  "userId": "d3b07384-d113-4687-991c-b5f7e6f368f5",
  "channelName": "cs106b-announcements",
  "messages": [
    {
      "id": "msg_987654321",
      "text": "Hi everyone! Homework 3 on Binary Trees has just been posted. It is due next Friday at 11:59 PM on Gradescope: https://gradescope.com/courses/12345/assignments/67890",
      "sender": "Prof. Smith",
      "timestamp": "2026-09-04T10:00:00Z",
      "url": "https://discord.com/channels/123/456/789"
    }
  ]
}
```

#### Pipeline Steps:
1. **Deduplication**: Computes a SHA-256 hash (`raw_message_hash`) from message identifiers/content and checks against existing records in `tasks` using Neon's serverless driver.
2. **Gemini Extraction**: Analyzes new messages with `@google/genai` and `gemini-2.5-flash` using structured JSON `responseSchema`:
   - `is_assignment`: boolean
   - `title`: concise assignment title
   - `description`: instructions and submission links
   - `due_date_iso`: ISO 8601 deadline resolved against message timestamp
   - `course_code`: course code inferred from channel name or text
3. **Database Insertion**: Inserts valid assignments into the Neon `tasks` table mapped to the user and course.
4. **Response**: Returns HTTP 200 with an array of created task records.
