import { z } from 'zod';

const optionalInt = (fallback: number) =>
  z.preprocess((value) => (value === undefined || value === '' ? fallback : value), z.coerce.number().int());

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: optionalInt(4000),
  APP_URL: z.string().default('http://localhost:3000'),
  API_URL: z.string().default('http://localhost:4000'),
  DATABASE_URL: z.string().default('postgresql://postgres:promec@localhost:5432/promec'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_ACCESS_SECRET: z.string().min(16).default('dev-only-change-me-please'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: optionalInt(30),
  PAYSTACK_SECRET_KEY: z.string().default(''),
  FIELD_ENCRYPTION_KEY: z.string().default('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'),
  OPENSEARCH_NODE: z.string().default(''),
  COURIER_WEBHOOK_SECRET: z.string().default(''),
  RESEND_API_KEY: z.string().default(''),
  RESEND_FROM: z.string().default('PROMEC <notifications@promec.test>'),
  TERMII_API_KEY: z.string().default(''),
  TERMII_SENDER: z.string().default('PROMEC'),
  GIG_API_BASE: z.string().default('https://thirdpartynode.theagilitysystems.com'),
  GIG_EMAIL: z.string().default(''),
  GIG_PASSWORD: z.string().default(''),
  GIG_SENDER_STATION_ID: z.string().default(''),
  DHL_API_BASE: z.string().default('https://express.api.dhl.com/mydhlapi'),
  DHL_API_KEY: z.string().default(''),
  DHL_API_SECRET: z.string().default(''),
  DHL_ACCOUNT_NUMBER: z.string().default(''),
  S3_ENDPOINT: z.string().default(''),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().default(''),
  S3_ACCESS_KEY: z.string().default(''),
  S3_SECRET_KEY: z.string().default(''),
  BANK_ACCOUNT_NAME: z.string().default('PROMEC Limited'),
  BANK_NAME: z.string().default(''),
  BANK_ACCOUNT_NUMBER: z.string().default(''),
  VIN_DECODE_URL: z.string().default('https://vpic.nhtsa.dot.gov/api'),
  FEATURE_NL_SEARCH: z.enum(['true', 'false']).default('false'),
  FEATURE_GUEST_CHECKOUT: z.enum(['true', 'false']).default('true'),
  AI_PROVIDER: z.string().default('none'),
  AI_API_KEY: z.string().default(''),
});

export type Env = z.infer<typeof envSchema>;
