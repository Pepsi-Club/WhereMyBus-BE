const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const DEMO_DAYS = 90;
const DEMO_INSTANCE_IDS = ['dashboard-demo-1', 'dashboard-demo-2'] as const;

export interface DashboardDemoMetric {
  bucketStart: Date;
  instanceId: string;
  provider: 'seoul-bus';
  operation: 'bus-arrival';
  requestCount: number;
  errorCount: number;
  expiresAt: Date;
}

export interface DashboardMetricCollection {
  deleteMany(filter: { instanceId: { $regex: string } }): Promise<unknown>;
  insertMany(
    documents: DashboardDemoMetric[],
    options: { ordered: true },
  ): Promise<{ insertedCount?: number }>;
}

export function assertLocalMongoUri(uri: string): void {
  try {
    const parsed = new URL(uri);
    const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
    if (
      parsed.protocol !== 'mongodb:' ||
      !loopbackHosts.has(parsed.hostname.toLowerCase())
    ) {
      throw new Error('remote MongoDB');
    }
  } catch (error) {
    throw new Error('로컬 MongoDB만 사용할 수 있습니다.');
  }
}

function hourlyDemand(hour: number): number {
  if (hour < 6) return 12;
  if (hour < 7) return 42;
  if (hour < 10) return 150;
  if (hour < 16) return 78;
  if (hour < 20) return 132;
  if (hour < 23) return 58;
  return 24;
}

export function buildDashboardDemoMetrics(now: Date): DashboardDemoMetric[] {
  if (Number.isNaN(now.getTime())) {
    throw new Error('유효한 기준 시간이 필요합니다.');
  }

  const end = new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS);
  const startTime = end.getTime() - DEMO_DAYS * DAY_MS;
  const expiresAt = new Date(end.getTime() + 180 * DAY_MS);
  const documents: DashboardDemoMetric[] = [];

  for (
    let bucketTime = startTime;
    bucketTime < end.getTime();
    bucketTime += HOUR_MS
  ) {
    const bucketStart = new Date(bucketTime);
    const seoulTime = new Date(bucketTime + 9 * HOUR_MS);
    const seoulHour = seoulTime.getUTCHours();
    const seoulDay = seoulTime.getUTCDay();
    const weekendFactor = seoulDay === 0 || seoulDay === 6 ? 0.54 : 1;
    const dayIndex = Math.floor((bucketTime - startTime) / DAY_MS);

    DEMO_INSTANCE_IDS.forEach((instanceId, instanceIndex) => {
      const instanceFactor = instanceIndex === 0 ? 1 : 0.72;
      const variation =
        ((dayIndex * 7 + seoulHour * 3 + instanceIndex * 11) % 19) - 9;
      const requestCount = Math.max(
        1,
        Math.round(
          hourlyDemand(seoulHour) * weekendFactor * instanceFactor + variation,
        ),
      );
      const hasError =
        (dayIndex * 24 + seoulHour + instanceIndex * 13) % 23 === 0;
      const errorCount = hasError
        ? Math.min(requestCount, Math.max(1, Math.floor(requestCount * 0.012)))
        : 0;

      documents.push({
        bucketStart,
        instanceId,
        provider: 'seoul-bus',
        operation: 'bus-arrival',
        requestCount,
        errorCount,
        expiresAt,
      });
    });
  }

  return documents;
}

export async function replaceDashboardDemoMetrics(
  collection: DashboardMetricCollection,
  documents: DashboardDemoMetric[],
): Promise<number> {
  await collection.deleteMany({
    instanceId: { $regex: '^dashboard-demo-' },
  });
  if (documents.length === 0) return 0;
  const result = await collection.insertMany(documents, { ordered: true });
  return result.insertedCount ?? documents.length;
}
