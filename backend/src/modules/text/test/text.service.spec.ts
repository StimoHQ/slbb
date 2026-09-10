import {
	ConflictException,
	InternalServerErrorException,
	NotFoundException,
	ServiceUnavailableException,
} from "@nestjs/common";
import { PrismaClientKnownRequestError } from "prisma/generated/internal/prismaNamespace";
import { TextService } from "../text.service";
import { type KafkaService } from "../../kafka/kafka.service";
import { type PrismaService } from "../../prisma/prisma.service";

const TOPIC = "slbb.text.download";

function createMocks() {
	const prisma = {
		textDownloadTask: {
			create: jest.fn(),
			update: jest.fn(),
			delete: jest.fn().mockResolvedValue(undefined),
			findUnique: jest.fn(),
		},
	};
	const kafka = { publish: jest.fn().mockResolvedValue(undefined) };
	const config = { getOrThrow: jest.fn().mockReturnValue(TOPIC) };

	return { prisma, kafka, config };
}

function createService(mocks: ReturnType<typeof createMocks>): TextService {
	return new TextService(
		mocks.prisma as unknown as PrismaService,
		mocks.kafka as unknown as KafkaService,
		mocks.config as never,
	);
}

/** Строка text_download_tasks такой, какой её возвращает Prisma. */
function taskRow(overrides: Record<string, unknown> = {}) {
	return {
		id: 7,
		status: "QUEUED",
		source: "GUTENBERG",
		sourceObjId: 11,
		textId: null,
		ingestError: null,
		finishedAt: null,
		...overrides,
	};
}

function uniqueViolation(): PrismaClientKnownRequestError {
	return new PrismaClientKnownRequestError("Unique constraint failed on the fields: (`source`,`source_obj_id`)", {
		code: "P2002",
		clientVersion: "7.10.0",
	});
}

const request = { source: "GUTENBERG" as const, sourceObjId: 11 };

