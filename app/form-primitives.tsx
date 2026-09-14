"use client";

import { useId, useState, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";

export function RequiredMark() {
  return <span className="required-mark" aria-hidden="true">*</span>;
}

export function FieldLabel({ children, required = true }: { children: ReactNode; required?: boolean }) {
  return <span className="field-label-text">{children}{required ? <RequiredMark/> : <span className="field-optional">(Optional)</span>}</span>;
}

export function FormLegend() {
  return <p className="form-legend"><RequiredMark/> Required fields</p>;
}

type FormInputProps = InputHTMLAttributes<HTMLInputElement> & { hint?: string; validate?: (value: string) => string; trailingControl?: ReactNode };

function fieldError(control: HTMLInputElement | HTMLTextAreaElement, validate?: (value: string) => string) {
  control.setCustomValidity("");
  const custom = validate?.(control.value) || "";
  if (custom) control.setCustomValidity(custom);
  if (control.validity.valueMissing) return "Please fill in this field.";
  if (control.validity.typeMismatch && control.type === "email") return "Enter an email address, such as name@example.com.";
  if (control.validity.patternMismatch) return control.title || "Check the format shown for this field.";
  return custom || control.validationMessage;
}

export function FormInput({ hint, validate, trailingControl, onBlur, onInvalid, onChange, ...props }: FormInputProps) {
  const key = useId(), [error, setError] = useState("");
  const describedBy = [props["aria-describedby"], hint && `${key}-hint`, error && `${key}-error`].filter(Boolean).join(" ") || undefined;
  return <span className="validated-field">
    <span className={trailingControl ? "password-control" : "input-control"}>
      <input {...props} aria-invalid={error ? true : props["aria-invalid"]} aria-describedby={describedBy}
        onBlur={event => { onBlur?.(event); setError(fieldError(event.currentTarget, validate)); }}
        onChange={event => { onChange?.(event); const nextError = fieldError(event.currentTarget, validate); if (error) setError(nextError); }}
        onInvalid={event => { event.preventDefault(); onInvalid?.(event); setError(fieldError(event.currentTarget, validate)); (event.currentTarget.form?.querySelector(":invalid") as HTMLElement | null)?.focus(); }}/>
      {trailingControl}
    </span>
    {hint && <span className="field-hint" id={`${key}-hint`}>{hint}</span>}
    {error && <span className="field-error" id={`${key}-error`} role="alert">{error}</span>}
  </span>;
}

export function FormTextarea({ onBlur, onChange, onInvalid, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const key = useId(), [error, setError] = useState("");
  return <span className="validated-field"><textarea {...props} aria-invalid={error ? true : props["aria-invalid"]} aria-describedby={[props["aria-describedby"], error && key].filter(Boolean).join(" ") || undefined}
    onBlur={event => { onBlur?.(event); setError(fieldError(event.currentTarget)); }}
    onChange={event => { onChange?.(event); if (error) setError(fieldError(event.currentTarget)); }}
    onInvalid={event => { event.preventDefault(); onInvalid?.(event); setError(fieldError(event.currentTarget)); (event.currentTarget.form?.querySelector(":invalid") as HTMLElement | null)?.focus(); }}/>{error && <span id={key} className="field-error" role="alert">{error}</span>}</span>;
}

export function PasswordInput(props: Omit<FormInputProps, "type" | "trailingControl">) {
  const [visible, setVisible] = useState(false);
  const generatedId = useId(), id = props.id || generatedId;
  return <FormInput {...props} id={id} aria-label={props["aria-label"] || "Password"} type={visible ? "text" : "password"}
    trailingControl={<button className="password-visibility" type="button" aria-label={visible ? "Hide password" : "Show password"} aria-controls={id} aria-pressed={visible} disabled={props.disabled} onClick={() => setVisible(value => !value)}>{visible ? "Hide" : "Show"}</button>}/>;
}
