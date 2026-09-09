import { splitIntoSentences } from "../utils/split-into-sentences";

// Кейсы — эмпирика выбора сегментатора (2026-09-09):Intl.Segmenter и compromise
// валялись именно на них.
describe("splitIntoSentences", () => {
	it("keeps sentences with abbreviations intact", () => {
		const text = "Mr. Smith went to Washington. He asked the guard, e.g. to stop, and left.";

		expect(splitIntoSentences(text)).toEqual([
			"Mr. Smith went to Washington.",
			"He asked the guard, e.g. to stop, and left.",
		]);
	});

	it("does not split on initials", () => {
		const text = "A. Conan Doyle wrote it. J. K. Rowling did not.";

		expect(splitIntoSentences(text)).toEqual(["A. Conan Doyle wrote it.", "J. K. Rowling did not."]);
	});

	it("keeps a hard line wrap inside one sentence", () => {
		const text = "He was silent for a long\ntime and nobody spoke to him about it.";

		expect(splitIntoSentences(text)).toEqual(["He was silent for a long\ntime and nobody spoke to him about it."]);
	});

	it("splits paragraphs separated by a blank line", () => {
		const text =
			"It is a truth universally acknowledged.\n\nHowever little known the feelings or views of such a man may be.";

		expect(splitIntoSentences(text)).toEqual([
			"It is a truth universally acknowledged.",
			"However little known the feelings or views of such a man may be.",
		]);
	});

	it("does not invent boundaries when there is no punctuation at all", () => {
		const text = "Chapter I\nIt was the best of times it was the worst of times";

		const sentences = splitIntoSentences(text);

		expect(sentences).toHaveLength(1);
		expect(sentences[0]).toContain("best of times");
	});

	it("splits quoted speech by sentence, quotes included", () => {
		const text = '"Hello," he said. "Goodbye."';

		expect(splitIntoSentences(text)).toEqual(['"Hello," he said.', '"Goodbye."']);
	});

	it("returns exactly one element for a single sentence (no bare-string leak)", () => {
		expect(splitIntoSentences("It is done.")).toEqual(["It is done."]);
	});

	it("returns nothing for an empty or whitespace text", () => {
		expect(splitIntoSentences("")).toEqual([]);
		expect(splitIntoSentences("  \n\t ")).toEqual([]);
	});
});
