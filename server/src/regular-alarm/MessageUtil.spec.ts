import { MessageUtil } from './MessageUtil';
import { Item } from '../bus-info/arrival-info.type';

describe('MessageUtil', () => {
  it('버스 도착 정보를 올바르게 파싱하여 응답한다-일반적인 경우', () => {
    const normal = '13분9초후[10번째 전]';
    const normal_result = MessageUtil.parseMessage(normal);
    expect(normal_result).toBe('버스가 13분 후 도착합니다. (10번째 전)');
  });

  it('버스 도착 정보를 올바르게 파싱하여 응답한다-운행종료 경우', () => {
    const soon = '운행종료';
    const soon_result = MessageUtil.parseMessage(soon);
    expect(soon_result).toBe('버스 운행이 종료돠었습니다.');
  });

  it('곧 도착인 버스는 다음 버스의 정보도 제공한다.', () => {
    const info: Pick<Item, 'arrmsg1' | 'arrmsg2'> = {
      arrmsg1: '곧 도착',
      arrmsg2: '13분9초후[10번째 전]',
    };
    const result: string = MessageUtil.getMessageBody(info);
    expect(result).toBe(
      '버스가 곧 도착합니다.\n다음 버스가 13분 후 도착합니다. (10번째 전)',
    );
  });

  it('다음 버스의 정보가 존재하지 않으면 정보를 추가하지 않는다.', () => {
    const info: Pick<Item, 'arrmsg1' | 'arrmsg2'> = {
      arrmsg1: '곧 도착',
      arrmsg2: undefined,
    };

    const result: string = MessageUtil.getMessageBody(info);
    expect(result).toBe('버스가 곧 도착합니다.');
  });

  it('처리되지 않은 문자열이 입력되는 경우 받은 문자열을 그대로 출력한다.', () => {
    const unknown = '알수없음';
    const result = MessageUtil.parseMessage(unknown);
    expect(result).toBe(unknown);
  });

  it('막차가 곧 도착일 때는 다음 정보를 제공하지 않는다.', () => {
    const info: Pick<Item, 'arrmsg1' | 'arrmsg2'> = {
      arrmsg1: '곧 도착',
      arrmsg2: '운행종료',
    };

    const result: string = MessageUtil.getMessageBody(info);
    expect(result).toBe('[막차] 버스가 곧 도착합니다.');
  });

  it('막차의 경우 막차 정보를 추가한다.', () => {
    const info: Pick<Item, 'arrmsg1' | 'arrmsg2'> = {
      arrmsg1: '막차 13분9초후[10번째 전]',
      arrmsg2: '운행종료',
    };
    const result = MessageUtil.getMessageBody(info);
    expect(result).toBe('[막차] 버스가 13분 후 도착합니다. (10번째 전)');
  });
});
