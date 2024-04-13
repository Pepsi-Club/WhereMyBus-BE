export interface Item {
  stId: string;
  stNm: string;
  arsId: string;
  busRouteId: string;
  rtNm: string;
  busRouteAbrv: string;
  sectNm: string;
  gpsX: string;
  gpsY: string;
  posX: string;
  posY: string;
  stationTp: string;
  firstTm: string;
  lastTm: string;
  term: string;
  routeType: string;
  nextBus: string;
  staOrd: string;
  vehId1: string;
  plainNo1: string | null;
  sectOrd1: string;
  stationNm1: string | null;
  traTime1: string;
  traSpd1: string;
  isArrive1: string;
  repTm1: string | null;
  isLast1: string;
  busType1: string;
  vehId2: string;
  plainNo2: string | null;
  sectOrd2: string;
  stationNm2: string | null;
  traTime2: string;
  traSpd2: string;
  isArrive2: string;
  repTm2: string | null;
  isLast2: string;
  busType2: string;
  adirection: string;
  arrmsg1: string;
  arrmsg2: string;
  arrmsgSec1: string;
  arrmsgSec2: string;
  nxtStn: string;
  rerdieDiv1: string;
  rerdieDiv2: string;
  rerideNum1: string;
  rerideNum2: string;
  isFullFlag1: string;
  isFullFlag2: string;
  deTourAt: string;
  congestion1: string;
  congestion2: string;
}

interface MsgBody {
  itemList: Item[];
}

interface MsgHeader {
  headerMsg: string;
  headerCd: string;
  itemCount: number;
}

interface ComMsgHeader {
  errMsg: string | null;
  responseTime: string | null;
  responseMsgID: string | null;
  requestMsgID: string | null;
  returnCode: string | null;
  successYN: string | null;
}

export interface ResponseData {
  comMsgHeader: ComMsgHeader;
  msgHeader: MsgHeader;
  msgBody: MsgBody;
}
