import { HttpService } from "@nestjs/axios";
import { BadRequestException, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { readFile } from "fs/promises";
import { Readable } from "stream";
import { of, throwError } from "rxjs";
import { UnsupportedLanguageException } from "../../../common/exceptions";
import { LibreTranslateService } from "../../libretranslate/libretranslate.service";
import { GUTENBERG_BASE_URL, MAX_BOOK_BYTES } from "../utils/gutenberg.constants";
import { GutenbergTxtLoaderService } from "../gutenberg-txt-loader.service";

const BOOK_ID = 79501;
const BOOK_URL = `${GUTENBERG_BASE_URL}/${BOOK_ID}/pg${BOOK_ID}.txt`;

const HEADER_EN = [
	"The Project Gutenberg eBook of The electronic siege",
	"",
	"Title: The electronic siege",
	"",
	"Language: English",
	"",
].join("\n");

const BODY_MARKER = "*** START OF THE PROJECT GUTENBERG EBOOK THE ELECTRONIC SIEGE ***\n\n";

function proseChunks(count: number, size: number): string[] {
	return Array.from(
		{ length: count },
		(_unused, index) => `${"The dock guard stared. ".repeat(Math.ceil(size / 21))}${index}\n`,
	);
}

/** Поток, который можно "поймать" на середине: важно, что читатель дошёл до вердикта, а не до конца файла. */
function trackedStream(chunks: string[]) {
	let served = 0;

	const stream = new Readable({
		read() {
			if (served >= chunks.length) {
				this.push(null);

				return;
			}

			served += 1;
			this.push(Buffer.from(chunks[served - 1], "utf8"));
		},
	});

	return { stream, reachedEnd: () => served >= chunks.length };
}

function buildService(
	chunks: string[],
	env: Record<string, string> = { GUTENBERG_SOURCE_TYPE: "url" },
	detected: "ENG" | "RU" | null = null,
) {
	const { stream, reachedEnd } = trackedStream(chunks);
	const requestConfig: { signal?: AbortSignal } = {};
	const get = jest.fn().mockImplementation((_url: string, config: { signal: AbortSignal }) => {
		requestConfig.signal = config.signal;

		return of({ data: stream });
	});
	const detect = jest.fn().mockResolvedValue(detected === "RU" ? null : detected);
	const httpService = { get } as unknown as HttpService;
	const configService = { get: (key: string) => env[key] } as unknown as ConfigService;
	const libreTranslate = { detect } as unknown as LibreTranslateService;

	return {
		service: new GutenbergTxtLoaderService(httpService, configService, libreTranslate),
		get,
		detect,
		reachedEnd,
		isDownloadAborted: () => requestConfig.signal?.aborted === true,
	};
}

describe("GutenbergTxtLoaderService", () => {
	beforeAll(() => {
		jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
	});

	describe("language is declared in the header", () => {
		const supportedChunks = [
			`${HEADER_EN}${BODY_MARKER}`,
			...proseChunks(8, 2048),
			"*** END OF THE PROJECT GUTENBERG EBOOK ***\n",
		];

		it("returns the file as-is with the header title", async () => {
			const { service, get, detect } = buildService(supportedChunks);

			const book = await service.loadText(BOOK_ID);

			expect(book).toEqual({
				title: "The electronic siege",
				language: "ENG",
				content: supportedChunks.join(""),
				meta: {
					languageSource: "source-header",
					origin: BOOK_URL,
					rawLanguage: "English",
				},
			});
			expect(get).toHaveBeenCalledWith(BOOK_URL, expect.objectContaining({ responseType: "stream" }));
			expect(detect).not.toHaveBeenCalled();
		});

		it("refuses another language without waiting for the end of the download", async () => {
			const russianHeader = HEADER_EN.replace("Language: English", "Language: Russian");
			const { service, detect, reachedEnd, isDownloadAborted } = buildService([
				`${russianHeader}${BODY_MARKER}`,
				...proseChunks(40, 2048),
			]);

			await expect(service.loadText(BOOK_ID)).rejects.toThrow(UnsupportedLanguageException);
			expect(detect).not.toHaveBeenCalled();
			expect(reachedEnd()).toBe(false);
			expect(isDownloadAborted()).toBe(true);
		});
	});

	describe("language is not declared in the header", () => {
		const headerlessChunks = proseChunks(40, 2048);

		it("confirms the language through LibreTranslate and then reads the whole file", async () => {
			const { service, detect, reachedEnd } = buildService(
				headerlessChunks,
				{ GUTENBERG_SOURCE_TYPE: "url" },
				"ENG",
			);

			const book = await service.loadText(BOOK_ID);

			expect(detect).toHaveBeenCalledTimes(1);
			expect(detect).toHaveBeenCalledWith(expect.stringContaining("The dock guard stared"));
			expect(book.language).toBe("ENG");
			expect(book.meta).toEqual({ languageSource: "libretranslate", origin: BOOK_URL, rawLanguage: undefined });
			expect(book.content).toBe(headerlessChunks.join(""));
			expect(reachedEnd()).toBe(true);
		});

		it("refuses the book when the detector does not confirm a supported language", async () => {
			const { service, reachedEnd, isDownloadAborted } = buildService(headerlessChunks, undefined, "RU");

			await expect(service.loadText(BOOK_ID)).rejects.toThrow(UnsupportedLanguageException);
			expect(reachedEnd()).toBe(false);
			expect(isDownloadAborted()).toBe(true);
		});
	});

	describe("local source", () => {
		const env = { GUTENBERG_SOURCE_TYPE: "local", GUTENBERG_LOCAL_DIR: "test-data" };

		it("reads the fixture named after the book id, byte for byte", async () => {
			const { service } = buildService([], env, "ENG");

			const book = await service.loadText(BOOK_ID);

			await expect(readFile(`test-data/pg${BOOK_ID}.txt`, "utf8")).resolves.toBe(book.content);
			expect(book.title).toBe("The electronic siege");
			expect(book.language).toBe("ENG");
			expect(book.meta.origin).toBe(`${process.cwd()}/test-data/pg${BOOK_ID}.txt`);
		});

		it("fails clearly when the fixture is missing", async () => {
			const { service } = buildService([], env);

			await expect(service.loadText(424242)).rejects.toThrow(/pg424242\.txt/);
		});
	});

	it("rejects an unknown source type", async () => {
		const { service } = buildService([], { GUTENBERG_SOURCE_TYPE: "ftp" });

		await expect(service.loadText(BOOK_ID)).rejects.toThrow(BadRequestException);
	});

	it("stops a book over the size limit", async () => {
		const oversized = [
			`${HEADER_EN}${BODY_MARKER}`,
			...proseChunks(Math.ceil(MAX_BOOK_BYTES / 1024 / 1024) + 2, 1024 * 1024),
		];
		const { service, reachedEnd, isDownloadAborted } = buildService(oversized);

		await expect(service.loadText(BOOK_ID)).rejects.toThrow(/larger than the allowed 10 MB/);
		expect(reachedEnd()).toBe(false);
		expect(isDownloadAborted()).toBe(true);
	});

	it("surfaces a connection broken in the middle of the download", async () => {
		const stream = new Readable({ read: () => undefined });
		stream.destroy(new Error("connection reset by peer"));

		const get = jest.fn().mockReturnValue(of({ data: stream }));
		const service = new GutenbergTxtLoaderService(
			{ get } as unknown as HttpService,
			{ get: () => "url" } as unknown as ConfigService,
			{ detect: jest.fn() } as unknown as LibreTranslateService,
		);

		await expect(service.loadText(BOOK_ID)).rejects.toThrow(/connection reset by peer/);
	});

	it("wraps a failed download into a bad request", async () => {
		const get = jest.fn().mockReturnValue(throwError(() => new Error("getaddrinfo ENOTFOUND gutenberg.org")));
		const service = new GutenbergTxtLoaderService(
			{ get } as unknown as HttpService,
			{ get: () => "url" } as unknown as ConfigService,
			{ detect: jest.fn() } as unknown as LibreTranslateService,
		);

		await expect(service.loadText(BOOK_ID)).rejects.toThrow(/Failed to download the book/);
	});
});
