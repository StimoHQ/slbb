import { toSupportedLanguage } from "../utils/supported-language";

describe("toSupportedLanguage", () => {
	it("maps known raw spellings case- and whitespace-insensitively", () => {
		expect(toSupportedLanguage("en")).toBe("ENG");
		expect(toSupportedLanguage(" EN ")).toBe("ENG");
		expect(toSupportedLanguage("English")).toBe("ENG");
		expect(toSupportedLanguage("en-US")).toBe("ENG");
		expect(toSupportedLanguage("eng")).toBe("ENG");
	});

	it("throws on unknown or unsupported languages", () => {
		expect(() => toSupportedLanguage("ru")).toThrow("Unsupported language: ru");
		expect(() => toSupportedLanguage("")).toThrow("Unsupported language:");
	});
});
