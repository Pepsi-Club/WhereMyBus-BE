import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type BusApiMetricDocument = HydratedDocument<BusApiMetric>;

@Schema({ collection: 'bus_api_metrics', versionKey: false })
export class BusApiMetric {
  @Prop({ required: true })
  bucketStart: Date;

  @Prop({ required: true })
  instanceId: string;

  @Prop({ required: true })
  provider: string;

  @Prop({ required: true })
  operation: string;

  @Prop({ required: true, min: 0 })
  requestCount: number;

  @Prop({ required: true, min: 0 })
  errorCount: number;

  @Prop({ required: true })
  expiresAt: Date;
}

export const BusApiMetricSchema = SchemaFactory.createForClass(BusApiMetric);

BusApiMetricSchema.index(
  { bucketStart: 1, instanceId: 1, provider: 1, operation: 1 },
  { unique: true, name: 'bucket_instance_dimension_unique' },
);
BusApiMetricSchema.index(
  { provider: 1, operation: 1, bucketStart: 1 },
  { name: 'metric_dimension_bucket_start' },
);
BusApiMetricSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: 'metric_expiry_ttl' },
);
BusApiMetricSchema.index({ bucketStart: 1 }, { name: 'metric_bucket_start' });
