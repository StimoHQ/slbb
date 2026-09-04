import { LearningLanguage } from "prisma/generated/enums";

/**
 * Строка оконного запроса к `text_contents`. `$queryRaw` типизируется руками,
 * поэтому контракт живёт отдельно от сервиса: `language` приходит как `::text`
 * и по значению совпадает с одноимённым enum'ом Prisma.
 */
export type TextChunkRow = {
	title: string;
	language: LearningLanguage;
	/** Длина всего текста в code points — единицах offset'ов ответа. */
	totalLength: number;
	/** Кусок текста от offset длиной не больше запрошенной. */
	window: string;
};
