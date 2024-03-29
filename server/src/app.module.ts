import {Module} from '@nestjs/common';
import {AppController} from './app.controller';
import {AppService} from './app.service';
import {ConfigModule} from "@nestjs/config";
import * as process from "process";

@Module({
    imports: [ConfigModule.forRoot({
        envFilePath: process.env.NODE_ENV === "dev" ? ".env.dev" : ".env.prod",
        isGlobal: true,
    }),],
    controllers: [AppController],
    providers: [AppService],
})
export class AppModule {
}
