import { type Text } from "prisma/generated/client";
import { Language } from "prisma/generated/enums";

const SUPPORTED_LANGUAGES = [Language.ENG] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export type TextLoadResult = {
	title: Text["title"];
	content: string;
	language: SupportedLanguage;
};

export interface TextLoader {
	/**
	 * Загрузить контент по id объекта у источника, вернуть текст,
	 * готовый к разбивке на предложения.
	 */
	load(sourceObjId: number): Promise<TextLoadResult>;
}
