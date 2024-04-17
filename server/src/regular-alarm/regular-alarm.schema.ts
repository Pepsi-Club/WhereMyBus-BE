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
  busRouteId: string;

  @Prop()
  arsId: string;

  @Prop()
  adirection: string;
}

export const RegularAlarmSchema = SchemaFactory.createForClass(RegularAlarm);
