import { BadRequestException } from "@nestjs/common";
import { of, throwError } from "rxjs";

import { type ConfigService } from "@nestjs/config";
import { type HttpService } from "@nestjs/axios";
import { GutenbergTxtLoader } from "../gutenberg-txt.loader";
import { type GutenbergApiService } from "../gutenberg-api.service";
import { type GutenbergBookMeta, type GutenbergCleanedText } from "../interfaces/gutenberg-api.interface";

const meta = (over: Partial<GutenbergBookMeta> = {}): GutenbergBookMeta => ({
	id: 11,
	title: "Alice's Adventures in Wonderland",
	alternative_title: null,
	authors: [],
	languages: ["en"],
	is_available: true,
	...over,
});

const cleaned = (over: Partial<GutenbergCleanedText> = {}): GutenbergCleanedText => ({
	book_id: 11,
	title: "Alice's Adventures in Wonderland",
	alternative_title: null,
	cleaning_mode: "simple",
	text: "Alice was beginning to get very tired of sitting by her sister.",
	metadata: {
		original_length: 168_000,
		cleaned_length: 160_000,
		source_format: "text/plain; charset=utf-8",
		source_url: "https://www.gutenberg.org/files/11/11-0.txt",
	},
	...over,
});

function createLoader(overrides: {
	meta?: GutenbergBookMeta;
	text?: GutenbergCleanedText;
	detect?: { language: string; confidence: number }[];
	detectError?: boolean;
}) {
	const apiMock = {
		getBookMeta: jest.fn().mockResolvedValue(overrides.meta ?? meta()),
		getCleanedText: jest.fn().mockResolvedValue(overrides.text ?? cleaned()),
	};
	const postMock = jest
		.fn()
		.mockReturnValue(
			overrides.detectError ? throwError(() => new Error("LT down")) : of({ data: overrides.detect ?? [] }),
		);

	const configMock = {
		getOrThrow: (key: string) =>
			key === "LIBRETRANSLATE_URL"
				? "http://localhost:5000"
				: (() => {
						throw new Error(`Unexpected config key ${key}`);
					})(),
	} as unknown as ConfigService;

	const loader = new GutenbergTxtLoader(
		apiMock as unknown as GutenbergApiService,
		{ post: postMock } as unknown as HttpService,
		configMock,
	);

	return { loader, apiMock, postMock };
}

describe("GutenbergTxtLoader", () => {
	it("loads text and resolves language from catalog metadata without detection", async () => {
		const { loader, postMock } = createLoader({});

		const result = await loader.load(11);

		expect(result).toMatchObject({
			title: "Alice's Adventures in Wonderland",
			language: "ENG",
		});
		expect(result.content).toContain("Alice was beginning");
		expect(postMock).not.toHaveBeenCalled();
	});

	it("falls back to LibreTranslate detection when languages[] is empty", async () => {
		const { loader, postMock } = createLoader({
			meta: meta({ languages: [] }),
			detect: [{ language: "en", confidence: 93 }],
		});

		const result = await loader.load(11);

		expect(result.language).toBe("ENG");
		expect(postMock).toHaveBeenCalledWith("http://localhost:5000/detect", expect.any(Object));
		// Детектим фрагмент, а не весь текст
		expect(postMock.mock.calls[0][1].q.length).toBeLessThanOrEqual(2000);
	});

	it("rejects a book whose detected language is not supported", async () => {
		const { loader } = createLoader({
			meta: meta({ languages: ["fr"] }),
			detect: [{ language: "ru", confidence: 99 }],
		});

		await expect(loader.load(11)).rejects.toThrow(BadRequestException);
	});

	it("rejects a removed book before fetching its text", async () => {
		const { loader, apiMock } = createLoader({
			meta: meta({ removed_from_catalog: "2025-01-01T00:00:00.000Z" }),
		});

		await expect(loader.load(11)).rejects.toThrow("has been removed from the catalog");
		expect(apiMock.getCleanedText).not.toHaveBeenCalled();
	});

	it("guards against oversized sources", async () => {
		const { loader } = createLoader({
			text: cleaned({
				metadata: {
					original_length: 6 * 1024 * 1024,
					cleaned_length: 6 * 1024 * 1024,
					source_format: "text/plain",
					source_url: "x",
				},
			}),
		});

		await expect(loader.load(11)).rejects.toThrow("exceeds maximum size");
	});

	it("rejects when detection service is unavailable and metadata gives no supported language", async () => {
		const { loader } = createLoader({ meta: meta({ languages: [] }), detectError: true });

		await expect(loader.load(11)).rejects.toThrow("is not supported or unrecognizable");
	});
});
