import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "../../modules/prisma/prisma.module";
import { KafkaModule } from "../../modules/kafka/kafka.module";
import { GutenbergLoaderModule } from "../../modules/gutenberg_loader/gutenberg-loader.module";
import { IngestionModule } from "../../modules/ingestion/ingestion.module";

/**
 * Граф worker-процесса: только консьюмер очереди задач инжестии, без HTTP-сервера.
 *
 * Смысл отдельного процесса — убрать из API Main Thread всё тяжёлое: синхронную
 * разбивку книги на предложения (wink-nlp, ~0.2-0.3s CPU на 1 МБ) и длинные
 * транзакции вставки. Пока эти кадры идут в процессе API, он не обслуживает запросы.
 *
 * IngestionModule намеренно не входит в AppModule: консьюмер физически не может
 * подписаться на топик из API-процесса, двойная обработка исключена архитектурой,
 * а не флагом в окружении.
 */
@Module({
	imports: [
		ConfigModule.forRoot({
			isGlobal: true,
		}),
		PrismaModule,
		KafkaModule,
		GutenbergLoaderModule,
		IngestionModule,
	],
})
export class WorkerModule {}
