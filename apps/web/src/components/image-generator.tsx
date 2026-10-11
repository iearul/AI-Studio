"use client";

import type {
  CloudImageProviderId,
  ImageProviderModel,
  ImageProviderStatus,
  ImageQuality,
} from "@ai-film-studio/contracts";
import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";

export type ImageChoice = {
  provider: CloudImageProviderId;
  model: string;
  quality: string;
};

export type ResolvedImageChoice = {
  provider: ImageProviderStatus;
  model: ImageProviderModel;
  quality: ImageQuality;
};

const storageKey = "ai-film-studio.image-generator";

function readStoredChoice(): ImageChoice | undefined {
  try {
    const value = window.localStorage.getItem(storageKey);
    return value ? (JSON.parse(value) as ImageChoice) : undefined;
  } catch {
    return undefined;
  }
}

function storeChoice(choice: ImageChoice): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(choice));
  } catch {
    // The choice is a convenience; it simply is not remembered.
  }
}

function resolve(
  providers: ImageProviderStatus[],
  choice: ImageChoice | undefined,
): ResolvedImageChoice | undefined {
  const provider =
    providers.find((candidate) => candidate.id === choice?.provider) ??
    providers.find((candidate) => candidate.configured) ??
    providers[0];
  if (!provider) return undefined;
  const model =
    provider.models.find((candidate) => candidate.id === choice?.model) ??
    provider.models.find(
      (candidate) => candidate.id === provider.defaultModel,
    ) ??
    provider.models[0]!;
  const quality =
    model.qualities.find((candidate) => candidate.id === choice?.quality) ??
    model.qualities[Math.min(1, model.qualities.length - 1)]!;
  return { provider, model, quality };
}

export function useImageGenerator() {
  const [providers, setProviders] = useState<ImageProviderStatus[]>([]);
  const [choice, setChoiceState] = useState<ImageChoice>();
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void apiFetch<{ providers: ImageProviderStatus[] }>("/providers/images")
      .then((response) => {
        if (cancelled) return;
        setProviders(response.providers);
        setChoiceState(readStoredChoice());
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(
            reason instanceof Error
              ? reason.message
              : "Image providers could not be loaded.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setChoice = useCallback((next: ImageChoice) => {
    setChoiceState(next);
    storeChoice(next);
  }, []);

  return {
    providers,
    resolved: resolve(providers, choice),
    setChoice,
    error,
  };
}

export function ImageGeneratorControls({
  providers,
  resolved,
  onChange,
  disabled = false,
}: {
  providers: ImageProviderStatus[];
  resolved: ResolvedImageChoice;
  onChange: (choice: ImageChoice) => void;
  disabled?: boolean;
}) {
  const { provider, model, quality } = resolved;
  return (
    <div className="image-generator-controls">
      <div className="image-settings-row">
        <label className="field">
          <span>Image API</span>
          <select
            value={provider.id}
            disabled={disabled}
            onChange={(event) => {
              const next = providers.find(
                (candidate) => candidate.id === event.target.value,
              );
              if (next) {
                onChange({
                  provider: next.id,
                  model: next.defaultModel,
                  quality: "",
                });
              }
            }}
          >
            {providers.map((candidate) => (
              <option value={candidate.id} key={candidate.id}>
                {candidate.label}
                {candidate.configured ? "" : " (key missing)"}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Model</span>
          <select
            value={model.id}
            disabled={disabled}
            onChange={(event) =>
              onChange({
                provider: provider.id,
                model: event.target.value,
                quality: quality.id,
              })
            }
          >
            {provider.models.map((candidate) => (
              <option value={candidate.id} key={candidate.id}>
                {candidate.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Quality</span>
          <select
            value={quality.id}
            disabled={disabled}
            onChange={(event) =>
              onChange({
                provider: provider.id,
                model: model.id,
                quality: event.target.value,
              })
            }
          >
            {model.qualities.map((candidate) => (
              <option value={candidate.id} key={candidate.id}>
                {candidate.label}
              </option>
            ))}
          </select>
        </label>
        <span className="cloud-estimate">
          <small>Estimate per image</small>
          <strong>
            {quality.estimatedUsdPerImage > 0
              ? `About ${formatUsd(quality.estimatedUsdPerImage)}`
              : "See provider"}
          </strong>
        </span>
      </div>
      <p
        className={`image-generator-note ${provider.configured ? "" : "warn"}`}
      >
        {provider.configured ? model.pricingMessage : provider.message}
      </p>
    </div>
  );
}

export function confirmImageGeneration(
  resolved: ResolvedImageChoice,
  subject: string,
  referenceCount: number,
): boolean {
  const { provider, model, quality } = resolved;
  const attached = Math.min(referenceCount, model.maxReferenceImages);
  return window.confirm(
    [
      `${provider.label} is a paid image generation.`,
      "",
      `For: ${subject}`,
      `Model: ${model.label}`,
      `Quality: ${quality.label}`,
      `Reference photos attached: ${attached}`,
      `Estimate: about ${formatUsd(quality.estimatedUsdPerImage)} per image${
        provider.id === "openai" && attached > 0
          ? `, plus about ${formatUsd(attached * 0.01)} for reference photos`
          : ""
      }`,
      "",
      "The recorded cost appears on the attempt. Continue?",
    ].join("\n"),
  );
}

export function formatUsd(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: value < 0.1 ? 3 : 2,
  }).format(value);
}
