import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ResponseData } from './arrival-info.type';

@Injectable()
export class BusInfoService {
  private readonly serviceKey;
  private readonly apiUrl;
  constructor(private readonly configService: ConfigService) {
    this.serviceKey = this.configService.get<string>('SERVICE_KEY');
    this.apiUrl = this.configService.get<string>('BUS_INFO_API');
  }

  async arriveEachBus(arsId: string, busRouteId: string): Promise<string> {
    const result = await this.arriveStation(arsId);
    if (result.msgHeader.headerCd !== '0') {
      throw new Error('버스 도착 정보 조회 실패');
    }
    const infoList = result.msgBody.itemList;
    const info = infoList.filter((each) => each.busRouteId == busRouteId);
    return info[0].arrmsg1;
  }

  async arriveStation(arsId: string): Promise<ResponseData> {
    const requestUrl = `${this.apiUrl}?ServiceKey=${this.serviceKey}&arsId=${arsId}&resultType=json`;
    return (await axios.get(requestUrl)).data;
  }
}
