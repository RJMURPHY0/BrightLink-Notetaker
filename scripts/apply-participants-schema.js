// One-off: add MeetingParticipant plus the Recording columns the one-click
// capture paths need. Same DDL as a migration would emit; lib/ensure-schema.ts
// is a no-op unless RUN_SCHEMA_CHECK=1, so new columns need an explicit run.
//
//   node scripts/apply-participants-schema.js
//
// Entirely additive. Existing rows read captureMethod = NULL, which every
// caller treats as 'web' — the behaviour they were recorded under.
const { readFileSync } = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

function envLocal(key) {
  const txt = readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
  const m = txt.match(new RegExp(`^${key}=(.*)$`, 'm'));
  if (!m) throw new Error(`${key} not in .env.local`);
  return m[1].trim().replace(/^["']|["']$/g, '');
}

const url = process.env.DATABASE_URL || envLocal('DATABASE_URL');
const prisma = new PrismaClient({ datasources: { db: { url } } });

const STATEMENTS = [
  `ALTER TABLE "Recording" ADD COLUMN IF NOT EXISTS "captureMethod" TEXT`,
  `ALTER TABLE "Recording" ADD COLUMN IF NOT EXISTS "recallBotId" TEXT`,
  `ALTER TABLE "Recording" ADD COLUMN IF NOT EXISTS "meetingUrl" TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Recording_recallBotId_key"
     ON "Recording" ("recallBotId") WHERE "recallBotId" IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS "MeetingParticipant" (
     "id"            TEXT PRIMARY KEY,
     "recordingId"   TEXT NOT NULL,
     "name"          TEXT NOT NULL,
     "platformId"    TEXT,
     "isHost"        BOOLEAN NOT NULL DEFAULT false,
     "origin"        TEXT NOT NULL,
     "speakingSpans" JSONB NOT NULL DEFAULT '[]'::jsonb,
     "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "MeetingParticipant_recordingId_name_origin_key"
     ON "MeetingParticipant" ("recordingId", "name", "origin")`,
  `CREATE INDEX IF NOT EXISTS "MeetingParticipant_recordingId_idx"
     ON "MeetingParticipant" ("recordingId")`,
];

async function main() {
  for (const sql of STATEMENTS) {
    await prisma.$executeRawUnsafe(sql);
    console.log('ok  ', sql.split('\n')[0].slice(0, 78));
  }

  // The FK is added separately: it is the one statement that can fail on a
  // database with orphaned rows, and failing it must not undo the rest.
  try {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "MeetingParticipant"
         ADD CONSTRAINT "MeetingParticipant_recordingId_fkey"
         FOREIGN KEY ("recordingId") REFERENCES "Recording"("id") ON DELETE CASCADE`,
    );
    console.log('ok   FK MeetingParticipant -> Recording');
  } catch (e) {
    if (/already exists|duplicate/i.test(e.message)) console.log('ok   FK already present');
    else throw e;
  }

  const cols = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'MeetingParticipant' ORDER BY ordinal_position`,
  );
  console.log('\nMeetingParticipant columns:', cols.map((c) => c.column_name).join(', '));

  const rec = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'Recording'
        AND column_name IN ('captureMethod', 'recallBotId', 'meetingUrl')`,
  );
  console.log('Recording additions:', rec.map((c) => c.column_name).join(', '));
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
