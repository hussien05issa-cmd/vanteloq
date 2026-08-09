export const MINIMUM_PASSWORD_LENGTH = 12;

export type PasswordRule = {
  id: "length" | "lowercase" | "uppercase" | "number" | "symbol";
  label: string;
  met: boolean;
};

export function passwordRules(password: string): PasswordRule[] {
  return [
    { id: "length", label: `${MINIMUM_PASSWORD_LENGTH}+ characters`, met: password.length >= MINIMUM_PASSWORD_LENGTH },
    { id: "lowercase", label: "Lowercase letter", met: /[a-z]/.test(password) },
    { id: "uppercase", label: "Uppercase letter", met: /[A-Z]/.test(password) },
    { id: "number", label: "Number", met: /\d/.test(password) },
    { id: "symbol", label: "Symbol", met: /[^A-Za-z0-9\s]/.test(password) },
  ];
}

export function strongPasswordError(password: string): string | null {
  if (password.length > 256 || /[\u0000-\u001f\u007f]/.test(password)) {
    return "Choose a password without control characters.";
  }
  const unmet = passwordRules(password).filter((rule) => !rule.met);
  return unmet.length ? `Use ${unmet.map((rule) => rule.label.toLowerCase()).join(", ")}.` : null;
}
