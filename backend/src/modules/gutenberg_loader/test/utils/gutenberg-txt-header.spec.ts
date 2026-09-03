import { DETECTION_SAMPLE_LIMIT } from "../../utils/gutenberg.constants";
import { extractDetectionSample, isBookBodyStarted, parseGutenbergHeader } from "../../utils/gutenberg-txt-header";

const HEADER = [
	"The Project Gutenberg eBook of The electronic siege",
	"",
	"Title: The electronic siege",
	"",
	"Author: Jr. John W. Campbell",
	"",
	"Release date: September 2, 2026 [eBook #79501]",
	"",
	"Language: English",
	"",
].join("\n");

const BODY_MARKER = "*** START OF THE PROJECT GUTENBERG EBOOK THE ELECTRONIC SIEGE ***";

describe("parseGutenbergHeader", () => {
	it("reads the declared language and title from the service header", () => {
		expect(parseGutenbergHeader(`${HEADER}${BODY_MARKER}`)).toEqual({
			languageRaw: "English",
			title: "The electronic siege",
		});
	});

	it("ignores header-like lines that appear inside the book body", () => {
		const sample = `${HEADER}${BODY_MARKER}\n\nTitle: Something invented by the author\nLanguage: Russian\n`;

		expect(parseGutenbergHeader(sample)).toEqual({ languageRaw: "English", title: "The electronic siege" });
	});

	it("accepts the alternative START marker wording", () => {
		const sample = `${HEADER}*** START OF THIS PROJECT GUTENBERG EBOOK THE BOOK ***\n\nProse.\n`;

		expect(parseGutenbergHeader(sample).languageRaw).toBe("English");
	});

	it("returns nulls for a sample without any service header", () => {
		expect(parseGutenbergHeader("The dock-guard looked sourly down the long, bare customs landing.\n")).toEqual({
			languageRaw: null,
			title: null,
		});
	});
});

describe("isBookBodyStarted", () => {
	it("is false while the service header is not over", () => {
		expect(isBookBodyStarted(HEADER)).toBe(false);
	});

	it("is true as soon as the marker is read", () => {
		expect(isBookBodyStarted(`${HEADER}${BODY_MARKER}\n`)).toBe(true);
	});
});

describe("extractDetectionSample", () => {
	it("drops the header and the marker, keeping prose only", () => {
		const sample = `${HEADER}${BODY_MARKER}\n\nThe dock-guard looked sourly down the long, bare customs landing.\n`;

		expect(extractDetectionSample(sample)).toBe("The dock guard looked sourly down the long bare customs landing");
	});

	it("truncates the sample for the detector", () => {
		const sample = `${BODY_MARKER}\n\n${"word ".repeat(DETECTION_SAMPLE_LIMIT)}`;

		expect(extractDetectionSample(sample).length).toBeLessThanOrEqual(DETECTION_SAMPLE_LIMIT);
	});

	it("takes the body beyond the marker, ignoring the English-only Gutenberg preamble", () => {
		const russianProse = "Дождь и ветер гнали воду по металлу. ".repeat(300);

		expect(extractDetectionSample(`${HEADER}${russianProse}`)).toEqual(expect.stringContaining("Дождь и ветер"));
		expect(extractDetectionSample(`${HEADER}${russianProse}`)).not.toEqual(
			expect.stringContaining("Project Gutenberg"),
		);
	});

	it("returns an empty sample when the book body has not started yet", () => {
		expect(extractDetectionSample(`${HEADER}${BODY_MARKER}`)).toBe("");
	});
});
