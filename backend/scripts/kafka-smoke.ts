/**
 * Смоук-проверка связности Kafka: produce -> consume тестового сообщения
 * на изолированном топике (не боевом), против брокера из KAFKA_BROKERS.
 * Запуск: pnpm kafka:smoke (ждёт ~10 секунд, exit 0 = ОК).
 */
import "dotenv/config";
import { Kafka, logLevel } from "kafkajs";

const TOPIC = "slbb.kafka-smoke";
const PAYLOAD = { probe: "stage3", sentAt: new Date().toISOString() };

const brokers = (process.env.KAFKA_BROKERS ?? "localhost:9092")
	.split(",")
	.map((b) => b.trim())
	.filter(Boolean);

const kafka = new Kafka({ clientId: "slbb-smoke", brokers, logLevel: logLevel.ERROR });

async function main(): Promise<void> {
	const producer = kafka.producer();
	await producer.connect();
	await producer.send({
		topic: TOPIC,
		messages: [{ key: "smoke", value: JSON.stringify(PAYLOAD) }],
	});
	console.log(`[smoke] produced to ${TOPIC} via ${brokers.join(",")}`);

	const consumer = kafka.consumer({ groupId: `slbb-smoke-${Date.now()}` });
	await consumer.connect();
	// fromBeginning: сообщение могло попасть в топик раньше подписки
	await consumer.subscribe({ topic: TOPIC, fromBeginning: true });

	const received = new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("no message within 15s")), 15_000);
		consumer
			.run({
				eachMessage: async ({ message }) => {
					const body = JSON.parse(message.value?.toString() ?? "null");
					clearTimeout(timer);
					console.log(
						`[smoke] consumed: probe=${body?.probe} offset=${message.offset} ts=${message.timestamp}`,
					);
					resolve();
				},
			})
			.catch(reject);
	});

	await received;
	await consumer.disconnect();
	await producer.disconnect();
	console.log("[smoke] OK");
}

main().catch((error) => {
	console.error("[smoke] FAILED:", error);
	process.exitCode = 1;
});
