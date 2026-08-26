import { CallHandler, ExecutionContext, HttpStatus, NestInterceptor, Injectable } from "@nestjs/common";
import { Response } from "express";
import { map, Observable } from "rxjs";
import { ApiResponse } from "src/common/interfaces";
import { extractMessageFromObject } from "src/common/lib";

@Injectable()
export class TransformResponseInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
	intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiResponse<T>> {
		const response = context.switchToHttp().getResponse<Response>();

		return next.handle().pipe(
			map((data) => {
				return {
					status: "success",
					timestamp: new Date().toISOString(),
					message: extractMessageFromObject(data) ?? "Operation has been completed",
					statusCode: response.statusCode,
					data,
				};
			}),
		);
	}
}
