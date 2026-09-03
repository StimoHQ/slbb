import { toSupportedLanguage } from "../utils";

describe("toSupportedLanguage", () => {
	it.each(["english", "English", "ENGLISH", " en ", "en", "en-US", "en-GB", "eng", "English."] as const)(
		"maps %p to ENG",
		(raw) => {
			expect(toSupportedLanguage(raw)).toBe("ENG");
		},
	);

	it.each([
		"Russian",
		"ru",
		"deutsch",
		"English; French",
		"English & French",
		"",
		"   ",
		":::",
		null,
		undefined,
	] as const)("rejects %p", (raw) => {
		expect(toSupportedLanguage(raw)).toBeNull();
	});
});
