import { z } from 'zod';

export const loginSchema = z.object({
  identifier: z.string().trim().min(3, 'Enter your email or phone'),
  password: z.string().min(1, 'Enter your password'),
});

export const registerSchema = z.object({
  firstName: z.string().trim().min(1, 'Enter your first name'),
  lastName: z.string().trim().min(1, 'Enter your last name'),
  email: z.string().trim().email('Enter a valid email'),
  password: z.string().min(10, 'Use at least 10 characters'),
  customerType: z.enum(['individual', 'mechanic', 'business_member']),
  acceptTerms: z.literal(true, { message: 'Accept the terms to create an account' }),
});

export const addressSchema = z.object({
  recipient: z.string().trim().min(1, 'Enter the recipient'),
  phone: z.string().trim().min(8, 'Enter a phone number'),
  state: z.string().trim().min(2, 'Choose a state'),
  city: z.string().trim().min(1, 'Enter a city'),
  street: z.string().trim().min(1, 'Enter a street'),
  lga: z.string().trim().optional(),
  landmark: z.string().trim().optional(),
});
