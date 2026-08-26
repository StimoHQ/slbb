import { ApiResponse } from "../interfaces";

type ApiMessage = Exclude<ApiResponse["message"], undefined>;

type ObjectWithMessage = {
	message: ApiMessage | ApiMessage[];
};

function hasMessage(data: unknown): data is ObjectWithMessage {
	if (typeof data !== "object" && data === null) {
		return false;
	}
	const message = (data as Record<string, unknown>).message;
	return typeof message === "string" || (Array.isArray(message) && message.every((item) => typeof item === "string"));
}

export function extractMessageFromObject(data: unknown): string | undefined {
	if (hasMessage(data)) {
		return Array.isArray(data.message) ? data.message.join("\n") : data.message;
	}
	return undefined;
}
