import { type TextContent } from "prisma/generated/browser";
import { type Text } from "prisma/generated/client";
import { Language } from "prisma/generated/enums";

const SUPPORTED_LANGUAGES = [Language.ENG] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export type TextLoadResult = {
	title: Text["title"];
	content: TextContent["content"];
	language: SupportedLanguage;
};

export interface TextLoader {
	loadText(): Promise<TextLoadResult>;
}
