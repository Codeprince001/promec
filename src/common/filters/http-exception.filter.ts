import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest<{ headers: Record<string, string | undefined> }>();
    const requestId = request.headers['x-request-id'] ?? randomUUID();

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'Something went wrong';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      code = codeForStatus(status);
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const record = body as { code?: string; message?: string | string[]; details?: unknown };
        if (typeof record.code === 'string') code = record.code;
        if (Array.isArray(record.message)) {
          details = record.message;
          message = 'Validation failed';
          code = 'VALIDATION_ERROR';
        } else if (typeof record.message === 'string') {
          message = record.message;
        }
        if (record.details !== undefined) details = record.details;
      }
    } else {
      this.logger.error(exception instanceof Error ? exception.stack : exception);
    }

    response.status(status).json({
      error: { code, message, details: details ?? null, requestId },
    });
  }
}

function codeForStatus(status: number): string {
  switch (status) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHENTICATED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 422:
      return 'VALIDATION_ERROR';
    case 429:
      return 'RATE_LIMITED';
    default:
      return status >= 500 ? 'INTERNAL_ERROR' : 'HTTP_ERROR';
  }
}
