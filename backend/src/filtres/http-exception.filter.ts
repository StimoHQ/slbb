import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Injectable,
} from '@nestjs/common';
import { ApiResponse } from 'src/common/intefaces';

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    console.log(exceptionResponse);

    const errorResponse: ApiResponse = {
      status: 'error',
      timestamp: new Date().toISOString(),
      statusCode: status,
      message:
        typeof exceptionResponse === 'string'
          ? exceptionResponse
          : typeof exceptionResponse === 'object' &&
              exceptionResponse !== null &&
              'message' in exceptionResponse
            ? Array.isArray(exceptionResponse.message)
              ? exceptionResponse.message.join('\n') // ← Обработка массива
              : typeof exceptionResponse.message === 'string'
                ? exceptionResponse.message
                : 'Internal server error'
            : 'Internal server error',
    };

    response.status(status).json(errorResponse);
  }
}
