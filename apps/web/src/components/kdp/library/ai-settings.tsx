"use client";

import type {
  KdpEffort,
  KdpModelPrice,
  KdpProviderHealth,
  KdpRouting,
  KdpSettings,
  KdpTask,
  KdpTextProviderId,
  UpdateKdpSettings,
} from "@ai-studio/contracts";
import {
  kdpEfforts,
  kdpTaskLabels,
  kdpTasks,
  kdpTextProviderIds,
} from "@ai-studio/contracts";
import { Plus, RefreshCw, Save, TriangleAlert, X } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import { Pill } from "@/components/kdp/kdp-ui";
import { kdpSend, newIdempotencyKey, useResource } from "@/lib/kdp";

import { parseNumber, readableErrors } from "./form-errors";

export const providerLabels: Record<KdpTextProviderId, string> = {
  anthropic: "Claude",
  openai: "OpenAI",
  ollama: "Local Ollama",
};

const effortLabels: Record<KdpEffort, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Maximum",
};

type RouteDraft = {
  provider: KdpTextProviderId;
  model: string;
  effort: KdpEffort | "";
};

type PriceDraft = {
  key: string;
  provider: KdpTextProviderId;
  model: string;
  inputPerMTok: string;
  outputPerMTok: string;
  cacheReadPerMTok: string;
  cacheWritePerMTok: string;
  verified: boolean;
  source: string;
};

type PriceNumberKey =
  "inputPerMTok" | "outputPerMTok" | "cacheReadPerMTok" | "cacheWritePerMTok";

type SettingsDraft = {
  routing: Record<KdpTask, RouteDraft>;
  prices: PriceDraft[];
  unknownInput: string;
  unknownOutput: string;
  defaultBudgetUsd: string;
  maxConcurrent: string;
  maxRetries: string;
};

const priceColumns: { key: PriceNumberKey; label: string }[] = [
  { key: "inputPerMTok", label: "Input" },
  { key: "outputPerMTok", label: "Output" },
  { key: "cacheReadPerMTok", label: "Cache read" },
  { key: "cacheWritePerMTok", label: "Cache write" },
];

function toDraft(settings: KdpSettings): SettingsDraft {
  const routing = Object.fromEntries(
    kdpTasks.map((task) => {
      const route = settings.routing[task];
      return [
        task,
        {
          provider: route.provider,
          model: route.model ?? "",
          effort: route.effort ?? "",
        },
      ];
    }),
  ) as Record<KdpTask, RouteDraft>;
  return {
    routing,
    prices: settings.prices.map((price, index) => ({
      key: `price-${index}`,
      provider: price.provider,
      model: price.model,
      inputPerMTok: String(price.inputPerMTok),
      outputPerMTok: String(price.outputPerMTok),
      cacheReadPerMTok: String(price.cacheReadPerMTok),
      cacheWritePerMTok: String(price.cacheWritePerMTok),
      verified: price.verified,
      source: price.source ?? "",
    })),
    unknownInput: String(settings.unknownModelPrice.inputPerMTok),
    unknownOutput: String(settings.unknownModelPrice.outputPerMTok),
    defaultBudgetUsd: String(settings.defaultBudgetUsd),
    maxConcurrent: String(settings.maxConcurrentRequestsPerProvider),
    maxRetries: String(settings.maxRetries),
  };
}

/** Same comparison for saved and edited state, ignoring row keys. */
function fingerprint(draft: SettingsDraft): string {
  return JSON.stringify({
    ...draft,
    prices: draft.prices.map((price) => ({ ...price, key: undefined })),
  });
}

