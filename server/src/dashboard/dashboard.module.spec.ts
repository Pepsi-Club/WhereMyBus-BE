import { MODULE_METADATA } from '@nestjs/common/constants';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection } from 'mongoose';
import { BusApiMetricModule } from '../bus-api-metric/bus-api-metric.module';
import { DashboardController } from './dashboard.controller';
import { DashboardMetricService } from './dashboard-metric.service';
import { DashboardModule } from './dashboard.module';

it('DashboardModule이 route와 presentation provider를 소유한다', async () => {
  const mongo = await MongoMemoryServer.create({
    instance: { ip: '127.0.0.1' },
  });
  let module: TestingModule;
  let connection: Connection;
  try {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true }),
        MongooseModule.forRoot(mongo.getUri(), {
          connectionFactory: (openedConnection: Connection) => {
            connection = openedConnection;
            return openedConnection;
          },
        }),
        DashboardModule,
      ],
    }).compile();

    expect(module.get(DashboardController)).toBeDefined();
    expect(module.get(DashboardMetricService)).toBeDefined();
    expect(
      Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, BusApiMetricModule) ??
        [],
    ).toEqual([]);
  } finally {
    try {
      await module?.close();
    } finally {
      try {
        await connection?.close();
      } finally {
        await mongo.stop();
      }
    }
  }
});
