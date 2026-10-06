//! Shared form field: a label, its control and optional supporting text with one typography and spacing.
//!
//! Dialogs built from different components (FormModal, launch dialogs) render their labels through this
//! component, so fields from both can sit in one dialog without visible seams.

import type { ReactNode } from "react";
import "./field.css";

export function Field({
  label,
  required = false,
  hint,
  as = "label",
  children,
}: {
  /** Omitted or empty: render only the control and hint. */
  label?: string;
  required?: boolean;
  hint?: ReactNode;
  /** `label` associates the text with a native control inside; use `div` for custom controls such as Select. */
  as?: "label" | "div";
  children: ReactNode;
}) {
  const Tag = as;
  return (
    <div className="vlx-field">
      <Tag className="vlx-field">
        {label && <span className="vlx-field-label">
          {label}{required && <span className="vlx-field-required"> *</span>}
        </span>}
        {children}
      </Tag>
      {hint && <span className="vlx-field-hint">{hint}</span>}
    </div>
  );
}

/** Vertical stack with the standard gap between fields. */
export function FieldStack({ children }: { children: ReactNode }) {
  return <div className="vlx-field-stack">{children}</div>;
}