function toPayload(
  draft: SettingsDraft,
): { payload: UpdateKdpSettings } | { errors: string[] } {
  const errors: string[] = [];
  const price = { min: 0, max: 1000 };
  const routing = Object.fromEntries(
    kdpTasks.map((task) => {
      const route = draft.routing[task];
      const model = route.model.trim();
      if (model.length > 120)
        errors.push(`${kdpTaskLabels[task]}: model id is too long.`);
      return [
        task,
        {
          provider: route.provider,
          model: model || null,
          effort:
            route.provider === "anthropic" && route.effort
              ? route.effort
              : null,
        },
      ];
    }),
  ) as KdpRouting;

  const prices: KdpModelPrice[] = draft.prices.map((row, index) => {
    const name = row.model.trim() || `Row ${index + 1}`;
    if (!row.model.trim())
      errors.push(`Price row ${index + 1}: enter a model id.`);
    const numbers = Object.fromEntries(
      priceColumns.map(({ key, label }) => {
        const value = parseNumber(row[key], price);
        if (value === undefined)
          errors.push(`${name}: ${label.toLowerCase()} price must be 0–1,000.`);
        return [key, value ?? 0];
      }),
    ) as Record<PriceNumberKey, number>;
    return {
      provider: row.provider,
      model: row.model.trim(),
      ...numbers,
      verified: row.verified,
      source: row.source.trim() || null,
    };
  });

  const unknownInput = parseNumber(draft.unknownInput, price);
  const unknownOutput = parseNumber(draft.unknownOutput, price);
  if (unknownInput === undefined || unknownOutput === undefined)
    errors.push("Fallback price must be 0–1,000 per million tokens.");
  const budget = parseNumber(draft.defaultBudgetUsd, { min: 0, max: 10_000 });
  if (budget === undefined)
    errors.push("Default book budget must be 0–10,000 USD.");
  const concurrent = parseNumber(draft.maxConcurrent, {
    min: 1,
    max: 8,
    integer: true,
  });
  if (concurrent === undefined)
    errors.push("Parallel requests must be a whole number from 1 to 8.");
  const retries = parseNumber(draft.maxRetries, {
    min: 0,
    max: 6,
    integer: true,
  });
  if (retries === undefined)
    errors.push("Retries must be a whole number from 0 to 6.");
  if (prices.length > 60) errors.push("The price table holds up to 60 rows.");

  if (errors.length > 0) return { errors };
  return {
    payload: {
      routing,
      prices,
      unknownModelPrice: {
        inputPerMTok: unknownInput ?? 0,
        outputPerMTok: unknownOutput ?? 0,
      },
      defaultBudgetUsd: budget ?? 0,
      maxConcurrentRequestsPerProvider: concurrent ?? 1,
      maxRetries: retries ?? 0,
    },
  };
}

