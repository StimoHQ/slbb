import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { WorkerModule } from "./worker.module";

/**
 * Точка входа worker-процесса инжестии: поднимает граф консьюмера Kafka и ничего не слушает.
 * Процесс держат соклеты самого консьюмера — цикл событий Node пустовать не будет.
 *
 * Запуск: pnpm build && pnpm start:worker
 */
async function bootstrap(): Promise<void> {
	const logger = new Logger("IngestionWorker");
	const app = await NestFactory.create(WorkerModule);

	// Без shutdown hooks onModuleDestroy (отключение консьюмера и Prisma) на SIGTERM не вызовется,
	// и начатая задача повиснет в PROCESSING до перераспределения партиций.
	app.enableShutdownHooks();

	// init() обязателен: без app.listen() именно он запускает OnModuleInit (KafkaService, консьюмер).
	await app.init();

	logger.log("Ingestion worker has been started, waiting for download tasks from Kafka");
}

bootstrap().catch((error) => {
	// Падаем специально: systemd/k8s перезапустят процесс, а молча живой консьюмер
	// без подписки оставил бы задачи в очереди непрочитанными.
	const logger = new Logger("IngestionWorker");
	logger.error("Worker has not been started", error instanceof Error ? error.stack : String(error));
	process.exit(1);
});
