import { codePointCount, findSentenceCut, findWordCut, isWindowEnd } from "../../utils/sentence-chunk";

const PARAGRAPH = "It was the best of times, it was the worst of times. It was the age of wisdom. The end.";

describe("codePointCount / isWindowEnd", () => {
	it("counts astral characters as one unit, unlike String.length", () => {
		expect(codePointCount("Hello 😀 world")).toBe(13);
		expect("Hello 😀 world".length).toBe(14);
	});

	it("treats a short window as the end of the text", () => {
		expect(isWindowEnd("abc", 3)).toBe(false);
		expect(isWindowEnd("abc", 4)).toBe(true);
	});
});

describe("findSentenceCut", () => {
	it("moves the cut forward to the end of the sentence that the limit falls into", () => {
		const cut = findSentenceCut(PARAGRAPH, 20, false);

		expect(cut).not.toBeNull();
		expect(PARAGRAPH.slice(0, cut!.endUnits)).toBe("It was the best of times, it was the worst of times. ");
		expect(cut!.boundary).toBe("sentence");
	});

	it("keeps the paragraph break on the finished chunk so the next one starts with a word", () => {
		const window = "Chapter I\n\nThe clocks were striking thirteen. More to come.";
		const cut = findSentenceCut(window, 10, false);

		expect(window.slice(0, cut!.endUnits)).toBe("Chapter I\n\n");
		expect(window.charAt(cut!.endUnits)).toBe("T");
	});

	it("refuses to decide while the trailing sentence is cut by the window border", () => {
		const window = PARAGRAPH.slice(0, 30);

		expect(findSentenceCut(window, 20, false)).toBeNull();
	});

	it("accepts the same trailing sentence when the text really ends there", () => {
		const window = PARAGRAPH.slice(0, 30);
		const cut = findSentenceCut(window, 20, true);

		expect(cut).toStrictEqual({ endUnits: 30, endPoints: 30, boundary: "end-of-text" });
	});

	it("returns an empty cut for an empty window at the end of the text", () => {
		expect(findSentenceCut("", 100, true)).toStrictEqual({ endUnits: 0, endPoints: 0, boundary: "end-of-text" });
		expect(findSentenceCut("", 100, false)).toBeNull();
	});

	it("counts the cut in code points while slice stays in UTF-16 units", () => {
		const window = "One two 😀 three four. Second sentence here.";
		const cut = findSentenceCut(window, 5, false)!;
		const content = window.slice(0, cut.endUnits);

		expect(content).toBe("One two 😀 three four. ");
		expect(codePointCount(content)).toBe(cut.endPoints);
	});
});

describe("findWordCut", () => {
	it("stops on the last word boundary not further than the cap", () => {
		const window = "alphabet soup for the sailor";
		const cut = findWordCut(window, 14, false);

		expect(window.slice(0, cut.endUnits)).toBe("alphabet soup ");
		expect(cut.endPoints).toBe(14);
		expect(cut.boundary).toBe("word");
	});

	it("takes an oversized word whole instead of splitting it", () => {
		const window = "pneumonoultramicroscopicsilicovolcanoconiosis and the rest";
		const cut = findWordCut(window, 10, false);

		expect(window.slice(0, cut.endUnits)).toBe("pneumonoultramicroscopicsilicovolcanoconiosis ");
	});

	it("backs off the window border rather than cutting the last word in half", () => {
		const window = "short tail";

		expect(findWordCut(window, 100, false).endPoints).toBe(6);
	});

	it("keeps the whole window when the text really ends inside it", () => {
		const window = "short tail";

		expect(findWordCut(window, 100, true)).toStrictEqual({ endUnits: 10, endPoints: 10, boundary: "word" });
	});
});