function RoutingTable({
  draft,
  providers,
  onChange,
}: {
  draft: SettingsDraft;
  providers: KdpProviderHealth[] | undefined;
  onChange: (task: KdpTask, route: RouteDraft) => void;
}) {
  return (
    <div className="kdp-set-routes" role="group" aria-label="Provider per task">
      <div className="kdp-set-route head" aria-hidden="true">
        <span>Task</span>
        <span>Provider</span>
        <span>Model</span>
        <span>Effort</span>
      </div>
      {kdpTasks.map((task) => {
        const route = draft.routing[task];
        const label = kdpTaskLabels[task];
        const defaultModel = providers?.find(
          (provider) => provider.id === route.provider,
        )?.model;
        return (
          <div key={task} className="kdp-set-route">
            <strong>{label}</strong>
            <label className="kdp-set-cell">
              <span>Provider</span>
              <select
                className="kdp-set-input"
                value={route.provider}
                aria-label={`${label}: provider`}
                onChange={(event) => {
                  const provider = event.target.value as KdpTextProviderId;
                  onChange(task, {
                    ...route,
                    provider,
                    effort:
                      provider === "anthropic" ? route.effort || "high" : "",
                  });
                }}
              >
                {kdpTextProviderIds.map((id) => (
                  <option key={id} value={id}>
                    {providerLabels[id]}
                  </option>
                ))}
              </select>
            </label>
            <label className="kdp-set-cell">
              <span>Model</span>
              <input
                className="kdp-set-input"
                value={route.model}
                maxLength={120}
                placeholder={defaultModel ?? "Default model"}
                aria-label={`${label}: model id, empty for the default`}
                onChange={(event) =>
                  onChange(task, { ...route, model: event.target.value })
                }
              />
            </label>
            <label className="kdp-set-cell">
              <span>Effort</span>
              {route.provider === "anthropic" ? (
                <select
                  className="kdp-set-input"
                  value={route.effort}
                  aria-label={`${label}: effort`}
                  onChange={(event) =>
                    onChange(task, {
                      ...route,
                      effort: event.target.value as KdpEffort | "",
                    })
                  }
                >
                  <option value="">Default</option>
                  {kdpEfforts.map((effort) => (
                    <option key={effort} value={effort}>
                      {effortLabels[effort]}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="kdp-set-na">Claude only</span>
              )}
            </label>
          </div>
        );
      })}
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  suffix,
  help,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  help?: string;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id} className="kdp-wiz-field-label">
        {label}
      </label>
      <div className={suffix ? "input-suffix" : undefined}>
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-describedby={help ? `${id}-help` : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
        {suffix && <em>{suffix}</em>}
      </div>
      {help && (
        <small id={`${id}-help`} className="kdp-wiz-help">
          {help}
        </small>
      )}
    </div>
  );
}

function PriceTable({
  prices,
  onChange,
}: {
  prices: PriceDraft[];
  onChange: (prices: PriceDraft[]) => void;
}) {
  const update = (key: string, patch: Partial<PriceDraft>) =>
    onChange(
      prices.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  return (
    <div className="kdp-set-table-wrap">
      <table className="kdp-set-prices">
        <caption className="kdp-lib-sr">
          Model prices in USD per million tokens
        </caption>
        <thead>
          <tr>
            <th scope="col">Provider</th>
            <th scope="col">Model</th>
            {priceColumns.map((column) => (
              <th scope="col" key={column.key}>
                {column.label}
              </th>
            ))}
            <th scope="col">Verified</th>
            <th scope="col">Source</th>
            <th scope="col">
              <span className="kdp-lib-sr">Remove</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {prices.map((row, index) => {
            const name = row.model.trim() || `row ${index + 1}`;
            return (
              <tr key={row.key} className={row.verified ? "" : "unverified"}>
                <td>
                  <select
                    className="kdp-set-input"
                    value={row.provider}
                    aria-label={`${name}: provider`}
                    onChange={(event) =>
                      update(row.key, {
                        provider: event.target.value as KdpTextProviderId,
                      })
                    }
                  >
                    {kdpTextProviderIds.map((id) => (
                      <option key={id} value={id}>
                        {providerLabels[id]}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    className="kdp-set-input model"
                    value={row.model}
                    maxLength={120}
                    aria-label={`Model id, row ${index + 1}`}
                    onChange={(event) =>
                      update(row.key, { model: event.target.value })
                    }
                  />
                </td>
                {priceColumns.map((column) => (
                  <td key={column.key}>
                    <input
                      className="kdp-set-input number"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={1000}
                      step="any"
                      value={row[column.key]}
                      aria-label={`${name}: ${column.label.toLowerCase()} price per million tokens`}
                      onChange={(event) =>
                        update(row.key, { [column.key]: event.target.value })
                      }
                    />
                  </td>
                ))}
                <td>
                  <label className="kdp-set-verified">
                    <input
                      type="checkbox"
                      checked={row.verified}
                      onChange={(event) =>
                        update(row.key, { verified: event.target.checked })
                      }
                    />
                    <span className="kdp-lib-sr">{name}: verified</span>
                    {!row.verified && <Pill tone="warn">Check</Pill>}
                  </label>
                </td>
                <td>
                  <input
                    className="kdp-set-input source"
                    value={row.source}
                    maxLength={300}
                    placeholder="Where the price comes from"
                    aria-label={`${name}: source`}
                    onChange={(event) =>
                      update(row.key, { source: event.target.value })
                    }
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove ${name}`}
                    onClick={() =>
                      onChange(prices.filter((item) => item.key !== row.key))
                    }
                  >
                    <X size={15} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AiSettingsEditor({
  initial,
  providers,
}: {
  initial: KdpSettings;
  providers: KdpProviderHealth[] | undefined;
}) {
  const [saved, setSaved] = useState<SettingsDraft>(() => toDraft(initial));
  const [draft, setDraft] = useState<SettingsDraft>(saved);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>();
  const [justSaved, setJustSaved] = useState(false);

  const dirty = fingerprint(draft) !== fingerprint(saved);
  const unverified = draft.prices.filter((price) => !price.verified).length;

  const change = (update: (current: SettingsDraft) => SettingsDraft) => {
    setDraft(update);
    setJustSaved(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = toPayload(draft);
    if ("errors" in result) {
      setErrors(result.errors);
      return;
    }
    setSaving(true);
    setErrors(undefined);
    try {
      const next = await kdpSend<KdpSettings>(
        "/kdp/settings",
        "PUT",
        result.payload,
      );
      const nextDraft = toDraft(next);
      setSaved(nextDraft);
      setDraft(nextDraft);
      setJustSaved(true);
    } catch (reason) {
      setErrors(readableErrors(reason, {}));
    } finally {
      setSaving(false);
    }
  };

  const status = saving
    ? { tone: "", text: "Saving…" }
    : errors
      ? { tone: "error", text: "Not saved" }
      : dirty
        ? { tone: "dirty", text: "Unsaved changes" }
        : justSaved
          ? { tone: "", text: "Saved" }
          : { tone: "", text: "All changes saved" };

  return (
    <form className="kdp-set-ai" onSubmit={submit} noValidate>
      <section
        className="kdp-card"
        id="ai-routing"
        aria-labelledby="ai-routing-title"
      >
        <header>
          <div>
            <h2 id="ai-routing-title">AI routing</h2>
            <p>
              Which provider handles each task. Leave the model empty to use the
              provider’s default.
            </p>
          </div>
        </header>
        <RoutingTable
          draft={draft}
          providers={providers}
          onChange={(task, route) =>
            change((current) => ({
              ...current,
              routing: { ...current.routing, [task]: route },
            }))
          }
        />
      </section>

      <section className="kdp-card" id="budget" aria-labelledby="budget-title">
        <header>
          <div>
            <h2 id="budget-title">Budget and reliability</h2>
            <p>Limits that apply to every book unless the book sets its own.</p>
          </div>
        </header>
        <div className="kdp-grid-3">
          <NumberField
            label="Default book budget"
            suffix="USD"
            min={0}
            max={10_000}
            step={1}
            value={draft.defaultBudgetUsd}
            help="Jobs stop when a book reaches it."
            onChange={(value) =>
              change((current) => ({ ...current, defaultBudgetUsd: value }))
            }
          />
          <NumberField
            label="Parallel requests per provider"
            min={1}
            max={8}
            step={1}
            value={draft.maxConcurrent}
            help="1 to 8. Lower it if you hit rate limits."
            onChange={(value) =>
              change((current) => ({ ...current, maxConcurrent: value }))
            }
          />
          <NumberField
            label="Retries after a failed request"
            min={0}
            max={6}
            step={1}
            value={draft.maxRetries}
            help="0 to 6."
            onChange={(value) =>
              change((current) => ({ ...current, maxRetries: value }))
            }
          />
        </div>
      </section>

      <section className="kdp-card" id="prices" aria-labelledby="prices-title">
        <header>
          <div>
            <h2 id="prices-title">Model prices</h2>
            <p>USD per million tokens, used to estimate and cap spending.</p>
          </div>
          {unverified > 0 && (
            <Pill tone="warn">
              <TriangleAlert size={12} aria-hidden="true" /> {unverified}{" "}
              unverified
            </Pill>
          )}
        </header>
        {unverified > 0 && (
          <p className="kdp-set-callout">
            Unverified prices are estimates. Check them against the provider’s
            price page, then tick Verified.
          </p>
        )}
        <PriceTable
          prices={draft.prices}
          onChange={(prices) => change((current) => ({ ...current, prices }))}
        />
        <div className="kdp-set-price-foot">
          <button
            type="button"
            className="button ghost small"
            disabled={draft.prices.length >= 60}
            onClick={() =>
              change((current) => ({
                ...current,
                prices: [
                  ...current.prices,
                  {
                    key: newIdempotencyKey(),
                    provider: "anthropic",
                    model: "",
                    inputPerMTok: "0",
                    outputPerMTok: "0",
                    cacheReadPerMTok: "0",
                    cacheWritePerMTok: "0",
                    verified: false,
                    source: "",
                  },
                ],
              }))
            }
          >
            <Plus size={14} /> Add model
          </button>
          <div className="kdp-set-fallback">
            <span>Models not in the table</span>
            <NumberField
              label="Input"
              suffix="USD"
              min={0}
              max={1000}
              step={0.01}
              value={draft.unknownInput}
              onChange={(value) =>
                change((current) => ({ ...current, unknownInput: value }))
              }
            />
            <NumberField
              label="Output"
              suffix="USD"
              min={0}
              max={1000}
              step={0.01}
              value={draft.unknownOutput}
              onChange={(value) =>
                change((current) => ({ ...current, unknownOutput: value }))
              }
            />
          </div>
        </div>
      </section>

      <div className={`kdp-set-savebar${dirty || errors ? " sticky" : ""}`}>
        <span
          className={`kdp-saved ${status.tone}`}
          role="status"
          aria-live="polite"
        >
          {status.text}
        </span>
        {errors && (
          <ul className="kdp-set-errors" role="alert">
            {errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        )}
        <button
          type="button"
          className="button secondary"
          disabled={!dirty || saving}
          onClick={() => {
            setDraft(saved);
            setErrors(undefined);
          }}
        >
          Discard
        </button>
        <button
          type="submit"
          className="button primary"
          disabled={!dirty || saving}
        >
          <Save size={15} /> {saving ? "Saving…" : "Save settings"}
        </button>
      </div>
    </form>
  );
}

/** AI routing, budget limits and the price table, saved together. */
export function AiSettings({
  providers,
}: {
  providers: KdpProviderHealth[] | undefined;
}) {
  const settings = useResource<KdpSettings>("/kdp/settings");
  if (!settings.data) {
    return (
      <section className="kdp-card" id="ai-routing" aria-busy={!settings.error}>
        <header>
          <div>
            <h2>AI routing</h2>
          </div>
        </header>
        {settings.error ? (
          <div className="notice error" role="alert">
            <span>{settings.error}</span>
            <button
              type="button"
              className="button ghost small"
              onClick={() => void settings.reload()}
            >
              <RefreshCw size={14} /> Try again
            </button>
          </div>
        ) : (
          <div className="kdp-set-skeleton" />
        )}
      </section>
    );
  }
  return <AiSettingsEditor initial={settings.data} providers={providers} />;
}
