import { Item, ResponseData } from '../../bus-info/arrival-info.type';
import { RegularAlarm } from '../regular-alarm.schema';

export function alarmFixture(
  overrides: Partial<RegularAlarm> = {},
): RegularAlarm {
  return {
    deviceToken: 'token-a',
    time: '0828',
    day: [1],
    arsId: '22285',
    busRouteId: 'route',
    adirection: '종점',
    ...overrides,
  };
}

export function arrivalFixture(overrides: Partial<Item> = {}): ResponseData {
  return {
    comMsgHeader: {
      errMsg: null,
      responseTime: null,
      responseMsgID: null,
      requestMsgID: null,
      returnCode: null,
      successYN: null,
    },
    msgHeader: { headerCd: '0', headerMsg: '정상', itemCount: 1 },
    msgBody: {
      itemList: [
        {
          stId: 'station',
          stNm: '정류장',
          arsId: '22285',
          busRouteId: 'route',
          rtNm: '100',
          busRouteAbrv: '100',
          sectNm: '',
          gpsX: '0',
          gpsY: '0',
          posX: '0',
          posY: '0',
          stationTp: '0',
          firstTm: '',
          lastTm: '',
          term: '',
          routeType: '3',
          nextBus: '',
          staOrd: '1',
          vehId1: 'bus-1',
          plainNo1: null,
          sectOrd1: '1',
          stationNm1: null,
          traTime1: '180',
          traSpd1: '0',
          isArrive1: '0',
          repTm1: null,
          isLast1: '0',
          busType1: '0',
          vehId2: 'bus-2',
          plainNo2: null,
          sectOrd2: '0',
          stationNm2: null,
          traTime2: '600',
          traSpd2: '0',
          isArrive2: '0',
          repTm2: null,
          isLast2: '0',
          busType2: '0',
          adirection: '종점',
          arrmsg1: '3분후[2번째 전]',
          arrmsg2: '10분후[5번째 전]',
          arrmsgSec1: '',
          arrmsgSec2: '',
          nxtStn: '',
          rerdieDiv1: '',
          rerdieDiv2: '',
          rerideNum1: '',
          rerideNum2: '',
          isFullFlag1: '',
          isFullFlag2: '',
          deTourAt: '',
          congestion1: '',
          congestion2: '',
          ...overrides,
        },
      ],
    },
  };
}

export function deferred<T>() {
  let resolve: (value: T) => void;
  const promise = new Promise<T>((finish) => (resolve = finish));
  return { promise, resolve };
}

export function observedRejection(error: unknown): Promise<never> {
  const promise = Promise.reject(error);
  promise.catch(() => undefined);
  return promise;
}
