/**
 * scripts/health-check.ts — CLI version of /api/health.
 * Run with: npm run health
 *
 * Prints a compact pass/fail table and exits non-zero on hard failures.
 * 'warn' / 'not_configured' do NOT cause non-zero exit (expected during pre-launch).
 */

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });
loadEnv({ path: '.env' });

import { runAllChecks, aggregateStatus, type CheckResult } from '../lib/health-checks';

function icon(status: CheckResult['status']): string {
  switch (status) {
    case 'ok':
      return '✓';
    case 'warn':
      return '!';
    case 'not_configured':
      return '–';
    case 'fail':
      return '✗';
  }
}

async function main() {
  console.log('Running health checks...\n');
  const checks = await runAllChecks();
  const agg = aggregateStatus(checks);

  // Plain table — works in any terminal.
  const namePad = Math.max(...checks.map((c) => c.name.length)) + 2;
  for (const c of checks) {
    const detail = c.detail ?? '';
    console.log(`  ${icon(c.status)} ${c.name.padEnd(namePad)} ${c.status.padEnd(16)} ${detail}`);
  }

  console.log('');
  console.log(`Summary: ${agg.ok} ok, ${agg.warned} warn/not_configured, ${agg.failed} failed`);
  console.log(`Aggregate: ${agg.status}`);

  if (agg.failed > 0) {
    console.error('\nOne or more required checks failed.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[health-check] crashed:', err);
  process.exit(2);
});
