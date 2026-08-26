import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from "@nestjs/common";
import { Response } from "express";
import { ApiResponse } from "src/common/interfaces";
import { extractMessageFromObject } from "src/common/lib";

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
	catch(exception: HttpException, host: ArgumentsHost) {
		const response = host.switchToHttp().getResponse<Response>();
		const status = exception.getStatus();
		const exceptionResponse = exception.getResponse();

		const errorResponse: ApiResponse = {
			status: "error",
			timestamp: new Date().toISOString(),
			statusCode: status,
			message: extractMessageFromObject(exceptionResponse) ?? "Internal Server Error",
		};

		response.status(status).json(errorResponse);
	}
}
