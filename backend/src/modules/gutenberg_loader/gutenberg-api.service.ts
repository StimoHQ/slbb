import { HttpService } from "@nestjs/axios";
import {
	BadRequestException,
	HttpException,
	HttpStatus,
	Injectable,
	InternalServerErrorException,
	Logger,
	NotFoundException,
	UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { isAxiosError } from "axios";
import { firstValueFrom } from "rxjs";

import {
	type GutenbergBookMeta,
	type GutenbergCleanedText,
	type GutenbergEnvelope,
} from "./interfaces/gutenberg-api.interface";

/**
 * Клиент RapidAPI-агрегатора каталога Project Gutenberg.
 * Хост и ключ — из окружения; эндпоинты — от корня хоста (префикс /api из
 * servers.url спеки на подписном хосте не работает, проверено живым запросом).
 */
@Injectable()
export class GutenbergApiService {
	private readonly logger = new Logger(GutenbergApiService.name);
	private readonly baseUrl: string;
	private readonly headers: Record<string, string>;

	constructor(
		private readonly httpService: HttpService,
		configService: ConfigService,
	) {
		const host = configService.getOrThrow<string>("X-RapidAPI-Host-Gutenberg");
		this.baseUrl = `https://${host}`;
		this.headers = {
			"X-RapidAPI-Key": configService.getOrThrow<string>("X-RapidAPI-Key"),
			"X-RapidAPI-Host": host,
			Accept: "application/json",
		};
	}

	/** Карточка текста из каталога источника (1 запрос к квоте RapidAPI). */
	public async getBookMeta(sourceObjId: number): Promise<GutenbergBookMeta> {
		const envelope = await this.request<GutenbergEnvelope<GutenbergBookMeta>>(
			"getBookMeta",
			`/books/${sourceObjId}`,
		);

		const meta = envelope.results[0];

		if (!meta) {
			throw new NotFoundException(`Source object ${sourceObjId} is not found at Gutenberg`);
		}

		return meta;
	}

	/**
	 * Полный текст без Gutenberg-шапки/подвала: режим simple чистит boilerplate,
	 * но сохраняет заголовки и structure (super вырезает сноски и может съесть валидный контент).
	 */
	public async getCleanedText(sourceObjId: number): Promise<GutenbergCleanedText> {
		return this.request<GutenbergCleanedText>("getCleanedText", `/books/${sourceObjId}/text`, {
			params: { cleaning_mode: "simple" },
		});
	}

	private async request<T>(
		operation: string,
		path: string,
		options?: { params?: Record<string, string> },
	): Promise<T> {
		try {
			const { data } = await firstValueFrom(
				this.httpService.get<T>(`${this.baseUrl}${path}`, {
					headers: this.headers,
					params: options?.params,
				}),
			);

			return data;
		} catch (error) {
			// Сообщения axios могут содержать URL — логируем свой контекст, секреты не попадают в лог.
			this.logger.error(`Gutenberg API ${operation} failed: path=${path}`);

			if (isAxiosError(error)) {
				switch (error.response?.status) {
					case 400:
						throw new BadRequestException(`Gutenberg API rejected request: ${path}`);
					case 401:
					case 403:
						throw new UnauthorizedException("RapidAPI key rejected by Gutenberg API");
					case 404:
						throw new NotFoundException(`Gutenberg API resource not found: ${path}`);
					case 429:
						// Готового класса под 429 в Nest нет — отдаём точный статус вверх.
						throw new HttpException("Gutenberg API quota exceeded", HttpStatus.TOO_MANY_REQUESTS);
					default:
						throw new InternalServerErrorException(`Gutenberg API ${operation} error`);
				}
			}

			throw error;
		}
	}
}
