import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { type EachMessagePayload } from "kafkajs";
import { KafkaService } from "../kafka/kafka.service";
import { isTextDownloadEvent } from "../kafka/interfaces/kafka-events.interface";
import { IngestionService } from "./ingestion.service";

/**
 * Консьюмер задач загрузки текста. Живёт в том же процессе, что и API (решение MVP):
 * тяжёлая часть — сеть и вставка — асинхронные, CPU-пик разбивки ~0.2s на 1 МБ.
 * Обработка никогда не отдаёт ошибку в kafkajs: детерминированный повторный запуск
 * только сожрёт квоту источника, задача помечается FAILED и жит нового POST.
 */
@Injectable()
export class TextDownloadConsumer implements OnModuleInit {
	private readonly logger = new Logger(TextDownloadConsumer.name);

	constructor(
		private readonly kafka: KafkaService,
		private readonly ingestion: IngestionService,
		private readonly config: ConfigService,
	) {}

	public async onModuleInit(): Promise<void> {
		await this.kafka.createConsumer({
			groupId: this.config.getOrThrow<string>("KAFKA_GROUP_ID"),
			topic: this.config.getOrThrow<string>("KAFKA_TOPIC_TEXT_DOWNLOAD"),
			run: {
				eachMessage: async (payload: EachMessagePayload) => {
					await this.handleMessage(payload.message.value?.toString());
				},
			},
		});
	}

	private async handleMessage(raw: string | undefined): Promise<void> {
		if (!raw) {
			this.logger.warn("Discarded a message with an empty payload");

			return;
		}

		let parsed: unknown;

		try {
			parsed = JSON.parse(raw);
		} catch {
			this.logger.warn(`Discarded a non-JSON message: ${raw.slice(0, 200)}`);

			return;
		}

		if (!isTextDownloadEvent(parsed)) {
			this.logger.warn(`Discarded a message with unexpected shape: ${raw.slice(0, 200)}`);

			return;
		}

		try {
			await this.ingestion.process(parsed.textId);
		} catch (error) {
			// IngestionService уже перевёл задачу в FAILED и записал причину.
			this.logger.error(
				`Processing of text ${parsed.textId} failed, awaiting a new explicit request`,
				error instanceof Error ? error.stack : undefined,
			);
		}
	}
}
