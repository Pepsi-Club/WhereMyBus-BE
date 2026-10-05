import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { BusApiMetricService } from '../bus-api-metric/bus-api-metric.service';
import { ResponseData } from './arrival-info.type';
import { BusInfoService } from './bus-info.service';
import {
  BusApiMetricIdentity,
  SEOUL_BUS_ARRIVAL_METRIC,
} from '../bus-api-metric/bus-api-metric.dimension';

class RecordingMetricService {
  requests: Array<{ identity: BusApiMetricIdentity; at: Date }> = [];
  errors: Array<{ identity: BusApiMetricIdentity; at: Date }> = [];
  events: string[] = [];

  recordRequest(identity: BusApiMetricIdentity, at: Date): void {
    this.events.push('metric');
    this.requests.push({ identity, at });
  }

  recordError(identity: BusApiMetricIdentity, at: Date): void {
    this.errors.push({ identity, at });
  }
}

describe('BusInfoService', () => {
  let recorder: RecordingMetricService;
  let service: BusInfoService;

  const responseData = {
    msgHeader: { headerCd: '0' },
    msgBody: {
      itemList: [{ busRouteId: '121900016', arrmsg1: '3분후[2번째 전]' }],
    },
  } as ResponseData;

  beforeEach(() => {
    recorder = new RecordingMetricService();
    service = new BusInfoService(
      new ConfigService({
        SERVICE_KEY: 'test-service-key',
        BUS_INFO_API: 'https://example.test/bus',
      }),
      recorder as unknown as BusApiMetricService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('실제 HTTP 요청 직전에 request metric을 기록한다', async () => {
    jest.spyOn(axios, 'get').mockImplementation(async () => {
      recorder.events.push('http');
      return { data: responseData };
    });

    await expect(service.arriveStation('22285')).resolves.toBe(responseData);

    expect(recorder.events).toEqual(['metric', 'http']);
    expect(recorder.requests).toHaveLength(1);
    expect(recorder.requests[0].identity).toBe(SEOUL_BUS_ARRIVAL_METRIC);
    expect(recorder.requests[0].at).toBeInstanceOf(Date);
    expect(recorder.errors).toHaveLength(0);
  });

  it('HTTP 실패는 요청 시작 시각에 error를 기록하고 원래 오류를 던진다', async () => {
    const failure = new Error('timeout');
    let rejectRequest: (error: Error) => void;
    jest.spyOn(axios, 'get').mockReturnValue(
      new Promise((_, reject) => {
        rejectRequest = reject;
      }),
    );

    const request = service.arriveStation('22285');
    rejectRequest(failure);

    await expect(request).rejects.toBe(failure);
    expect(recorder.requests).toHaveLength(1);
    expect(recorder.errors).toHaveLength(1);
    expect(recorder.requests[0].identity).toBe(SEOUL_BUS_ARRIVAL_METRIC);
    expect(recorder.errors[0].identity).toBe(SEOUL_BUS_ARRIVAL_METRIC);
    expect(recorder.errors[0].at).toBe(recorder.requests[0].at);
    expect(recorder.errors[0].at).toBeInstanceOf(Date);
  });

  it('arriveEachBus도 내부 HTTP 요청 한 번만 계측한다', async () => {
    jest.spyOn(axios, 'get').mockResolvedValue({ data: responseData });

    await expect(service.arriveEachBus('22285', '121900016')).resolves.toBe(
      '3분후[2번째 전]',
    );

    expect(recorder.requests).toHaveLength(1);
    expect(recorder.requests[0].identity).toBe(SEOUL_BUS_ARRIVAL_METRIC);
    expect(recorder.errors).toHaveLength(0);
  });
});
