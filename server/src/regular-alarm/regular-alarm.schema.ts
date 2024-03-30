import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type RegularAlarmDocument = HydratedDocument<RegularAlarm>;

@Schema()
export class RegularAlarm {
  _id?: string;

  @Prop()
  deviceToken: string;

  @Prop()
  time: string;

  @Prop()
  day: number[];

  @Prop()
  busRouteId: number;

  @Prop()
  arsId: number;
}

export const RegularAlarmSchema = SchemaFactory.createForClass(RegularAlarm);
