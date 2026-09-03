import { HttpService } from "@nestjs/axios";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { firstValueFrom } from "rxjs";
import { SupportedLanguage } from "../text/interfaces";
import {
	DETECT_ENDPOINT,
	DETECT_MIN_CONFIDENCE,
	DETECT_TIMEOUT_MS,
	LIBRETRANSLATE_DEFAULT_URL,
} from "./utils";
import { toSupportedLanguage } from "../text/utils";

type DetectedLanguage = { language?: string; confidence?: number };

/** LibreTranslate отвечает объектом на одиночный `q` и массивом на список — нормализуем обе формы. */
type DetectResponse = { detectedLanguage?: DetectedLanguage } | DetectedLanguage[];

@Injectable()
export class LibreTranslateService {
	private readonly logger = new Logger(LibreTranslateService.name);

	constructor(
		private readonly httpService: HttpService,
		private readonly configService: ConfigService,
	) {}

	/**
	 * Поддерживаемый LearningLanguage по образцу текста, либо null, если LibreTranslate недоступен,
	 * ответил неуверенно или распознал язык, которого в проекте нет.
	 */
	public async detect(text: string): Promise<SupportedLanguage | null> {
		// URL читается при вызове, а не в конструкторе: приложение должно стартовать без поднятого LibreTranslate.
		const baseUrl = (this.configService.get<string>("LIBRETRANSLATE_URL") ?? LIBRETRANSLATE_DEFAULT_URL).replace(
			/\/+$/,
			"",
		);
		let detected: DetectedLanguage | undefined;

		try {
			const { data } = await firstValueFrom(
				this.httpService.post<DetectResponse>(
					`${baseUrl}${DETECT_ENDPOINT}`,
					new URLSearchParams({ q: text }),
					{
						timeout: DETECT_TIMEOUT_MS,
					},
				),
			);

			detected = Array.isArray(data) ? data[0] : data?.detectedLanguage;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error";
			this.logger.error(`Language detection request to ${baseUrl}${DETECT_ENDPOINT} failed: ${errorMessage}`);

			return null;
		}

		if (!detected?.language) {
			this.logger.warn(`Language detection returned no language for the given sample`);

			return null;
		}

		if (typeof detected.confidence === "number" && detected.confidence < DETECT_MIN_CONFIDENCE) {
			this.logger.warn(
				`Detected "${detected.language}" with confidence ${detected.confidence}, below ${DETECT_MIN_CONFIDENCE}`,
			);

			return null;
		}

		return toSupportedLanguage(detected.language);
	}
}
