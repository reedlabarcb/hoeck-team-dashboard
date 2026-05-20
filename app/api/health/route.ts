import { NextResponse } from 'next/server';
import { runAllChecks, aggregateStatus } from '@/lib/health-checks';

export const dynamic = 'force-dynamic';

export async function GET() {
  const checks = await runAllChecks();
  const agg = aggregateStatus(checks);
  // Always return 200 even on 'degraded' — Railway's healthcheck would loop deploys on warnings.
  // 503 only for 'unhealthy' (a required check failed).
  const httpStatus = agg.status === 'unhealthy' ? 503 : 200;
  return NextResponse.json(
    {
      status: agg.status,
      summary: agg,
      checks,
      timestamp: new Date().toISOString(),
      railway: {
        project: process.env.RAILWAY_PROJECT_NAME ?? null,
        environment: process.env.RAILWAY_ENVIRONMENT ?? null,
      },
    },
    { status: httpStatus },
  );
}
