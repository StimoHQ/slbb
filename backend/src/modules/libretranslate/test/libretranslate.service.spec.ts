import { HttpService } from "@nestjs/axios";
import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { of, throwError } from "rxjs";
import { DETECT_TIMEOUT_MS } from "../utils/libretranslate.constants";
import { LibreTranslateService } from "../libretranslate.service";

const DETECT_URL = "http://localhost:5000/detect";

function buildService(
	response: unknown,
	env: Record<string, string> = { LIBRETRANSLATE_URL: "http://localhost:5000" },
) {
	const post = jest.fn().mockReturnValue(of(response));
	const httpService = { post } as unknown as HttpService;
	const configService = { get: (key: string) => env[key] } as unknown as ConfigService;

	return { service: new LibreTranslateService(httpService, configService), post };
}

describe("LibreTranslateService.detect", () => {
	beforeAll(() => {
		jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
	});

	it("maps the single-object answer", async () => {
		const { service, post } = buildService({ data: { detectedLanguage: { language: "en", confidence: 0.99 } } });

		await expect(service.detect("Hello there")).resolves.toBe("ENG");
		expect(post).toHaveBeenCalledWith(DETECT_URL, new URLSearchParams({ q: "Hello there" }), {
			timeout: DETECT_TIMEOUT_MS,
		});
	});

	it("maps the array answer", async () => {
		const { service } = buildService({ data: [{ language: "en", confidence: 0.99 }] });

		await expect(service.detect("Hello there")).resolves.toBe("ENG");
	});

	it("normalizes a trailing slash of the configured URL", async () => {
		const { service, post } = buildService(
			{ data: { detectedLanguage: { language: "en", confidence: 0.99 } } },
			{ LIBRETRANSLATE_URL: "http://translate.local:5000/" },
		);

		await service.detect("Hello");

		expect(post).toHaveBeenCalledWith("http://translate.local:5000/detect", expect.anything(), expect.anything());
	});

	it("falls back to the default URL when nothing is configured", async () => {
		const { service, post } = buildService(
			{ data: { detectedLanguage: { language: "en", confidence: 0.99 } } },
			{},
		);

		await service.detect("Hello");

		expect(post).toHaveBeenCalledWith(DETECT_URL, expect.anything(), expect.anything());
	});

	it.each([
		["a language outside the project", { data: { detectedLanguage: { language: "ru", confidence: 0.99 } } }],
		["low confidence", { data: { detectedLanguage: { language: "en", confidence: 0.2 } } }],
		["no language at all", { data: {} }],
		["an empty body", {}],
	])("rejects %s", async (_reason, response) => {
		const { service } = buildService(response);

		await expect(service.detect("Some text")).resolves.toBeNull();
	});

	it("returns null instead of throwing when the service is unreachable", async () => {
		const post = jest.fn().mockReturnValue(throwError(() => new Error("connect ECONNREFUSED")));
		const service = new LibreTranslateService(
			{ post } as unknown as HttpService,
			{ get: () => undefined } as unknown as ConfigService,
		);

		await expect(service.detect("Some text")).resolves.toBeNull();
	});
});
