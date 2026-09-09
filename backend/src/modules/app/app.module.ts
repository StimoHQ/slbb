import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { ConfigModule } from "@nestjs/config";
import { UserModule } from "src/modules/user/user.module";
import { TextModule } from "src/modules/text/text.module";
import { PrismaModule } from "../prisma/prisma.module";
import { KafkaModule } from "../kafka/kafka.module";
import { IngestionModule } from "../ingestion/ingestion.module";

@Module({
	imports: [
		PrismaModule,
		ConfigModule.forRoot({
			isGlobal: true,
		}),
		KafkaModule,
		IngestionModule,
		UserModule,
		TextModule,
	],
	controllers: [AppController],
	providers: [AppService],
})
export class AppModule {}
