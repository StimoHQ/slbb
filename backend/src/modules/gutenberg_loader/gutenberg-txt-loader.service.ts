import { HttpService } from "@nestjs/axios";
import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createReadStream } from "fs";
import { access } from "fs/promises";
import { resolve } from "path";
import { firstValueFrom } from "rxjs";
import { StringDecoder } from "string_decoder";
import { Readable } from "stream";
import { UnsupportedLanguageException } from "../../common/exceptions";
import { LibreTranslateService } from "../libretranslate/libretranslate.service";
import { SupportedLanguage, TextLanguageSource, TextLoader, TextLoadMeta, TextLoadResult } from "../text/interfaces";
import { toSupportedLanguage } from "../text/utils";
import {
	GutenbergHeader,
	extractDetectionSample,
	isBookBodyStarted,
	parseGutenbergHeader,
} from "./utils/gutenberg-txt-header";
import {
	GUTENBERG_BASE_URL,
	GUTENBERG_LOCAL_DIR,
	GUTENBERG_SOURCE_TYPES,
	HTTP_TIMEOUT_MS,
	LANGUAGE_PROBE_BYTES,
	MAX_BOOK_BYTES,
	buildTxtUrl,
	gutenbergTxtFileName,
} from "./utils/gutenberg.constants";

type LanguageDecision = { language: SupportedLanguage; source: TextLanguageSource };

type BookSource = { origin: string; open: (signal: AbortSignal) => Promise<Readable> };

type ReadOutcome = LanguageDecision & { header: GutenbergHeader; content: string };

@Injectable()
export class GutenbergTxtLoaderService implements TextLoader {
	private readonly logger = new Logger(GutenbergTxtLoaderService.name);

	constructor(
		private readonly httpService: HttpService,
		private readonly configService: ConfigService,
		private readonly libreTranslate: LibreTranslateService,
	) {}

	/**
	 * Скачивает plain-text книги целиком, но язык подтверждает на первых байтах:
	 * неподдерживаемый язык обрывает чтение, не дожидаясь конца файла.
	 */
	public async loadText(bookId: number): Promise<TextLoadResult> {
		const source = this.resolveSource(bookId);
		const abortDownload = new AbortController();
		let stream: Readable | undefined;

		try {
			stream = await source.open(abortDownload.signal);
			// Поток уничтожается досрочно (язык не подошёл либо лимит размера), и оборванная связь может выстрелить
			// 'error' уже после выхода из цикла — без слушателя это было бы необработанное исключение процесса.
			stream.on("error", () => undefined);

			const { language, source: languageSource, header, content } = await this.readWhileCheckingLanguage(stream);

			this.logger.log(
				`Book #${bookId} has been read from ${source.origin}: ${content.length} chars, language ${language} confirmed by ${languageSource}`,
			);

			return {
				title: header.title,
				language,
				content,
				meta: {
					languageSource,
					origin: source.origin,
					rawLanguage: header.languageRaw ?? undefined,
				},
			};
		} catch (error) {
			// Вердикт уже отрицательный или файл не влезает в лимит — скачивать остаток незачем.
			abortDownload.abort();

			throw error;
		} finally {
			if (stream && !stream.destroyed) {
				stream.destroy();
			}
		}
	}

	private resolveSource(bookId: number): BookSource {
		const sourceType = this.configService.get<string>("GUTENBERG_SOURCE_TYPE") ?? GUTENBERG_SOURCE_TYPES.url;

		if (sourceType === GUTENBERG_SOURCE_TYPES.local) {
			return this.localSource(bookId);
		}

		if (sourceType === GUTENBERG_SOURCE_TYPES.url) {
			return this.remoteSource(bookId);
		}

		throw new BadRequestException(
			`GUTENBERG_SOURCE_TYPE="${sourceType}" is unknown, expected "${GUTENBERG_SOURCE_TYPES.url}" or "${GUTENBERG_SOURCE_TYPES.local}"`,
		);
	}

	private remoteSource(bookId: number): BookSource {
		const baseUrl = this.configService.get<string>("GUTENBERG_BASE_URL") ?? GUTENBERG_BASE_URL;
		const url = buildTxtUrl(baseUrl, bookId);

		return {
			origin: url,
			open: (signal) => this.download(url, signal),
		};
	}

	private localSource(bookId: number): BookSource {
		const localDir = this.configService.get<string>("GUTENBERG_LOCAL_DIR") ?? GUTENBERG_LOCAL_DIR;
		const filePath = resolve(process.cwd(), localDir, gutenbergTxtFileName(bookId));

		return {
			origin: filePath,
			open: async () => {
				try {
					await access(filePath);
				} catch {
					throw new BadRequestException(`Book file has not been found at ${filePath}`);
				}

				return createReadStream(filePath);
			},
		};
	}

	private async download(url: string, signal: AbortSignal): Promise<Readable> {
		this.logger.log(`Downloading the book from ${url}`);

		try {
			const response = await firstValueFrom(
				this.httpService.get<Readable>(url, { responseType: "stream", timeout: HTTP_TIMEOUT_MS, signal }),
			);

			return response.data;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error";

			throw new BadRequestException(`Failed to download the book from ${url}: ${errorMessage}`);
		}
	}

	/**
	 * Читает поток одним проходом: копит байты, а как только набрано достаточно для решения о языке
	 * (шапка закрыта маркером начала текста либо исчерпан LANGUAGE_PROBE_BYTES) — принимает его.
	 * Отрицательный вердикт бросает исключение, и for-await обрывает стрим на середине загрузки.
	 */
	private async readWhileCheckingLanguage(stream: Readable): Promise<ReadOutcome> {
		const decoder = new StringDecoder("utf8");
		const chunks: string[] = [];
		let probeText = "";
		let totalBytes = 0;
		let decision: LanguageDecision | null = null;

		for await (const chunk of stream) {
			const buffer = chunk as Buffer;
			totalBytes += buffer.length;

			if (totalBytes > MAX_BOOK_BYTES) {
				throw new BadRequestException(`Book is larger than the allowed ${MAX_BOOK_BYTES / (1024 * 1024)} MB`);
			}

			const text = decoder.write(buffer);

			if (!text) {
				continue;
			}

			chunks.push(text);

			if (decision) {
				continue;
			}

			probeText += text;

			if (!isBookBodyStarted(probeText) && totalBytes < LANGUAGE_PROBE_BYTES) {
				continue;
			}

			decision = await this.decideLanguage(probeText);
		}

		const rest = decoder.end();

		if (rest) {
			chunks.push(rest);
		}

		// Файл целиком короче пробного бюджета: решаем по тому же образцу, но уже после конца потока.
		decision ??= await this.decideLanguage(probeText);

		return { ...decision, header: parseGutenbergHeader(probeText), content: chunks.join("") };
	}

	private async decideLanguage(probeText: string): Promise<LanguageDecision> {
		const { languageRaw } = parseGutenbergHeader(probeText);

		if (languageRaw) {
			const supported = toSupportedLanguage(languageRaw);

			if (!supported) {
				throw new UnsupportedLanguageException(`the source declares "${languageRaw}"`);
			}

			return { language: supported, source: "source-header" };
		}

		const detected = await this.libreTranslate.detect(extractDetectionSample(probeText));

		if (!detected) {
			throw new UnsupportedLanguageException(
				"the source declares no Language and no supported language has been detected",
			);
		}

		return { language: detected, source: "libretranslate" };
	}
}
