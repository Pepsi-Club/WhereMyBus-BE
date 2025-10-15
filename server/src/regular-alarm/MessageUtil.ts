import { MESSAGE } from '../common/message';
import { Item } from '../bus-info/arrival-info.type';

enum BusArrivalStatus {
  SOON = '곧 도착',
  WAITING = '출발대기',
  END = '운행종료',
}

const busArrivalMessageRegex = /(\d+)\s*분(?:후)?(?:.*?(\d+)번째 전)?/;
const BUS_ARRIVAL_MESSAGE = {
  [BusArrivalStatus.SOON]: MESSAGE.NOTIFICATION.SOON,
  [BusArrivalStatus.WAITING]: MESSAGE.NOTIFICATION.WAITING,
  [BusArrivalStatus.END]: MESSAGE.NOTIFICATION.END,
};

export class MessageUtil {
  static getMessageContent(busInfo) {
    return {
      subTitle: `[${busInfo.busRouteAbrv}] ${busInfo.stNm}`,
      message: MessageUtil.getMessageBody(busInfo),
    };
  }

  static getMessageBody(busInfo: Pick<Item, 'arrmsg1' | 'arrmsg2'>): string {
    let message = '';
    const firstMessage = MessageUtil.parseMessage(busInfo.arrmsg1);
    message = `${firstMessage}`;
    if (MessageUtil.isNeedNextMessage(busInfo)) {
      const secondMessage = MessageUtil.parseMessage(busInfo.arrmsg2, true);
      message += `\n${secondMessage}`;
    }

    if (MessageUtil.isLastBus(busInfo)) {
      message = '[막차] ' + message;
    }
    return message;
  }

  static parseMessage(info: string, next = false) {
    let message = BUS_ARRIVAL_MESSAGE[info];
    if (message) {
      if (next) return '다음 ' + message;
      return message;
    }

    const match = info.match(busArrivalMessageRegex);
    if (match) {
      const minutes = match[1];
      const count = match[2];
      message = `버스가 ${minutes}분 후 도착합니다.`;

      if (count) {
        message += ` (${count}번째 전)`;
      }
    }

    if (next && info !== BusArrivalStatus.END) message = '다음 ' + message;
    return message ? message : info;
  }

  static isNeedNextMessage(busInfo: Pick<Item, 'arrmsg1' | 'arrmsg2'>) {
    return (
      busInfo.arrmsg2 &&
      busInfo.arrmsg1 === BusArrivalStatus.SOON &&
      busInfo.arrmsg2 !== BusArrivalStatus.END
    );
  }

  static isLastBus(busInfo: Pick<Item, 'arrmsg1' | 'arrmsg2'>) {
    return (
      busInfo.arrmsg1.includes('막차') ||
      (busInfo.arrmsg1 !== BusArrivalStatus.END &&
        busInfo.arrmsg2 === BusArrivalStatus.END)
    );
  }
}
