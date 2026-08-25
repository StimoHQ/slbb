import { CallHandler, ExecutionContext, HttpStatus, NestInterceptor, Injectable } from "@nestjs/common";
import { Response } from "express";
import { map, Observable } from "rxjs";
import { ApiResponse } from "src/common/intefaces";

@Injectable()
export class TransformResponseInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
	intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiResponse<T>> {
		const response = context.switchToHttp().getResponse<Response>();

		return next.handle().pipe(
			map((data) => {
				let msg: string | null = null;
				if (data && typeof data === "object" && "message" in data && typeof data.message === "string") {
					msg = data.message;
				}
				return {
					status: "success",
					timestamp: new Date().toISOString(),
					message: msg ?? "Operation has been completed",
					statusCode: response.statusCode,
					data,
				};
			}),
		);
	}
}
