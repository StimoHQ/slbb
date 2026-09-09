import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Consumer, ConsumerRunConfig, Kafka, Producer } from "kafkajs";

export type ConsumerOptions = {
	groupId: string;
	topic: string;
	/**
	 * true по умолчанию: backlog задач, накопленный пока консьюмер был выключен,
	 * должен быть обработан. Дедупликация — на стороне обработчика (status-машина).
	 */
	fromBeginning?: boolean;
	run: ConsumerRunConfig;
};

/**
 * Тонкая обвязка kafkajs: одно соединение-клиент на процесс, один producer
 * и фабрика консьюмеров. Бизнес-логика обработки сообщений в модулях-владельцах
 * событий, здесь только транспорт и жизненный цикл.
 */
@Injectable()
export class KafkaService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(KafkaService.name);
	private readonly brokers: string[];
	private readonly client: Kafka;
	private readonly producer: Producer;
	// consumer -> groupId: у kafkajs groupId не публичное поле, нужен для логов и отладки
	private readonly consumers = new Map<Consumer, string>();

	constructor(private readonly configService: ConfigService) {
		this.brokers = this.parseBrokers(this.configService.getOrThrow<string>("KAFKA_BROKERS"));
		this.client = new Kafka({
			clientId: this.configService.getOrThrow<string>("KAFKA_CLIENT_ID"),
			brokers: this.brokers,
		});
		this.producer = this.client.producer();
	}

	public async onModuleInit(): Promise<void> {
		await this.producer.connect();
		this.logger.log(`Producer connected (brokers=${this.brokers.join(",")})`);
	}

	public async publish(topic: string, key: string, payload: unknown): Promise<void> {
		await this.producer.send({
			topic,
			messages: [{ key, value: JSON.stringify(payload) }],
		});
		this.logger.log(`Published message to ${topic} (key=${key})`);
	}

	public async createConsumer({ groupId, topic, fromBeginning = true, run }: ConsumerOptions): Promise<Consumer> {
		const consumer = this.client.consumer({ groupId });

		await consumer.connect();
		await consumer.subscribe({ topic, fromBeginning });
		await consumer.run(run);
		this.consumers.set(consumer, groupId);

		this.logger.log(`Consumer started (group=${groupId}, topic=${topic})`);

		return consumer;
	}

	public async onModuleDestroy(): Promise<void> {
		this.logger.log("Disconnecting from Kafka");

		for (const [consumer, consumerGroup] of this.consumers) {
			try {
				await consumer.disconnect();
			} catch (error) {
				this.logger.error(`Failed to disconnect consumer (group=${consumerGroup})`, error);
			}
		}
		this.consumers.clear();

		try {
			await this.producer.disconnect();
			this.logger.log("Connections to Kafka have been closed");
		} catch (error) {
			this.logger.error("Failed to disconnect producer", error);
		}
	}

	/** KAFKA_BROKERS — список host:port через запятую. */
	private parseBrokers(raw: string): string[] {
		const brokers = raw
			.split(",")
			.map((broker) => broker.trim())
			.filter(Boolean);

		if (brokers.length === 0) {
			throw new Error("KAFKA_BROKERS must contain at least one host:port entry");
		}

		return brokers;
	}
}
