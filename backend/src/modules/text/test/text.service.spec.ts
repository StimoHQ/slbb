import { BadRequestException, ConflictException, InternalServerErrorException, Logger } from "@nestjs/common";
import { PrismaClientKnownRequestError } from "prisma/generated/internal/prismaNamespace";
import { UnsupportedLanguageException } from "../../../common/exceptions";
import { GutenbergTxtLoaderService } from "../../gutenberg_loader/gutenberg-txt-loader.service";
import { PrismaService } from "../../prisma/prisma.service";
import { TextLoadResult } from "../interfaces";
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

function buildService(loadText: jest.Mock, create: jest.Mock) {
	const prismaService = { text: { create } } as unknown as PrismaService;
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

	it("turns a duplicate import into a conflict", async () => {
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
