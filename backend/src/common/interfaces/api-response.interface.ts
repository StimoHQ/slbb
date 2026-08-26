export interface ApiResponse<T = unknown> {
	status: "success" | "error";
	data?: T;
	message?: string;
	timestamp: string;
	statusCode?: number;
}
