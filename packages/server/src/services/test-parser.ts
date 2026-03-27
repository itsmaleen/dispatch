#!/usr/bin/env bun
/**
 * Test script to parse a real .jsonl file and see what we're getting
 */

import { parseSessionToHistoryString } from './claude-session-parser';

const sessionFilePath = process.argv[2];

if (!sessionFilePath) {
  console.error('Usage: bun test-parser.ts <path-to-jsonl-file>');
  process.exit(1);
}

console.log('Parsing session file:', sessionFilePath);
console.log('---');

parseSessionToHistoryString(sessionFilePath)
  .then(history => {
    console.log('\n=== PARSED HISTORY ===\n');
    console.log(history);
    console.log('\n=== STATS ===');
    console.log('History length:', history.length, 'chars');
    console.log('Line count:', history.split('\n').length);
  })
  .catch(err => {
    console.error('Parse error:', err);
    process.exit(1);
  });
