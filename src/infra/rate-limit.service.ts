import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiException } from '../common/api.exception';

@Injectable()
export class RateLimitService {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  consume(key: string, limit: number, windowMs: number) {
    const now = Date.now();
    const current = this.buckets.get(key);
    if (!current || current.resetAt < now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return;
    }
    current.count += 1;
    if (current.count > limit) {
      throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED', 'Too many requests. Try again later.');
    }
  }
}
