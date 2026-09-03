import { type TextContent } from "prisma/generated/browser";
import { type Text } from "prisma/generated/client";
import { LearningLanguage } from "prisma/generated/enums";

const SUPPORTED_LANGUAGES = [LearningLanguage.ENG] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/** Чем именно подтверждён язык книги: декларация в шапке источника или внешний детектор. */
export type TextLanguageSource = "source-header" | "libretranslate";

export type TextLoadMeta = {
	languageSource: TextLanguageSource;
	rawLanguage?: string;
	origin: string;
};

export type TextLoadResult = {
	/** Заголовок из шапки источника; null — если источник его не объявил, запасное значение выбирает вызывающий. */
	title: Text["title"] | null;
	content: TextContent["content"];
	language: SupportedLanguage;
	meta: TextLoadMeta;
};

export interface TextLoader {
	loadText(bookId: number): Promise<TextLoadResult>;
}
