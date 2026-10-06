import { ConfigModule } from '@nestjs/config';
import mongoose from 'mongoose';
import {
  assertLocalMongoUri,
  buildDashboardDemoMetrics,
  DashboardMetricCollection,
  replaceDashboardDemoMetrics,
} from '../src/dashboard/dashboard-metric-seed';

ConfigModule.forRoot({ envFilePath: '.env.dev' });

async function seed(): Promise<void> {
  const mongoUri = process.env.MONGO ?? '';
  assertLocalMongoUri(mongoUri);

  try {
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
    const collection = mongoose.connection.collection(
      'bus_api_metrics',
    ) as unknown as DashboardMetricCollection;
    const insertedCount = await replaceDashboardDemoMetrics(
      collection,
      buildDashboardDemoMetrics(new Date()),
    );
    process.stdout.write(
      `대시보드 demo 메트릭 ${insertedCount}건을 저장했습니다.\n`,
    );
  } finally {
    await mongoose.disconnect();
  }
}

seed().catch((error: Error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
