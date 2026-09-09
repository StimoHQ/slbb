import { type SupportedLanguage } from "../interfaces";

/**
 * Сырое обозначение языка (код каталога источника, ISO-639, вывод LibreTranslate) → enum проекта.
 * Ключи — lower-case алиасы; маппинг живёт в text-модуле, т.к. переиспользуется всеми источниками.
 */
const RAW_LANGUAGE_ALIASES: Record<string, SupportedLanguage> = {
	en: "ENG",
	eng: "ENG",
	english: "ENG",
	us: "ENG",
	"en-us": "ENG",
};

export function toSupportedLanguage(raw: string): SupportedLanguage {
	const mapped = RAW_LANGUAGE_ALIASES[raw.trim().toLowerCase()];

	if (!mapped) {
		throw new Error(`Unsupported language: ${raw}`);
	}

	return mapped;
}
