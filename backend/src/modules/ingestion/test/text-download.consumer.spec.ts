import { type EachMessagePayload } from "kafkajs";
import { IngestionService } from "../ingestion.service";
import { TextDownloadConsumer } from "../text-download.consumer";
import { type KafkaService } from "../../kafka/kafka.service";

type RunHandler = (payload: EachMessagePayload) => Promise<void>;

function createMocks() {
	let eachMessage: RunHandler | undefined;

	const kafka = {
		createConsumer: jest.fn(async (options: { run: { eachMessage: RunHandler } }) => {
			eachMessage = options.run.eachMessage;
		}),
	};
	const ingestion = { process: jest.fn() };
	const configValues: Record<string, string> = {
		KAFKA_GROUP_ID: "slbb-backend",
		KAFKA_TOPIC_TEXT_DOWNLOAD: "slbb.text.download",
	};
	const config = { getOrThrow: (key: string) => configValues[key] };

	const deliver = async (raw: string | undefined) => {
		if (!eachMessage) {
			throw new Error("consumer did not subscribe");
		}
		await eachMessage({
			message: { value: raw === undefined ? undefined : Buffer.from(raw) },
		} as unknown as EachMessagePayload);
	};

	return {
		kafka: kafka as unknown as KafkaService,
		ingestion: ingestion as unknown as IngestionService,
		config: config as never,
		eachMessage: () => eachMessage,
		deliver,
	};
}

describe("TextDownloadConsumer", () => {
	it("subscribes to the configured group and topic on module init", async () => {
		const mocks = createMocks();
		const consumer = new TextDownloadConsumer(mocks.kafka, mocks.ingestion, mocks.config);

		await consumer.onModuleInit();

		expect(mocks.kafka.createConsumer).toHaveBeenCalledWith(
			expect.objectContaining({ groupId: "slbb-backend", topic: "slbb.text.download" }),
		);
	});

	it("routes a well-formed event to the ingestion service", async () => {
		const mocks = createMocks();
		const consumer = new TextDownloadConsumer(mocks.kafka, mocks.ingestion, mocks.config);
		await consumer.onModuleInit();

		await mocks.deliver(JSON.stringify({ textTaskId: 5, sourceObjId: 11 }));

		expect(mocks.ingestion.process).toHaveBeenCalledWith(5);
	});

	it.each([
		["empty payload", undefined],
		["non-JSON payload", "<binary>"],
		["schema mismatch", JSON.stringify({ textTaskId: "5", sourceObjId: 11 })],
		// событие до переезда статуса на TextDownloadTask: глотается, а не роняет консьюмера
		["legacy textId payload", JSON.stringify({ textId: 5, sourceObjId: 11 })],
	])("acknowledges and discards a %s without touching the pipeline", async (_name, raw) => {
		const mocks = createMocks();
		const consumer = new TextDownloadConsumer(mocks.kafka, mocks.ingestion, mocks.config);
		await consumer.onModuleInit();

		await expect(mocks.deliver(raw)).resolves.toBeUndefined();

		expect(mocks.ingestion.process).not.toHaveBeenCalled();
	});

	it("never propagates a processing error back to kafkajs (no poison-message retries)", async () => {
		const mocks = createMocks();
		(mocks.ingestion.process as jest.Mock).mockRejectedValue(new Error("quota"));
		const consumer = new TextDownloadConsumer(mocks.kafka, mocks.ingestion, mocks.config);
		await consumer.onModuleInit();

		await expect(mocks.deliver(JSON.stringify({ textTaskId: 5, sourceObjId: 11 }))).resolves.toBeUndefined();
	});
});
