import { IngestionService } from "../ingestion.service";

type TxMock = {
	text: { create: jest.Mock };
	textSentence: { createMany: jest.Mock };
	textDownloadTask: { update: jest.Mock };
};

function createMocks() {
	const tx: TxMock = {
		text: { create: jest.fn().mockResolvedValue({ id: 100 }) },
		textSentence: { createMany: jest.fn() },
		textDownloadTask: { update: jest.fn() },
	};

	const prisma = {
		textDownloadTask: {
			updateMany: jest.fn().mockResolvedValue({ count: 1 }),
			findUnique: jest.fn(),
			update: jest.fn().mockResolvedValue(undefined),
		},
		$transaction: jest.fn((cb: (t: TxMock) => Promise<unknown>) => cb(tx)),
	};

	const loader = { load: jest.fn() };

	return { prisma, loader, tx };
}

function createService(mocks: ReturnType<typeof createMocks>) {
	return new IngestionService(mocks.prisma as never, mocks.loader as never);
}

const queuedTask = {
	id: 1,
	sourceObjId: 11,
	source: "GUTENBERG",
};

const loaded = {
	title: "Alice's Adventures in Wonderland",
	content: "One. Two. Three.",
	language: "ENG" as const,
};

describe("IngestionService.process", () => {
	it("skips a task that cannot be claimed (already READY/FAILED or gone)", async () => {
		const mocks = createMocks();
		mocks.prisma.textDownloadTask.updateMany.mockResolvedValue({ count: 0 });
		const service = createService(mocks);

		await expect(service.process(1)).resolves.toBe(false);

		expect(mocks.loader.load).not.toHaveBeenCalled();
	});

	it("creates the text and closes the task when everything goes well", async () => {
		const mocks = createMocks();
		mocks.prisma.textDownloadTask.findUnique.mockResolvedValue(queuedTask);
		mocks.loader.load.mockResolvedValue(loaded);
		const service = createService(mocks);

		await expect(service.process(1)).resolves.toBe(true);

		// claim: только QUEUED/зависший PROCESSING берутся в работу
		expect(mocks.prisma.textDownloadTask.updateMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: {
					id: 1,
					status: { in: ["QUEUED", "PROCESSING"] },
				},
			}),
		);
		expect(mocks.loader.load).toHaveBeenCalledWith(11);

		// Text рождается только здесь — ни статуса, ни ошибки у него больше нет
		expect(mocks.tx.text.create).toHaveBeenCalledWith({
			data: {
				title: loaded.title,
				language: loaded.language,
				source: "GUTENBERG",
				sourceObjId: 11,
			},
		});
		expect(mocks.tx.textSentence.createMany).toHaveBeenCalledWith({
			data: [
				{ textId: 100, position: 0, content: "One." },
				{ textId: 100, position: 1, content: "Two." },
				{ textId: 100, position: 2, content: "Three." },
			],
		});
		expect(mocks.tx.textDownloadTask.update).toHaveBeenCalledWith({
			where: { id: 1 },
			data: expect.objectContaining({ status: "READY", textId: 100 }),
		});
		expect(mocks.tx.textDownloadTask.update.mock.calls[0][0].data.finishedAt).toBeInstanceOf(Date);
	});

	it("inserts sentences in batches of 500", async () => {
		const mocks = createMocks();
		mocks.prisma.textDownloadTask.findUnique.mockResolvedValue(queuedTask);
		mocks.loader.load.mockResolvedValue({
			...loaded,
			content: Array.from({ length: 501 }, (_unused, i) => `Alpha ${i} beta.`).join(" "),
		});
		const service = createService(mocks);

		await service.process(1);

		const calls = mocks.tx.textSentence.createMany.mock.calls;
		expect(calls).toHaveLength(2);
		expect(calls[0][0].data).toHaveLength(500);
		expect(calls[1][0].data).toHaveLength(1);
		// позиции сквозные, без разрывов после границы батча
		expect(calls[1][0].data[0].position).toBe(500);
	});

	it("marks the task FAILED with the reason when the loader fails", async () => {
		const mocks = createMocks();
		mocks.prisma.textDownloadTask.findUnique.mockResolvedValue(queuedTask);
		mocks.loader.load.mockRejectedValue(new Error("Gutenberg API error"));
		const service = createService(mocks);

		await expect(service.process(1)).rejects.toThrow("Gutenberg API error");

		expect(mocks.prisma.textDownloadTask.update).toHaveBeenCalledWith({
			where: { id: 1 },
			data: expect.objectContaining({ status: "FAILED", ingestError: "Gutenberg API error" }),
		});
		expect(mocks.tx.text.create).not.toHaveBeenCalled();
	});

	it("treats a text without recognized sentences as a failure", async () => {
		const mocks = createMocks();
		mocks.prisma.textDownloadTask.findUnique.mockResolvedValue(queuedTask);
		mocks.loader.load.mockResolvedValue({ ...loaded, content: "  \n " });
		const service = createService(mocks);

		await expect(service.process(1)).rejects.toThrow("No sentences recognized");

		expect(mocks.tx.textSentence.createMany).not.toHaveBeenCalled();
	});

	it("survives a missing row during the FAILED bookkeeping", async () => {
		const mocks = createMocks();
		mocks.prisma.textDownloadTask.findUnique.mockResolvedValue(queuedTask);
		mocks.loader.load.mockRejectedValue(new Error("boom"));
		mocks.prisma.textDownloadTask.update.mockRejectedValue(new Error("row deleted"));
		const service = createService(mocks);

		// исходная ошибка важнее ошибки логирования статуса
		await expect(service.process(1)).rejects.toThrow("boom");
	});
});
