"use client";

import { Settings2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { AiSettings } from "@/components/kdp/library/ai-settings";
import { AuthorProfiles } from "@/components/kdp/library/author-profiles";
import {
  ProviderStatus,
  type ProvidersResponse,
} from "@/components/kdp/library/provider-status";
import { RulesReference } from "@/components/kdp/library/rules-reference";
import { apiFetch } from "@/lib/api";
import { errorMessage } from "@/lib/kdp";

const sections = [
  { id: "pen-names", label: "Pen names" },
  { id: "ai-routing", label: "AI routing" },
  { id: "budget", label: "Budget" },
  { id: "prices", label: "Prices" },
  { id: "providers", label: "Providers" },
  { id: "kdp-rules", label: "KDP rules" },
];

export default function KdpSettingsPage() {
  const [providers, setProviders] = useState<ProvidersResponse>();
  const [providersError, setProvidersError] = useState<string>();
  const [checking, setChecking] = useState(false);

  const loadProviders = useCallback(async (force: boolean) => {
    setChecking(true);
    try {
      setProviders(
        await apiFetch<ProvidersResponse>(
          `/kdp/providers${force ? "?force=true" : ""}`,
        ),
      );
      setProvidersError(undefined);
    } catch (reason) {
      setProvidersError(errorMessage(reason));
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void loadProviders(false), 0);
    return () => clearTimeout(timer);
  }, [loadProviders]);

  return (
    <div className="page kdp-page kdp-set-page">
      <header className="page-heading compact">
        <div>
          <span className="eyebrow">
            <Settings2 size={14} /> KDP Story Studio
          </span>
          <h1>Settings</h1>
          <p>Pen names, AI providers, spending limits and KDP rules.</p>
        </div>
      </header>

      <nav className="kdp-set-toc" aria-label="Settings sections">
        {sections.map((section) => (
          <a key={section.id} href={`#${section.id}`}>
            {section.label}
          </a>
        ))}
      </nav>

      <AuthorProfiles />
      <AiSettings providers={providers?.providers} />
      <ProviderStatus
        data={providers}
        error={providersError}
        checking={checking}
        onCheck={() => void loadProviders(true)}
      />
      <RulesReference />
    </div>
  );
}
