import { RegularAlarmDocument } from '../../regular-alarm.schema';

export class GetByTokenResponseDto {
  id: string;
  time: string;
  day: number[];
  busRoutedId: string;
  arsId: string;

  constructor(info: RegularAlarmDocument) {
    this.id = info.id;
    this.time = info.time;
    this.day = info.day;
    this.busRoutedId = info.busRouteId;
    this.arsId = info.arsId;
  }
}
