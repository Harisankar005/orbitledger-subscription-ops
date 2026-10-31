import { z } from "zod";

// Password rule: > 8 characters (min 9), max 128, uppercase, lowercase, special character
export const passwordSchema = z
  .string()
  .min(9, "Password must be at least 9 characters (more than 8 characters)")
  .max(128, "Password cannot exceed 128 characters")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter (A-Z)")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter (a-z)")
  .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character (!@#$%^&* etc.)");

// Amount rule: positive amount with max 2 decimals
export const positiveAmountSchema = z
  .number({ invalid_type_error: "Must be a valid number" })
  .positive("Must be greater than 0")
  .refine(
    (val) => /^\d+(\.\d{1,2})?$/.test(val.toString()),
    "Amount can have at most 2 decimal places"
  );

// Non-negative amount rule (>= 0, max 2 decimals)
export const nonNegativeAmountSchema = z
  .number({ invalid_type_error: "Must be a valid number" })
  .min(0, "Must be greater than or equal to 0")
  .refine(
    (val) => /^\d+(\.\d{1,2})?$/.test(val.toString()),
    "Amount can have at most 2 decimal places"
  );

// Percent rule: 0 to 100 with max 2 decimals
export const percentSchema = z
  .number({ invalid_type_error: "Must be a valid number" })
  .min(0, "Percentage must be between 0 and 100")
  .max(100, "Percentage cannot exceed 100")
  .refine(
    (val) => /^\d+(\.\d{1,2})?$/.test(val.toString()),
    "Percentage can have at most 2 decimal places"
  );

// 1. Login schema
export const loginSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});
export type LoginFormData = z.infer<typeof loginSchema>;

// 2. Register schema
export const registerSchema = z.object({
  full_name: z.string().min(2, "Full name must be at least 2 characters"),
  email: z.string().email("Please enter a valid work email address"),
  company: z.string().optional(),
  phone: z.string().optional(),
  password: passwordSchema,
});
export type RegisterFormData = z.infer<typeof registerSchema>;

// 3. Forgot & Reset Password schemas
export const forgotPasswordSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});
export type ForgotPasswordFormData = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    token: z.string().min(10, "Please enter a valid reset token"),
    new_password: passwordSchema,
    confirm_password: z.string(),
  })
  .refine((data) => data.new_password === data.confirm_password, {
    message: "Passwords do not match",
    path: ["confirm_password"],
  });
export type ResetPasswordFormData = z.infer<typeof resetPasswordSchema>;

// 4. Customer schema
export const customerSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email address"),
  company: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  tax_id: z.string().optional(),
  is_active: z.boolean(),
});
export type CustomerFormData = z.infer<typeof customerSchema>;

// 5. Catalog schemas
export const productSchema = z.object({
  name: z.string().min(1, "Product name is required"),
  type: z.enum(["software", "addon", "service", "physical"], {
    errorMap: () => ({ message: "Select a valid product type" }),
  }),
  sales_price: positiveAmountSchema,
  cost_price: nonNegativeAmountSchema,
  notes: z.string().optional(),
  default_tax_id: z.number().nullable().optional(),
  is_active: z.boolean(),
});
export type ProductFormData = z.infer<typeof productSchema>;

export const variantSchema = z.object({
  attribute: z.string().min(1, "Attribute name is required"),
  value: z.string().min(1, "Attribute value is required"),
  extra_price: nonNegativeAmountSchema,
});
export type VariantFormData = z.infer<typeof variantSchema>;

export const planSchema = z
  .object({
    name: z.string().min(1, "Plan name is required"),
    price: positiveAmountSchema,
    billing_period: z.enum(["daily", "weekly", "monthly", "yearly"]),
    min_quantity: z.number().int().min(0, "Minimum quantity must be 0 or greater"),
    available_from: z.string().min(1, "Available from date is required"),
    available_to: z.string().min(1, "Available to date is required"),
    default_tax_id: z.number().nullable().optional(),
    auto_close_on_end: z.boolean(),
    allow_early_close: z.boolean(),
    allow_pause: z.boolean(),
    allow_renew: z.boolean(),
  })
  .refine((data) => data.available_to >= data.available_from, {
    message: "Available to date must be on or after available from date",
    path: ["available_to"],
  });
export type PlanFormData = z.infer<typeof planSchema>;

