import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DashboardMetricQueryDto } from './dashboard/dto/dashboard-metric.query.dto';
import { configureApplication } from './main';

describe('configureApplication', () => {
  it.each(['weekdays', 'unexpected'])(
    '설정된 전역 ValidationPipe는 DTO에 없는 %s query를 거부한다',
    async (unknownField) => {
      const useGlobalPipes = jest.fn();
      const app = {
        useGlobalPipes,
        getHttpAdapter: () => ({ getInstance: () => ({ set: jest.fn() }) }),
        enableShutdownHooks: jest.fn(),
        listen: jest.fn().mockResolvedValue(undefined),
      } as unknown as INestApplication;

      await configureApplication(app, new ConfigService());

      const pipe: ValidationPipe = useGlobalPipes.mock.calls[0][0];
      await expect(
        pipe.transform(
          { range: '24h', [unknownField]: '1,3' },
          { type: 'query', metatype: DashboardMetricQueryDto },
        ),
      ).rejects.toMatchObject({ status: 400 });
    },
  );

  it('loopback proxy만 신뢰하고 shutdown hook을 활성화한다', async () => {
    const state = {
      trustProxy: undefined as string,
      shutdownHooksEnabled: false,
      listenArgs: undefined as [number, string],
    };
    const app = {
      useGlobalPipes: jest.fn(),
      getHttpAdapter: () => ({
        getInstance: () => ({
          set: (key: string, value: string) => {
            if (key === 'trust proxy') state.trustProxy = value;
          },
        }),
      }),
      enableShutdownHooks: () => {
        state.shutdownHooksEnabled = true;
      },
      listen: async (port: number, host: string) => {
        state.listenArgs = [port, host];
      },
    } as unknown as INestApplication;
    const config = new ConfigService({ HOST: '127.0.0.1', PORT: 3000 });

    await configureApplication(app, config);

    expect(state.trustProxy).toBe('loopback');
    expect(state.shutdownHooksEnabled).toBe(true);
    expect(state.listenArgs).toEqual([3000, '127.0.0.1']);
  });

  it('HOST가 없으면 loopback에서 listen한다', async () => {
    const listen = jest.fn().mockResolvedValue(undefined);
    const app = {
      useGlobalPipes: jest.fn(),
      getHttpAdapter: () => ({ getInstance: () => ({ set: jest.fn() }) }),
      enableShutdownHooks: jest.fn(),
      listen,
    } as unknown as INestApplication;

    await configureApplication(app, new ConfigService({ PORT: 3100 }));

    expect(listen).toHaveBeenCalledWith(3100, '127.0.0.1');
  });
});
