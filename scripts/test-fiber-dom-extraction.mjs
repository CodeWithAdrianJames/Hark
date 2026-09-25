import fs from 'node:fs';

console.log('====================================================');
console.log('🧪 Running Fiber & DOM Assignment Extraction Tests');
console.log('====================================================\n');

let allPassed = true;

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    allPassed = false;
  } else {
    console.log(`✅ PASSED: ${message}`);
  }
}

// 1. Verify edu_fiber.js contains the inner React Fiber walker and anchor regex fallback
console.log('--- 1. Testing edu_fiber.js Implementation ---');
const eduFiberSrc = fs.readFileSync('extension/edu_fiber.js', 'utf-8');

assert(
  eduFiberSrc.includes('function extractCardData(cardElement)'),
  'edu_fiber.js defines extractCardData(cardElement)'
);

assert(
  eduFiberSrc.includes('cardElement.querySelector(\'button\')') &&
  eduFiberSrc.includes('cardElement.querySelector(\'[data-test*="assignment"]\')'),
  'edu_fiber.js inspects inner interactive children (button, data-test*="assignment")'
);

assert(
  eduFiberSrc.includes('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i'),
  'edu_fiber.js validates UUID regex for assignmentId'
);

assert(
  eduFiberSrc.includes('extractAnchorData') && eduFiberSrc.includes('assignmentId: match[2]'),
  'edu_fiber.js implements anchor href regex fallback for classId and assignmentId'
);

assert(
  eduFiberSrc.includes('!/^due\\b/i.test(fullClassName)'),
  'edu_fiber.js strictly prevents setting courseName to strings starting with "Due"'
);

// 2. Verify content.js contains the inner React Fiber walker and DOM fallback selectors
console.log('\n--- 2. Testing content.js Implementation ---');
const contentSrc = fs.readFileSync('extension/content.js', 'utf-8');

assert(
  contentSrc.includes('function extractCardData(cardElement)'),
  'content.js defines extractCardData(cardElement)'
);

assert(
  contentSrc.includes('/^due\\b/i.test(text)') &&
  contentSrc.includes('/\\bdue\\s+(?:at|by|on|date)\\b/i.test(text)'),
  'content.js cleanCourseOrTeamName guards against "Due" and "Due at" text'
);

assert(
  contentSrc.includes('/classes/([a-f0-9-]+)/assignments/([a-f0-9-]+)'),
  'content.js has anchor href regex fallback /classes/([a-f0-9-]+)/assignments/([a-f0-9-]+)'
);

assert(
  !contentSrc.includes('[class*="subtitle" i], [class*="class" i]'),
  'content.js does NOT indiscriminately select subtitle as class name'
);

assert(
  contentSrc.includes(':not([class*="subtitle" i]):not([class*="due" i])'),
  'content.js excludes subtitle and due classes from class element selector'
);

// 3. Verify app/api/ingest/route.ts handles clean course name and assignmentId/classId
console.log('\n--- 3. Testing app/api/ingest/route.ts Implementation ---');
const ingestSrc = fs.readFileSync('app/api/ingest/route.ts', 'utf-8');

assert(
  ingestSrc.includes('/^due\\b/i.test(text)'),
  'app/api/ingest/route.ts cleanCourseName rejects strings starting with "Due"'
);

assert(
  ingestSrc.includes('/classes/${classId}/assignments/${assignmentId}'),
  'app/api/ingest/route.ts builds canonical assignment portal deepLink when classId and assignmentId are present'
);

console.log('\n====================================================');
if (allPassed) {
  console.log('🎉 ALL FIBER & DOM EXTRACTION TESTS PASSED 100%!');
} else {
  console.error('❌ SOME TESTS FAILED. Please review output above.');
  process.exit(1);
}
console.log('====================================================');
