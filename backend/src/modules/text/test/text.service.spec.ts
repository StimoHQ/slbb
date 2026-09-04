import {
	BadRequestException,
	ConflictException,
	InternalServerErrorException,
	Logger,
	NotFoundException,
} from "@nestjs/common";
import { PrismaClientKnownRequestError } from "prisma/generated/internal/prismaNamespace";
import { UnsupportedLanguageException } from "../../../common/exceptions";
import { GutenbergTxtLoaderService } from "../../gutenberg_loader/gutenberg-txt-loader.service";
import { PrismaService } from "../../prisma/prisma.service";
import { TextLoadResult } from "../interfaces";
import { CHUNK_MAX_SCAN_MULTIPLIER, codePointCount } from "../utils";
import { TextService } from "../text.service";

const BOOK_ID = 79501;

const LOADED_BOOK: TextLoadResult = {
	title: "The electronic siege",
	language: "ENG",
	content: "The Project Gutenberg eBook of The electronic siege\n",
	meta: {
		languageSource: "source-header",
		origin: "https://www.gutenberg.org/cache/epub/79501/pg79501.txt",
		rawLanguage: "English",
	},
};

function knownRequestError(code: string): PrismaClientKnownRequestError {
	const error = Object.create(PrismaClientKnownRequestError.prototype) as PrismaClientKnownRequestError;
	Object.defineProperty(error, "code", { value: code });
	Object.defineProperty(error, "message", { value: "Unique constraint failed" });

	return error;
}

function buildService(
	loadText: jest.Mock,
	create: jest.Mock,
	findUnique: jest.Mock = jest.fn().mockResolvedValue(null),
) {
	const prismaService = { text: { create, findUnique } } as unknown as PrismaService;
	const loader = { loadText } as unknown as GutenbergTxtLoaderService;

	return new TextService(prismaService, loader);
}

describe("TextService.create", () => {
	const dto = { bookId: BOOK_ID, title: "Fallback title" };

	beforeAll(() => {
		jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
	});

	it("stores the book and answers with the id and the title only", async () => {
		const loadText = jest.fn().mockResolvedValue(LOADED_BOOK);
		const create = jest.fn().mockResolvedValue({ id: 7, title: "The electronic siege" });
		const service = buildService(loadText, create);

		const response = await service.create(dto);

		expect(response).toStrictEqual({ id: 7, title: "The electronic siege" });
		expect(loadText).toHaveBeenCalledWith(BOOK_ID);
		expect(create).toHaveBeenCalledWith({
			data: {
				title: "The electronic siege",
				language: "ENG",
				source: "GUTENBERG",
				sourceObjId: BOOK_ID,
				sourceMeta: LOADED_BOOK.meta,
				content: { create: { content: LOADED_BOOK.content } },
			},
			select: { id: true, title: true },
		});
	});

	it("rejects an already imported book without downloading it", async () => {
		const loadText = jest.fn();
		const create = jest.fn();
		const findUnique = jest.fn().mockResolvedValue({ id: 4 });
		const service = buildService(loadText, create, findUnique);

		await expect(service.create(dto)).rejects.toThrow(ConflictException);
		expect(findUnique).toHaveBeenCalledWith({
			where: { source_sourceObjId: { source: "GUTENBERG", sourceObjId: BOOK_ID } },
			select: { id: true },
		});
		expect(loadText).not.toHaveBeenCalled();
		expect(create).not.toHaveBeenCalled();
	});

	it("falls back to the requested title when the source header has none", async () => {
		const loadText = jest.fn().mockResolvedValue({ ...LOADED_BOOK, title: null });
		const create = jest.fn().mockResolvedValue({ id: 8, title: "Fallback title" });
		const service = buildService(loadText, create);

		await service.create(dto);

		expect(create.mock.calls[0][0].data.title).toBe("Fallback title");
	});

	it("lets the language rejection through untouched and writes nothing", async () => {
		const rejection = new UnsupportedLanguageException('the source declares "Russian"');
		const loadText = jest.fn().mockRejectedValue(rejection);
		const create = jest.fn();
		const service = buildService(loadText, create);

		await expect(service.create(dto)).rejects.toBe(rejection);
		expect(create).not.toHaveBeenCalled();
	});

	it("turns a load failure into a bad request", async () => {
		const loadText = jest.fn().mockRejectedValue(new Error("socket hang up"));
		const create = jest.fn();
		const service = buildService(loadText, create);

		await expect(service.create(dto)).rejects.toThrow(BadRequestException);
		expect(create).not.toHaveBeenCalled();
	});

	it("turns the duplicate a concurrent request slipped in into a conflict", async () => {
		const loadText = jest.fn().mockResolvedValue(LOADED_BOOK);
		const create = jest.fn().mockRejectedValue(knownRequestError("P2002"));
		const service = buildService(loadText, create);

		await expect(service.create(dto)).rejects.toThrow(ConflictException);
	});

	it("reports an unexpected database failure as an internal error", async () => {
		const loadText = jest.fn().mockResolvedValue(LOADED_BOOK);
		const create = jest.fn().mockRejectedValue(new Error("connection terminated"));
		const service = buildService(loadText, create);

		await expect(service.create(dto)).rejects.toThrow(InternalServerErrorException);
	});
});

