/**
 * Закрытое предложение почти всегда заканчивается чуть позже offset+limit,
 * поэтому из БД читаем окно больше, чем отдаём наружу.
 */
export const CHUNK_WINDOW_MULTIPLIER = 2;

/**
 * Потолок расширения окна. За его пределами конец предложения ищется только
 * до границы слова, чтобы один запрос не мог вернуть половину книги.
 */
export const CHUNK_MAX_SCAN_MULTIPLIER = 4;

/** Где именно оборвался чанк: `word` — сработал потолок скана, `end-of-text` — конец текста. */
export type ChunkBoundary = "sentence" | "word" | "end-of-text";

export type ChunkCut = {
	/** Позиция внутри окна в единицах UTF-16 — тем, чем режут `String.slice`. */
	endUnits: number;
	/** Позиция внутри окна в code points — в них же Postgres считает `length`/`substr` и offset'ы ответа. */
	endPoints: number;
	boundary: ChunkBoundary;
};

// Границы предложений и слов считаются по ICU; язык контента в MVP один — LearningLanguage = ENG.
const SENTENCE_SEGMENTER = new Intl.Segmenter("en", { granularity: "sentence" });
const WORD_SEGMENTER = new Intl.Segmenter("en", { granularity: "word" });

export function codePointCount(value: string): number {
	let count = 0;

	for (const _codePoint of value) {
		count += 1;
	}

	return count;
}

/**
 * Окно короче запрошенного — текст дочитан до конца.
 * Считать нужно code points, а не `String.length`: `substr` режет по символам БД,
 * и для строк вне BMP (эмодзи) эти единицы расходятся.
 */
export function isWindowEnd(window: string, requestedLength: number): boolean {
	return codePointCount(window) < requestedLength;
}

/**
 * Разделитель после границы относится к законченному чанку, чтобы следующий начинался со слова,
 * а не с висячего перевода строки. Пробельных символов вне BMP `/\s/` не матчит,
 * поэтому шаг всегда по одной единице.
 */
function includeSeparator(window: string, cut: ChunkCut): ChunkCut {
	let { endUnits, endPoints } = cut;

	while (endUnits < window.length && /\s/.test(window[endUnits])) {
		endUnits += 1;
		endPoints += 1;
	}

	return { ...cut, endUnits, endPoints };
}

/**
 * Ближайший конец предложения на или после `target`.
 *
 * `null` означает «решение принять нельзя»: последний сегмент окна упирается в его
 * границу, и закрывается ли предложение видно только из следующего куска текста.
 * Свойства `isFinal` у сегментов в `Intl.Segmenter` нет, поэтому признак именно позиционный.
 */
export function findSentenceCut(window: string, target: number, isEof: boolean): ChunkCut | null {
	let endUnits = 0;
	let endPoints = 0;

	for (const { segment } of SENTENCE_SEGMENTER.segment(window)) {
		endUnits += segment.length;
		endPoints += codePointCount(segment);

		if (endPoints < target) {
			continue;
		}

		if (endUnits === window.length) {
			return isEof ? includeSeparator(window, { endUnits, endPoints, boundary: "end-of-text" }) : null;
		}

		return includeSeparator(window, { endUnits, endPoints, boundary: "sentence" });
	}

	return isEof ? { endUnits: window.length, endPoints, boundary: "end-of-text" } : null;
}

/**
 * Запасной конец чанка, когда в окне не нашлось закрытого предложения:
 * последняя граница слова на или перед `cap`. Конец окна границей слова не
 * считается — он режет слово пополам, и то слово целиком достаётся следующему чанку.
 */
export function findWordCut(window: string, cap: number, isEof: boolean): ChunkCut {
	let endUnits = 0;
	let endPoints = 0;

	for (const { segment } of WORD_SEGMENTER.segment(window)) {
		const nextUnits = endUnits + segment.length;
		const nextPoints = endPoints + codePointCount(segment);

		if (nextPoints > cap || (nextUnits === window.length && !isEof)) {
			return includeSeparator(
				window,
				endUnits > 0
					? { endUnits, endPoints, boundary: "word" }
					: { endUnits: nextUnits, endPoints: nextPoints, boundary: "word" },
			);
		}

		endUnits = nextUnits;
		endPoints = nextPoints;
	}

	return { endUnits, endPoints, boundary: "word" };
}
