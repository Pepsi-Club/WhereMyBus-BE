import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class BusInfoService {
  private readonly serviceKey;
  private readonly apiUrl;
  constructor(private readonly configService: ConfigService) {
    this.serviceKey = this.configService.get<string>('SERVICE_KEY');
    this.apiUrl = this.configService.get<string>('BUS_INFO_API');
  }

  async arrive(busRouteId: number, arsId: number): Promise<string> {
    const requestUrl = `${this.apiUrl}?ServiceKey=${this.serviceKey}&arsId=${arsId}&resultType=json`;
    const result = (await axios.get(requestUrl)).data;
    if (result.msgHeader.headerCd !== '0') {
      throw new Error('버스 도착 정보 조회 실패');
    }
    const infoList = result.msgBody.itemList;
    const info = infoList.filter((each) => each.busRouteId == busRouteId);
    return info[0].arrmsg1;
  }
}