describe("TextService.create", () => {
	it("opens a QUEUED task and hands it to Kafka under the task id", async () => {
		const mocks = createMocks();
		mocks.prisma.textDownloadTask.create.mockResolvedValue(taskRow());
		const service = createService(mocks);

		await expect(service.create(request)).resolves.toEqual({
			taskId: 7,
			status: "QUEUED",
			source: "GUTENBERG",
			sourceObjId: 11,
			textId: null,
			textTitle: null,
			sentenceCount: 0,
			ingestError: null,
			finishedAt: null,
		});

		expect(mocks.prisma.textDownloadTask.create).toHaveBeenCalledWith({
			data: { source: "GUTENBERG", sourceObjId: 11, status: "QUEUED", ingestError: null, finishedAt: null },
		});
		expect(mocks.config.getOrThrow).toHaveBeenCalledWith("KAFKA_TOPIC_TEXT_DOWNLOAD");
		expect(mocks.kafka.publish).toHaveBeenCalledWith(TOPIC, "7", { textTaskId: 7, sourceObjId: 11 });
	});

	it("re-queues the existing FAILED task instead of conflicting", async () => {
		const mocks = createMocks();
		mocks.prisma.textDownloadTask.create.mockRejectedValue(uniqueViolation());
		mocks.prisma.textDownloadTask.findUnique.mockResolvedValue(
			taskRow({ status: "FAILED", ingestError: "Language not supported", finishedAt: new Date() }),
		);
		mocks.prisma.textDownloadTask.update.mockResolvedValue(taskRow());
		const service = createService(mocks);

		await expect(service.create(request)).resolves.toMatchObject({ taskId: 7, status: "QUEUED" });

		expect(mocks.prisma.textDownloadTask.findUnique).toHaveBeenCalledWith({
			where: { source_sourceObjId: { source: "GUTENBERG", sourceObjId: 11 } },
		});
		// та же строка, история предыдущей попытки стёрта
		expect(mocks.prisma.textDownloadTask.update).toHaveBeenCalledWith({
			where: { id: 7 },
			data: { status: "QUEUED", ingestError: null, finishedAt: null },
		});
		expect(mocks.kafka.publish).toHaveBeenCalledTimes(1);
	});

	it("conflicts while the task is in flight", async () => {
		const mocks = createMocks();
		mocks.prisma.textDownloadTask.create.mockRejectedValue(uniqueViolation());
		mocks.prisma.textDownloadTask.findUnique.mockResolvedValue(taskRow({ status: "PROCESSING" }));
		const service = createService(mocks);

		await expect(service.create(request)).rejects.toThrow(ConflictException);

		expect(mocks.prisma.textDownloadTask.update).not.toHaveBeenCalled();
		expect(mocks.kafka.publish).not.toHaveBeenCalled();
	});

	it("conflicts once the text is ingested, naming its id", async () => {
		const mocks = createMocks();
		mocks.prisma.textDownloadTask.create.mockRejectedValue(uniqueViolation());
		mocks.prisma.textDownloadTask.findUnique.mockResolvedValue(
			taskRow({ status: "READY", textId: 42, finishedAt: new Date() }),
		);
		const service = createService(mocks);

		await expect(service.create(request)).rejects.toThrow(/textId=42/);

		expect(mocks.kafka.publish).not.toHaveBeenCalled();
	});

	it("deletes a brand new task when Kafka refuses the message", async () => {
		const mocks = createMocks();
		mocks.prisma.textDownloadTask.create.mockResolvedValue(taskRow());
		mocks.kafka.publish.mockRejectedValue(new Error("broker unavailable"));
		const service = createService(mocks);

		await expect(service.create(request)).rejects.toThrow(ServiceUnavailableException);

		expect(mocks.prisma.textDownloadTask.delete).toHaveBeenCalledWith({ where: { id: 7 } });
		expect(mocks.prisma.textDownloadTask.update).not.toHaveBeenCalled();
	});

	it("returns a re-queued task to FAILED when Kafka refuses the message", async () => {
		const mocks = createMocks();
		mocks.prisma.textDownloadTask.create.mockRejectedValue(uniqueViolation());
		mocks.prisma.textDownloadTask.findUnique.mockResolvedValue(taskRow({ status: "FAILED" }));
		mocks.prisma.textDownloadTask.update
			.mockResolvedValueOnce(taskRow())
			.mockResolvedValue(taskRow({ status: "FAILED", ingestError: "not queued" }));
		mocks.kafka.publish.mockRejectedValue(new Error("broker unavailable"));
		const service = createService(mocks);

		await expect(service.create(request)).rejects.toThrow(ServiceUnavailableException);

		// строка чужая — удалять её нельзя, только вернуть в терминальный статус
		expect(mocks.prisma.textDownloadTask.delete).not.toHaveBeenCalled();
		expect(mocks.prisma.textDownloadTask.update).toHaveBeenLastCalledWith({
			where: { id: 7 },
			data: expect.objectContaining({
				status: "FAILED",
				ingestError: expect.stringContaining("broker unavailable"),
			}),
		});
	});

	it("wraps an unexpected database failure as a server error", async () => {
		const mocks = createMocks();
		mocks.prisma.textDownloadTask.create.mockRejectedValue(new Error("connection lost"));
		const service = createService(mocks);

		await expect(service.create(request)).rejects.toThrow(InternalServerErrorException);

		expect(mocks.kafka.publish).not.toHaveBeenCalled();
	});
});

describe("TextService.getTaskStatus", () => {
	it("carries the produced text once the task reached READY", async () => {
		const mocks = createMocks();
		const finishedAt = new Date("2026-09-10T12:00:02.000Z");
		mocks.prisma.textDownloadTask.findUnique.mockResolvedValue({
			id: 7,
			status: "READY",
			source: "GUTENBERG",
			sourceObjId: 11,
			ingestError: null,
			finishedAt,
			textId: 3,
			text: { id: 3, title: "Alice's Adventures in Wonderland", _count: { sentences: 1734 } },
		});
		const service = createService(mocks);

		await expect(service.getTaskStatus(7)).resolves.toEqual({
			taskId: 7,
			status: "READY",
			source: "GUTENBERG",
			sourceObjId: 11,
			textId: 3,
			textTitle: "Alice's Adventures in Wonderland",
			sentenceCount: 1734,
			ingestError: null,
			finishedAt,
		});
	});

	it("exposes the failure reason of a terminal task", async () => {
		const mocks = createMocks();
		mocks.prisma.textDownloadTask.findUnique.mockResolvedValue({
			...taskRow({ status: "FAILED", ingestError: "Gutenberg API resource not found: /books/11" }),
			text: null,
		});
		const service = createService(mocks);

		await expect(service.getTaskStatus(7)).resolves.toEqual(
			expect.objectContaining({
				status: "FAILED",
				ingestError: "Gutenberg API resource not found: /books/11",
				textId: null,
				sentenceCount: 0,
			}),
		);
	});

	it("answers 404 for an unknown task id", async () => {
		const mocks = createMocks();
		mocks.prisma.textDownloadTask.findUnique.mockResolvedValue(null);
		const service = createService(mocks);

		await expect(service.getTaskStatus(404)).rejects.toThrow(NotFoundException);
	});
});
