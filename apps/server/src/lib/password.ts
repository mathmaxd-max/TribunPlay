import bcrypt from "bcryptjs";

const BCRYPT_ROUNDS = 12;

class PasswordError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const normalizeEmail = (value: string): string => value.trim().toLowerCase();

const DEFAULT_ALLOWED_EMAIL_DOMAINS = [
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "me.com",
  "yahoo.com",
  "yahoo.de",
  "web.de",
  "gmx.de",
  "gmx.net",
  "proton.me",
  "protonmail.com",
];

const getEmailDomain = (email: string): string => {
  const atIndex = email.lastIndexOf("@");
  if (atIndex < 0 || atIndex >= email.length - 1) {
    throw new PasswordError(400, "Invalid email format");
  }
  return email.slice(atIndex + 1).toLowerCase();
};

export const resolveAllowedEmailDomains = (configuredCsv?: string): Set<string> => {
  const raw = (configuredCsv ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return new Set(raw.length > 0 ? raw : DEFAULT_ALLOWED_EMAIL_DOMAINS);
};

export const assertAllowedEmailDomain = (email: string, configuredCsv?: string): void => {
  const domain = getEmailDomain(email);
  const allowed = resolveAllowedEmailDomains(configuredCsv);
  if (!allowed.has(domain)) {
    throw new PasswordError(
      400,
      "Email domain is not supported. Please use a common provider such as gmail.com or web.de.",
    );
  }
};

export const validateEmail = (value: string, allowedDomainsCsv?: string): string => {
  const normalized = normalizeEmail(value);
  if (!normalized) {
    throw new PasswordError(400, "Email is required");
  }
  if (normalized.length > 254) {
    throw new PasswordError(400, "Email is too long");
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(normalized)) {
    throw new PasswordError(400, "Invalid email format");
  }
  assertAllowedEmailDomain(normalized, allowedDomainsCsv);
  return normalized;
};

export const validatePassword = (value: string): string => {
  if (!value) {
    throw new PasswordError(400, "Password is required");
  }
  if (value.length < 8) {
    throw new PasswordError(400, "Password must be at least 8 characters");
  }
  if (value.length > 128) {
    throw new PasswordError(400, "Password must be at most 128 characters");
  }
  return value;
};

export const validateAccountName = (value: string): string => {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) {
    throw new PasswordError(400, "Name is required");
  }
  if (normalized.length > 40) {
    throw new PasswordError(400, "Name must be at most 40 characters");
  }
  return normalized;
};

export const hashPassword = async (password: string): Promise<string> => {
  validatePassword(password);
  return bcrypt.hash(password, BCRYPT_ROUNDS);
};

export const verifyPassword = async (password: string, passwordHash: string): Promise<boolean> => {
  return bcrypt.compare(password, passwordHash);
};

export const toPasswordHttpError = (error: unknown): { status: number; message: string } => {
  if (error instanceof PasswordError) {
    return { status: error.status, message: error.message };
  }
  if (error instanceof Error) {
    return { status: 500, message: error.message };
  }
  return { status: 500, message: "Unknown password error" };
};