/** Как `substr` в Postgres: окно режется по code points, а значения идут в порядке подстановки в SQL. */
function buildChunkService(content: string, row: Partial<{ title: string; language: string }> | null = {}) {
	const chars = Array.from(content);
	const queryRaw = jest.fn((_sql: unknown, from: number, length: number, _id: number) => {
		if (row === null) {
			return Promise.resolve([]);
		}

		return Promise.resolve([
			{
				title: row?.title ?? "The electronic siege",
				language: row?.language ?? "ENG",
				totalLength: chars.length,
				window: chars.slice(from - 1, from - 1 + length).join(""),
			},
		]);
	});

	const prismaService = { $queryRaw: queryRaw } as unknown as PrismaService;
	const loader = { loadText: jest.fn() } as unknown as GutenbergTxtLoaderService;

	return { service: new TextService(prismaService, loader), queryRaw };
}

describe("TextService.getChunkTextContent", () => {
	const BOOK = [
		"Chapter I",
		"",
		"It was the best of times, it was the worst of times.",
		"It was the age of wisdom, it was the age of foolishness.",
		"",
		"The clocks were striking thirteen in the morning.",
		"Nobody had told him that.",
	].join("\n");

	const chunkOf = (content: string, offset: number, limit: number) =>
		buildChunkService(content).service.getChunkTextContent({ id: 3, offset, limit });

	beforeAll(() => {
		jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
	});

	it("carries the requested limit over to the end of the sentence it falls into", async () => {
		const { service, queryRaw } = buildChunkService(BOOK);

		const chunk = await service.getChunkTextContent({ id: 3, offset: 0, limit: 35 });

		expect(chunk).toStrictEqual({
			textId: 3,
			title: "The electronic siege",
			language: "ENG",
			content: "Chapter I\n\nIt was the best of times, it was the worst of times.\n",
			startOffset: 0,
			endOffset: 64,
			nextOffset: 64,
			totalLength: BOOK.length,
			isEnd: false,
		});
		expect(chunk.content.length).toBeGreaterThan(35);
		expect(queryRaw).toHaveBeenCalledTimes(1);
	});

	it("re-reads up to the scan ceiling when the first window ends inside a sentence", async () => {
		const { service, queryRaw } = buildChunkService(BOOK);

		await service.getChunkTextContent({ id: 3, offset: 0, limit: 20 });

		expect(queryRaw).toHaveBeenCalledTimes(2);
		expect(queryRaw.mock.calls[0].slice(1)).toEqual([1, 40, 3]);
		expect(queryRaw.mock.calls[1].slice(1)).toEqual([1, 20 * CHUNK_MAX_SCAN_MULTIPLIER, 3]);
	});

	it("hands over the whole book chunk by chunk without dropping or repeating a character", async () => {
		const service = buildChunkService(BOOK).service;
		const visited: number[] = [];
		let collected = "";
		let offset = 0;

		for (let page = 0; page < 10; page++) {
			const chunk = await service.getChunkTextContent({ id: 3, offset, limit: 25 });

			visited.push(chunk.endOffset);
			expect(chunk.endOffset).toBeGreaterThan(chunk.startOffset);
			expect(chunk.content).toBe(BOOK.slice(chunk.startOffset, chunk.endOffset));

			collected += chunk.content;
			offset = chunk.endOffset;

			if (chunk.isEnd) {
				expect(chunk.nextOffset).toBeNull();
				expect(chunk.totalLength).toBe(BOOK.length);
				break;
			}
		}

		expect(collected).toBe(BOOK);
		expect(visited[visited.length - 1]).toBe(BOOK.length);
	});

	it("cuts at a word boundary once the sentence search runs out of ceiling", async () => {
		const runOn = Array.from({ length: 60 }, (_unused, index) => `word${index}`).join(" ");
		const chunk = await chunkOf(runOn, 0, 20);
		const straddling = runOn.slice(chunk.endOffset - 1, chunk.endOffset + 1);

		expect(chunk.content.length).toBeGreaterThan(20);
		expect(chunk.endOffset).toBeLessThanOrEqual(20 * CHUNK_MAX_SCAN_MULTIPLIER);
		expect(/\w\w/.test(straddling)).toBe(false);
		expect(chunk.isEnd).toBe(false);
	});

	it("finishes the pagination on the last sentence", async () => {
		const chunk = await chunkOf(BOOK, 0, 10_000);

		expect(chunk.content).toBe(BOOK);
		expect(chunk.startOffset).toBe(0);
		expect(chunk.endOffset).toBe(BOOK.length);
		expect(chunk.nextOffset).toBeNull();
		expect(chunk.isEnd).toBe(true);
	});

	it("counts offsets in code points, not in UTF-16 units", async () => {
		const content = "The 😀 emoji sits inside a sentence. Nothing else follows.";
		const chunk = await chunkOf(content, 0, 10);

		expect(chunk.content).toBe("The 😀 emoji sits inside a sentence. ");
		expect(chunk.content.length).toBeGreaterThan(chunk.endOffset);
		expect(codePointCount(chunk.content)).toBe(chunk.endOffset);
		expect(chunk.totalLength).toBe(Array.from(content).length);
	});

	it("rejects an offset past the end of the text", async () => {
		await expect(chunkOf(BOOK, BOOK.length + 1, 100)).rejects.toThrow(BadRequestException);
	});

	it("answers the very end of the text with an empty finished chunk", async () => {
		const chunk = await chunkOf(BOOK, BOOK.length, 100);

		expect(chunk.content).toBe("");
		expect(chunk.isEnd).toBe(true);
		expect(chunk.nextOffset).toBeNull();
	});

	it("lets a missing text through as a not found", async () => {
		const { service } = buildChunkService(BOOK, null);

		await expect(service.getChunkTextContent({ id: 3, offset: 0, limit: 100 })).rejects.toThrow(NotFoundException);
	});

	it("turns a failing window query into an internal error", async () => {
		const queryRaw = jest.fn().mockRejectedValue(new Error("connection terminated"));
		const service = new TextService(
			{ $queryRaw: queryRaw } as unknown as PrismaService,
			{
				loadText: jest.fn(),
			} as unknown as GutenbergTxtLoaderService,
		);

		await expect(service.getChunkTextContent({ id: 3, offset: 0, limit: 100 })).rejects.toThrow(
			InternalServerErrorException,
		);
	});
});
