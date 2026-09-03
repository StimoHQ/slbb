import { SupportedLanguage } from "../interfaces";

/**
 * Обозначения языка, которые встречаются у источников: строки шапки Gutenberg (`Language: English`),
 * коды LibreTranslate (`en`), прочая запись того же языка (`eng`, `en-US`).
 * Ключи — значения LearningLanguage, поэтому компилятор требует описать алиасы для каждого языка схемы.
 */
const LANGUAGE_ALIASES: Record<SupportedLanguage, readonly string[]> = {
	ENG: ["english", "eng", "en", "en-us", "en-gb"],
};

// Оставляем только буквы и дефисы: "English." → "english", а "English; French" → "englishfrench" (не совпадёт ни с чем).
function normalizeLanguageToken(rawLanguage: string): string {
	return rawLanguage
		.trim()
		.toLowerCase()
		.replace(/[^a-z-]/g, "");
}

/**
 * Сырое обозначение языка из внешнего источника в SupportedLanguage проекта.
 * Возвращает null, если язык неизвестен или не поддерживается (в том числе мультиязычные книги),
 * поэтому вызывать обязан источник-агностичный код, а не конкретный лоадер.
 */
export function toSupportedLanguage(rawLanguage: string | null | undefined): SupportedLanguage | null {
	const normalized = normalizeLanguageToken(rawLanguage ?? "");

	if (!normalized) {
		return null;
	}

	for (const [supported, aliases] of Object.entries(LANGUAGE_ALIASES) as [SupportedLanguage, readonly string[]][]) {
		if (aliases.includes(normalized)) {
			return supported;
		}
	}

	return null;
}