export const taxSchema = z.object({
  name: z.string().min(1, "Tax name is required"),
  kind: z.enum(["percent", "fixed"]),
  rate: percentSchema,
  is_active: z.boolean(),
});
export type TaxFormData = z.infer<typeof taxSchema>;

export const taxRuleSchema = z.object({
  product_type: z.enum(["software", "addon", "service", "physical"]).nullable().optional(),
  tax_id: z.number({ invalid_type_error: "Select a tax" }),
  priority: z.number().int().min(1, "Priority must be at least 1"),
  is_active: z.boolean(),
});
export type TaxRuleFormData = z.infer<typeof taxRuleSchema>;

export const paymentTermSchema = z.object({
  name: z.string().min(1, "Payment term name is required"),
  days: z.number().int().min(0, "Payment days must be 0 or greater"),
});
export type PaymentTermFormData = z.infer<typeof paymentTermSchema>;

export const quotationTemplateSchema = z.object({
  name: z.string().min(1, "Template name is required"),
  plan_id: z.number({ invalid_type_error: "Select a plan" }),
  validity_days: z.number().int().min(1, "Validity days must be at least 1 day"),
  payment_term_id: z.number({ invalid_type_error: "Select a payment term" }),
  is_active: z.boolean(),
});
export type QuotationTemplateFormData = z.infer<typeof quotationTemplateSchema>;

// 6. Discount schema
export const discountSchema = z
  .object({
    name: z.string().min(1, "Rule name is required"),
    kind: z.enum(["percent", "fixed"]),
    value: z.number({ invalid_type_error: "Enter a valid value" }),
    scope: z.enum(["product", "subscription"]),
    min_purchase_amount: nonNegativeAmountSchema,
    min_quantity: z.number().int().min(1, "Minimum quantity must be at least 1"),
    start_date: z.string().min(1, "Start date is required"),
    end_date: z.string().min(1, "End date is required"),
    usage_limit: z.number().int().positive().nullable().optional(),
    product_id: z.number().nullable().optional(),
    is_active: z.boolean(),
  })
  .refine((data) => data.end_date >= data.start_date, {
    message: "End date must be on or after start date",
    path: ["end_date"],
  })
  .refine(
    (data) => {
      if (data.kind === "percent") {
        return data.value >= 0 && data.value <= 100 && /^\d+(\.\d{1,2})?$/.test(data.value.toString());
      }
      return data.value > 0 && /^\d+(\.\d{1,2})?$/.test(data.value.toString());
    },
    {
      message: "Percentage must be between 0 and 100 with max 2 decimals, or fixed amount must be positive",
      path: ["value"],
    }
  )
  .refine(
    (data) => {
      if (data.scope === "product" && !data.product_id) {
        return false;
      }
      return true;
    },
    {
      message: "Product must be selected for product-scoped discount rules",
      path: ["product_id"],
    }
  );
export type DiscountFormData = z.infer<typeof discountSchema>;

// 7. Users schema (Add Staff)
export const addStaffSchema = z.object({
  full_name: z.string().min(2, "Full name must be at least 2 characters"),
  email: z.string().email("Please enter a valid work email address"),
  password: passwordSchema,
});
export type AddStaffFormData = z.infer<typeof addStaffSchema>;

// 8. Payment dialog schema
export function createPaymentSchema(amountDue?: number) {
  const todayStr = new Date().toISOString().split("T")[0];

  return z
    .object({
      method: z.enum(["upi", "card", "bank_transfer", "cheque", "cash"], {
        errorMap: () => ({ message: "Select a valid payment method" }),
      }),
      amount: positiveAmountSchema,
      payment_date: z
        .string()
        .min(1, "Payment date is required")
        .refine((d) => d <= todayStr, "Payment date cannot be in the future"),
      reference: z.string().optional(),
    })
    .refine(
      (data) => {
        if (amountDue !== undefined && amountDue > 0) {
          return data.amount <= amountDue;
        }
        return true;
      },
      {
        message: `Payment amount cannot exceed the balance due (${amountDue ?? 0})`,
        path: ["amount"],
      }
    );
}

export type PaymentFormData = z.infer<ReturnType<typeof createPaymentSchema>>;

// 9. Billing run schema
export const billingRunSchema = z.object({
  as_of_date: z.string().min(1, "Billing as-of date is required"),
  dry_run: z.boolean(),
});
export type BillingRunFormData = z.infer<typeof billingRunSchema>;
