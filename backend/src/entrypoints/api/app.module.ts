import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { ConfigModule } from "@nestjs/config";
import { UserModule } from "../../modules/user/user.module";
import { TextModule } from "../../modules/text/text.module";
import { PrismaModule } from "../../modules/prisma/prisma.module";
import { KafkaModule } from "../../modules/kafka/kafka.module";

@Module({
	imports: [
		PrismaModule,
		ConfigModule.forRoot({
			isGlobal: true,
		}),
		KafkaModule,
		// В API-графе нет ни IngestionModule, ни GutenbergLoaderModule: скачивание текста
		// и разбивку на предложения делает отдельный worker-процесс (src/entrypoints/worker).
		UserModule,
		TextModule,
	],
	controllers: [AppController],
	providers: [AppService],
})
export class AppModule {}
