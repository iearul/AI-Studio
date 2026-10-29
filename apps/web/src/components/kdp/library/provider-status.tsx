"use client";

import type { KdpProviderHealth } from "@ai-studio/contracts";
import { RefreshCw, ServerCog } from "lucide-react";

import { Pill } from "@/components/kdp/kdp-ui";
import { formatDateTime } from "@/lib/kdp";

import { providerLabels } from "./ai-settings";

export type ProvidersResponse = {
  providers: KdpProviderHealth[];
  worker: { running: boolean };
};

/** Configured/available state per provider. Keys never reach the browser. */
export function ProviderStatus({
  data,
  error,
  checking,
  onCheck,
}: {
  data: ProvidersResponse | undefined;
  error: string | undefined;
  checking: boolean;
  onCheck: () => void;
}) {
  return (
    <section
      className="kdp-card"
      id="providers"
      aria-labelledby="providers-title"
    >
      <header>
        <div>
          <h2 id="providers-title">Provider status</h2>
          <p>
            Keys are read from the server’s environment and never shown here.
          </p>
        </div>
        <button
          type="button"
          className="button secondary small"
          onClick={onCheck}
          disabled={checking}
        >
          <RefreshCw size={14} className={checking ? "spin" : undefined} />
          {checking ? "Checking…" : "Check again"}
        </button>
      </header>

      <div aria-live="polite">
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        {data && (
          <>
            <p className={`kdp-set-worker${data.worker.running ? "" : " off"}`}>
              <ServerCog size={16} aria-hidden="true" />
              <span>
                {data.worker.running
                  ? "Background worker is running."
                  : "Background worker is not running. Jobs wait until the app runs normally."}
              </span>
            </p>
            <ul className="kdp-set-providers">
              {data.providers.map((provider) => (
                <li key={provider.id}>
                  <header>
                    <h3>{providerLabels[provider.id] ?? provider.name}</h3>
                    <Pill
                      tone={
                        provider.available
                          ? "good"
                          : provider.configured
                            ? "warn"
                            : "neutral"
                      }
                    >
                      {provider.available
                        ? "Available"
                        : provider.configured
                          ? "Not reachable"
                          : "Not configured"}
                    </Pill>
                  </header>
                  <dl>
                    <div>
                      <dt>Configured</dt>
                      <dd>{provider.configured ? "Yes" : "No"}</dd>
                    </div>
                    <div>
                      <dt>Default model</dt>
                      <dd>{provider.model ?? "—"}</dd>
                    </div>
                    <div>
                      <dt>Checked</dt>
                      <dd>{formatDateTime(provider.checkedAt)}</dd>
                    </div>
                  </dl>
                  {provider.message && (
                    <p className="kdp-muted">{provider.message}</p>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
        {!data && !error && (
          <div className="kdp-set-skeleton" aria-busy="true" />
        )}
      </div>
    </section>
  );
}
