import { ConfigService } from "@nestjs/config";
import { Kafka } from "kafkajs";
import { KafkaService } from "../kafka.service";
import { isTextDownloadEvent } from "../interfaces/kafka-events.interface";

// Мокаем kafkajs целиком: юнит-тест не должен зависеть от живого брокера
// (проверка связности — это pnpm kafka:smoke).
const mockProducer = { connect: jest.fn(), disconnect: jest.fn(), send: jest.fn() };
const mockConsumer = {
	connect: jest.fn(),
	disconnect: jest.fn(),
	subscribe: jest.fn(),
	run: jest.fn(),
};

jest.mock("kafkajs", () => ({
	Kafka: jest.fn().mockImplementation(() => ({
		producer: () => mockProducer,
		consumer: () => mockConsumer,
	})),
}));

const configValues: Record<string, string> = {
	KAFKA_BROKERS: "localhost:9092 , kafka-backup:9092",
	KAFKA_CLIENT_ID: "slbb-backend",
};

const configServiceMock = {
	getOrThrow: (key: string) => {
		if (!(key in configValues)) {
			throw new Error(`Missing config: ${key}`);
		}
		return configValues[key];
	},
} as unknown as ConfigService;

function createService(): KafkaService {
	return new KafkaService(configServiceMock);
}

describe("KafkaService", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("passes parsed brokers and clientId to the kafkajs client", () => {
		createService();

		expect(Kafka).toHaveBeenCalledWith({
			clientId: "slbb-backend",
			brokers: ["localhost:9092", "kafka-backup:9092"],
		});
	});

	it("rejects an empty broker list", () => {
		configValues["KAFKA_BROKERS"] = " , ";

		expect(() => createService()).toThrow("KAFKA_BROKERS must contain at least one host:port entry");

		configValues["KAFKA_BROKERS"] = "localhost:9092 , kafka-backup:9092";
	});

	it("connects the producer on module init", async () => {
		const service = createService();

		await service.onModuleInit();

		expect(mockProducer.connect).toHaveBeenCalledTimes(1);
	});

	it("publishes a JSON payload keyed by the given key", async () => {
		const service = createService();
		const payload = { textId: 7, sourceObjId: 1342 };

		await service.publish("slbb.text.download", "7", payload);

		expect(mockProducer.send).toHaveBeenCalledWith({
			topic: "slbb.text.download",
			messages: [{ key: "7", value: JSON.stringify(payload) }],
		});
	});

	it("creates a consumer subscribed from the beginning by default", async () => {
		const service = createService();
		const run = { eachMessage: jest.fn() };

		await service.createConsumer({ groupId: "slbb-backend", topic: "slbb.text.download", run });

		expect(mockConsumer.connect).toHaveBeenCalledTimes(1);
		expect(mockConsumer.subscribe).toHaveBeenCalledWith({ topic: "slbb.text.download", fromBeginning: true });
		expect(mockConsumer.run).toHaveBeenCalledWith(run);
	});

	it("disconnects every consumer and the producer on shutdown", async () => {
		const service = createService();
		await service.createConsumer({
			groupId: "g1",
			topic: "t1",
			run: { eachMessage: jest.fn() },
		});

		await service.onModuleDestroy();

		expect(mockConsumer.disconnect).toHaveBeenCalledTimes(1);
		expect(mockProducer.disconnect).toHaveBeenCalledTimes(1);
	});

	it("still disconnects the producer when a consumer fails to disconnect", async () => {
		const service = createService();
		await service.createConsumer({ groupId: "g1", topic: "t1", run: { eachMessage: jest.fn() } });
		mockConsumer.disconnect.mockRejectedValueOnce(new Error("network down"));

		await expect(service.onModuleDestroy()).resolves.toBeUndefined();

		expect(mockProducer.disconnect).toHaveBeenCalledTimes(1);
	});
});

describe("isTextDownloadEvent", () => {
	it("accepts a well-formed event", () => {
		expect(isTextDownloadEvent({ textId: 1, sourceObjId: 79501 })).toBe(true);
	});

	it("rejects non-object payloads", () => {
		expect(isTextDownloadEvent(null)).toBe(false);
		expect(isTextDownloadEvent("42")).toBe(false);
	});

	it("rejects invalid identifiers", () => {
		expect(isTextDownloadEvent({ textId: 0, sourceObjId: 5 })).toBe(false);
		expect(isTextDownloadEvent({ textId: -1, sourceObjId: 5 })).toBe(false);
		expect(isTextDownloadEvent({ textId: 1.5, sourceObjId: 5 })).toBe(false);
		expect(isTextDownloadEvent({ textId: "1", sourceObjId: 5 })).toBe(false);
		expect(isTextDownloadEvent({ textId: 1 })).toBe(false);
	});

	it("ignores unknown extra fields (producer schema may evolve)", () => {
		expect(isTextDownloadEvent({ textId: 1, sourceObjId: 5, futureField: true })).toBe(true);
	});
});
