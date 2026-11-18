import { z } from 'zod';

export const registerSchema = z
  .object({
    email: z.string().email().optional(),
    phone: z.string().min(10).max(20).optional(),
    password: z.string().min(10).max(128),
    firstName: z.string().min(1).max(80),
    lastName: z.string().min(1).max(80),
    customerType: z.enum(['individual', 'mechanic', 'business_member']).default('individual'),
    acceptTerms: z.literal(true),
    marketingConsent: z.boolean().default(false),
  })
  .refine((value) => Boolean(value.email || value.phone), { message: 'Email or phone is required' });

export const loginSchema = z.object({
  identifier: z.string().min(3).max(160),
  password: z.string().min(1).max(128),
});

export const mfaSchema = z.object({
  challengeId: z.string().uuid(),
  code: z.string().regex(/^\d{6}$/),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type MfaInput = z.infer<typeof mfaSchema>;
