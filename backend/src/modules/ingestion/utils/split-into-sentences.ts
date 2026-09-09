import model from "wink-eng-lite-web-model";
import winkNLP from "wink-nlp";

type NlpEngine = ReturnType<typeof winkNLP>;

// Движок wink-nlp со словарём сокращений и SBD-автоматом инициализируется один раз
// на процесс (лениво, к стоимости обращения — это ~0.3s и 4 МБ статистики).
let engine: NlpEngine | null = null;

function getEngine(): NlpEngine {
	if (!engine) {
		engine = winkNLP(model);
	}

	return engine;
}

/**
 * Разбивает текст на предложения: wink-nlp коррежно держит сокращения («Mr.», «e.g.»,
 * инициалы «A. Conan Doyle»), кавычки и абзацы, а предложение без финальной пунктуации
 * не додумывает границу — склеивает до абзаца.
 * Хард-переносы строк внутри предложения сохраняются как есть: их снимает клиент при рендере.
 */
export function splitIntoSentences(text: string): string[] {
	if (!text.trim()) {
		return [];
	}

	// out() без аргумента по типам и рантайму всегда string[], включая одно предложение.
	return getEngine().readDoc(text).sentences().out();
}
