import fs from 'node:fs';

console.log('====================================================');
console.log('🧪 Running Extension Security & Lifecycle Test Suite');
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

// 1. Audit SEC-01 & manifest.json checks
console.log('--- 1. Testing Manifest V3 externally_connectable & content_scripts ---');
const manifestRaw = fs.readFileSync('extension/manifest.json', 'utf-8');
const manifest = JSON.parse(manifestRaw);

assert(
  !manifest.externally_connectable.matches.some((m) => m.includes('*.vercel.app')),
  'manifest.json has NO wildcard *.vercel.app in externally_connectable'
);
assert(
  manifest.externally_connectable.matches.includes('http://localhost:3000/*'),
  'manifest.json includes http://localhost:3000/* in externally_connectable'
);
assert(
  manifest.externally_connectable.matches.includes('https://your-production-domain.com/*'),
  'manifest.json includes https://your-production-domain.com/* in externally_connectable'
);
assert(
  manifest.content_scripts.some((cs) => cs.matches.includes('http://localhost:3000/*')),
  'manifest.json content_scripts covers http://localhost:3000/* for broadcast messaging'
);

// 2. Audit SEC-04 & injected.js / content.js checks
console.log('\n--- 2. Testing Cross-Frame Message Security (SEC-04) ---');
const injectedSrc = fs.readFileSync('extension/injected.js', 'utf-8');
const contentSrc = fs.readFileSync('extension/content.js', 'utf-8');

assert(
  !injectedSrc.includes("'*'"),
  'injected.js does NOT use wildcard "*" as postMessage targetOrigin'
);
assert(
  injectedSrc.includes('window.location.origin'),
  'injected.js passes window.location.origin to postMessage'
);

assert(
  contentSrc.includes('event.origin !== window.location.origin'),
  'content.js strictly validates event.origin !== window.location.origin'
);
assert(
  contentSrc.includes('event.source !== window'),
  'content.js strictly validates event.source !== window'
);

// 3. Audit REL-01 & background.js lifecycle checks
console.log('\n--- 3. Testing Service Worker Lifecycle & Termination Resistance (REL-01) ---');
const backgroundSrc = fs.readFileSync('extension/background.js', 'utf-8');

assert(
  !backgroundSrc.includes('let pendingSyncResolvers'),
  'background.js has REMOVED in-memory pendingSyncResolvers array'
);
assert(
  backgroundSrc.includes('chrome.storage.session'),
  'background.js uses chrome.storage.session for pendingSync state'
);
assert(
  backgroundSrc.includes('isAllowedExternalOrigin'),
  'background.js validates external sender origin via isAllowedExternalOrigin'
);
assert(
  backgroundSrc.includes("headers['Authorization'] = `Bearer ${effectiveApiKey}`") ||
    backgroundSrc.includes("Authorization': `Bearer ${effectiveApiKey}`") ||
    backgroundSrc.includes("'Authorization': `Bearer ${effectiveApiKey}`"),
  'background.js includes Authorization: Bearer <API_KEY> header in backend fetch calls'
);
assert(
  backgroundSrc.includes('HARK_SYNC_COMPLETED') && backgroundSrc.includes('chrome.tabs.sendMessage'),
  'background.js broadcasts HARK_SYNC_COMPLETED to tabs via chrome.tabs.sendMessage'
);

// 4. Audit PRF-01 & edu_fiber.js checks
console.log('\n--- 4. Testing DOM MutationObserver Debouncing (PRF-01) ---');
const eduFiberSrc = fs.readFileSync('extension/edu_fiber.js', 'utf-8');

assert(
  eduFiberSrc.includes('debounceTimer'),
  'edu_fiber.js introduces debounceTimer for MutationObserver'
);
assert(
  eduFiberSrc.includes('1500'),
  'edu_fiber.js debounces MutationObserver by 1500ms'
);

console.log('\n====================================================');
if (allPassed) {
  console.log('🎉 ALL EXTENSION REMEDIATION TESTS PASSED 100%!');
} else {
  console.error('❌ SOME TESTS FAILED. Please review output above.');
  process.exit(1);
}
console.log('====================================================');
