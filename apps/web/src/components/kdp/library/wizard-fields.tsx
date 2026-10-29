"use client";

import { Check } from "lucide-react";
import { useId, type ReactNode } from "react";

import { formatWords } from "@/lib/kdp";

import { levelWords } from "./wizard-model";

/** A labelled text input or textarea with help text and an inline error. */
export function TextField({
  label,
  value,
  onChange,
  rows,
  placeholder,
  maxLength,
  error,
  help,
  full = false,
  required = false,
  action,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  maxLength?: number;
  error?: string;
  help?: ReactNode;
  full?: boolean;
  required?: boolean;
  /** Extra control next to the label, such as voice input. */
  action?: ReactNode;
}) {
  const id = useId();
  const describedBy =
    [error ? `${id}-error` : "", help ? `${id}-help` : ""]
      .filter(Boolean)
      .join(" ") || undefined;
  const shared = {
    id,
    value,
    placeholder,
    maxLength,
    required,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
  };
  return (
    <div className={`field${full ? " full" : ""}`}>
      <div className="kdp-wiz-label-row">
        <label htmlFor={id} className="kdp-wiz-field-label">
          {label}
          {required && <span aria-hidden="true"> *</span>}
        </label>
        {action}
      </div>
      {rows ? (
        <textarea
          {...shared}
          rows={rows}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input {...shared} onChange={(event) => onChange(event.target.value)} />
      )}
      {help && (
        <small id={`${id}-help`} className="kdp-wiz-help">
          {help}
        </small>
      )}
      {error && (
        <em id={`${id}-error`} className="kdp-wiz-error">
          {error}
        </em>
      )}
    </div>
  );
}

export function FieldError({ id, error }: { id: string; error?: string }) {
  if (!error) return null;
  return (
    <em id={id} className="kdp-wiz-error">
      {error}
    </em>
  );
}

/** Radio buttons drawn as pills. */
export function ChoiceGroup<T extends string>({
  legend,
  value,
  options,
  onChange,
  full = false,
}: {
  legend: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  full?: boolean;
}) {
  const name = useId();
  return (
    <fieldset className={`kdp-wiz-choices${full ? " full" : ""}`}>
      <legend>{legend}</legend>
      <div>
        {options.map((option) => (
          <label
            key={option.value}
            className={`kdp-wiz-choice${value === option.value ? " selected" : ""}`}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Checkboxes drawn as chips, with an optional limit. */
export function ChipGroup({
  legend,
  values,
  options,
  onChange,
  max,
  full = false,
}: {
  legend: string;
  values: string[];
  options: readonly string[];
  onChange: (values: string[]) => void;
  max?: number;
  full?: boolean;
}) {
  const atLimit = max !== undefined && values.length >= max;
  return (
    <fieldset className={`kdp-wiz-choices${full ? " full" : ""}`}>
      <legend>{legend}</legend>
      <div>
        {options.map((option) => {
          const checked = values.includes(option);
          return (
            <label
              key={option}
              className={`kdp-wiz-choice${checked ? " selected" : ""}`}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={!checked && atLimit}
                onChange={() =>
                  onChange(
                    checked
                      ? values.filter((value) => value !== option)
                      : [...values, option],
                  )
                }
              />
              {checked && <Check size={13} aria-hidden="true" />}
              <span>{option.charAt(0).toUpperCase() + option.slice(1)}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** A 0–5 (or 1–5) intensity slider with a word for each level. */
export function LevelSlider({
  label,
  value,
  min,
  onChange,
}: {
  label: string;
  value: number;
  min: 0 | 1;
  onChange: (value: number) => void;
}) {
  const id = useId();
  const word = levelWords[value] ?? String(value);
  return (
    <div className="kdp-wiz-level">
      <label htmlFor={id}>
        <span>{label}</span>
        <output htmlFor={id}>
          {value} · {word}
        </output>
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={5}
        step={1}
        value={value}
        aria-valuetext={`${value} of 5, ${word}`}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

/** Numbered steps; a step is reachable once every step before it is valid. */
export function StepIndicator({
  steps,
  current,
  canVisit,
  onSelect,
}: {
  steps: readonly { id: string; label: string }[];
  current: number;
  canVisit: (index: number) => boolean;
  onSelect: (index: number) => void;
}) {
  const percent = steps.length > 1 ? (current / (steps.length - 1)) * 100 : 0;
  return (
    <nav className="kdp-wiz-progress" aria-label="Steps">
      <p className="kdp-wiz-progress-label">
        Step {current + 1} of {steps.length}
        <span> · {steps[current]?.label}</span>
      </p>
      <ol>
        {steps.map((step, index) => {
          const state =
            index < current ? "done" : index === current ? "current" : "";
          return (
            <li key={step.id} className={state}>
              <button
                type="button"
                disabled={index !== current && !canVisit(index)}
                aria-current={index === current ? "step" : undefined}
                onClick={() => onSelect(index)}
              >
                <span className="kdp-wiz-step-number" aria-hidden="true">
                  {index < current ? <Check size={12} /> : index + 1}
                </span>
                <span className="kdp-wiz-step-label">{step.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="kdp-wiz-progress-bar" aria-hidden="true">
        <i style={{ width: `${percent}%` }} />
      </div>
    </nav>
  );
}

/** Planned chapter lengths as a small bar list. */
export function ChapterPreview({ plan }: { plan: number[] }) {
  const longest = Math.max(1, ...plan);
  const shortest = plan.length ? Math.min(...plan) : 0;
  return (
    <section className="kdp-wiz-plan" aria-label="Chapter length preview">
      <header>
        <h3>Chapter lengths</h3>
        <small>
          {plan.length === 1
            ? `One chapter of ${formatWords(longest)} words`
            : `${formatWords(shortest)}–${formatWords(longest)} words, following the pacing`}
        </small>
      </header>
      <ol tabIndex={0} aria-label="Words per chapter">
        {plan.map((words, index) => (
          <li key={index}>
            <span>Ch. {index + 1}</span>
            <i aria-hidden="true">
              <b style={{ width: `${(words / longest) * 100}%` }} />
            </i>
            <span>{formatWords(words)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
