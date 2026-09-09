import { HttpService } from "@nestjs/axios";
import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { firstValueFrom } from "rxjs";

import { type SupportedLanguage, type TextLoadResult, type TextLoader } from "../text/interfaces";
import { toSupportedLanguage } from "../text/utils/supported-language";

import { GutenbergApiService } from "./gutenberg-api.service";
import { type GutenbergBookMeta } from "./interfaces/gutenberg-api.interface";

interface DetectResult {
	language: string;
	/** У LibreTranslate 1.9+ уверенность в процентах 0..100. */
	confidence: number;
}

/**
 * Лоадер текстов из Gutenberg: берёт из RapidAPI-агрегатора метаданные и
 * очищенный plain text (режим simple), язык проверяет по каталогу с фолбэком
 * на LibreTranslate /detect. Реализует источник-агностичный контракт TextLoader.
 */
@Injectable()
export class GutenbergTxtLoader implements TextLoader {
	/** Потолок исходного текста (наследует прежний zip-лоадер): не пускаем гигантский JSON в память. */
	private static readonly MAX_SOURCE_LENGTH = 5 * 1024 * 1024;
	/** Минимальная уверенность LibreTranslate (в процентах), чтобы доверять детекции. */
	private static readonly MIN_DETECT_CONFIDENCE = 50;
	/** Фрагмент для детекции языка: whole book через LibreTranslate гонять незачем. */
	private static readonly DETECT_SNIPPET_LENGTH = 2000;

	private readonly logger = new Logger(GutenbergTxtLoader.name);
	private readonly detectUrl: string;

	constructor(
		private readonly gutenbergApi: GutenbergApiService,
		private readonly httpService: HttpService,
		configService: ConfigService,
	) {
		this.detectUrl = `${configService.getOrThrow<string>("LIBRETRANSLATE_URL")}/detect`;
	}

	public async load(sourceObjId: number): Promise<TextLoadResult> {
		const meta = await this.gutenbergApi.getBookMeta(sourceObjId);

		if (meta.removed_from_catalog || meta.is_available === false) {
			throw new BadRequestException(`Source object ${sourceObjId} has been removed from the catalog`);
		}

		const cleaned = await this.gutenbergApi.getCleanedText(sourceObjId);

		if (cleaned.metadata.original_length > GutenbergTxtLoader.MAX_SOURCE_LENGTH) {
			throw new BadRequestException(
				`Source text exceeds maximum size of ${GutenbergTxtLoader.MAX_SOURCE_LENGTH / (1024 * 1024)} MB`,
			);
		}

		const language = await this.resolveLanguage(sourceObjId, meta, cleaned.text);

		this.logger.log(
			`Loaded text ${sourceObjId}: "${cleaned.title}" (${cleaned.metadata.cleaned_length} chars, ${language})`,
		);

		return {
			title: cleaned.title || meta.title,
			content: cleaned.text,
			language,
		};
	}

	/**
	 * Каталог не всегда отдаёт непустой languages[] (известный pitfall API),
	 * поэтому порядковый fallback — эвристическая детекция по фрагменту текста.
	 */
	private async resolveLanguage(
		sourceObjId: number,
		meta: GutenbergBookMeta,
		text: string,
	): Promise<SupportedLanguage> {
		for (const rawLanguage of meta.languages ?? []) {
			try {
				return toSupportedLanguage(rawLanguage);
			} catch {
				// Языки вне списка поддержки просто пропускаем: следующий алиас или детекция решат.
			}
		}

		const detected = await this.detectLanguage(text.slice(0, GutenbergTxtLoader.DETECT_SNIPPET_LENGTH));

		if (detected) {
			try {
				return toSupportedLanguage(detected);
			} catch {
				/* below */
			}
		}

		throw new BadRequestException(`Language of source object ${sourceObjId} is not supported or unrecognizable`);
	}

	private async detectLanguage(snippet: string): Promise<string | null> {
		try {
			const { data } = await firstValueFrom(
				this.httpService.post<DetectResult[]>(this.detectUrl, { q: snippet }),
			);

			const top = data?.[0];

			return top && top.confidence >= GutenbergTxtLoader.MIN_DETECT_CONFIDENCE ? top.language : null;
		} catch (error) {
			// Детекция — best effort: недоступный LT не должен тонуть загрузку,
			// язык не определён → решение примет вызывающий resolveLanguage.
			this.logger.warn(
				`Language detection via LibreTranslate failed: ${error instanceof Error ? error.message : "unknown"}`,
			);

			return null;
		}
	}
}
