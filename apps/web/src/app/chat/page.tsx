"use client";

import { MessageSquare, RefreshCw, Send, Sparkles } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import { apiFetch } from "@/lib/api";

type ChatMessage = { role: "user" | "assistant"; content: string };

type OllamaStatus = {
  available: boolean;
  defaultModel: string;
  models: string[];
  message: string;
};

type ChatResponse = {
  message: { role: "assistant"; content: string };
  model: string;
  usage: { inputTokens: number | null; outputTokens: number | null };
};

export default function ChatPage() {
  const [status, setStatus] = useState<OllamaStatus>();
  const [statusError, setStatusError] = useState<string>();
  const [model, setModel] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const transcriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadStatus();
  }, []);

  useEffect(() => {
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, busy]);

  async function loadStatus() {
    try {
      const next = await apiFetch<OllamaStatus>("/chat/ollama/status");
      setStatus(next);
      setStatusError(undefined);
      setModel(
        (current) => current || next.defaultModel || next.models[0] || "",
      );
    } catch (reason) {
      setStatusError(
        reason instanceof Error
          ? reason.message
          : "Ollama status is unavailable.",
      );
    }
  }

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || busy) return;
    const nextMessages: ChatMessage[] = [
      ...messages,
      { role: "user", content: trimmed },
    ];
    setMessages(nextMessages);
    setDraft("");
    setError(undefined);
    setBusy(true);
    try {
      const response = await apiFetch<ChatResponse>("/chat/ollama", {
        method: "POST",
        body: JSON.stringify({
          model: model || undefined,
          messages: nextMessages,
        }),
      });
      setMessages((current) => [
        ...current,
        { role: "assistant", content: response.message.content },
      ]);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Ollama did not respond.",
      );
    } finally {
      setBusy(false);
    }
  }

  function handleComposerKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void sendMessage();
    }
  }

  function resetConversation() {
    setMessages([]);
    setError(undefined);
  }

  const availableModels = status?.models ?? [];
  const hasCustomModel = model.length > 0 && !availableModels.includes(model);

  return (
    <div className="page chat-page">
      <header className="page-heading compact">
        <div>
          <span className="eyebrow">
            <Sparkles size={14} /> Local model
          </span>
          <h1>Ollama chat</h1>
          <p>
            Talk to your local Ollama runtime — private, on-device, zero token
            cost.
          </p>
        </div>
        <div className="chat-toolbar">
          <span
            className={
              status?.available ? "chat-status ready" : "chat-status idle"
            }
            title={status?.message}
          >
            <i aria-hidden="true" />
            {status?.available ? "Ollama online" : "Ollama offline"}
          </span>
          <button
            type="button"
            className="button secondary"
            onClick={() => void loadStatus()}
            disabled={busy}
          >
            <RefreshCw size={15} /> Refresh
          </button>
        </div>
      </header>

      {statusError && (
        <div className="notice error" role="alert">
          <strong>Cannot reach Ollama status endpoint</strong>
          <span>{statusError}</span>
        </div>
      )}

      <section className="chat-shell">
        <div className="chat-controls">
          <label className="field">
            <span>Model</span>
            {availableModels.length > 0 ? (
              <select
                value={model}
                onChange={(event) => setModel(event.target.value)}
              >
                {availableModels.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
                {hasCustomModel && <option value={model}>{model}</option>}
              </select>
            ) : (
              <input
                value={model}
                placeholder={status?.defaultModel || "llama3.2"}
                onChange={(event) => setModel(event.target.value)}
              />
            )}
          </label>
          <button
            type="button"
            className="button ghost"
            onClick={resetConversation}
            disabled={busy || messages.length === 0}
          >
            Clear conversation
          </button>
        </div>

        <div className="chat-transcript" ref={transcriptRef}>
          {messages.length === 0 ? (
            <div className="chat-empty">
              <MessageSquare size={28} />
              <strong>Start a private conversation</strong>
              <p>
                Your prompts stay on this Mac. Nothing is sent to any external
                API.
              </p>
            </div>
          ) : (
            messages.map((message, index) => (
              <div
                key={index}
                className={
                  message.role === "user"
                    ? "chat-bubble user"
                    : "chat-bubble assistant"
                }
              >
                <span className="chat-role">
                  {message.role === "user" ? "You" : "Ollama"}
                </span>
                <p>{message.content}</p>
              </div>
            ))
          )}
          {busy && (
            <div className="chat-bubble assistant pending">
              <span className="chat-role">Ollama</span>
              <p className="chat-typing" aria-label="Ollama is thinking">
                <span />
                <span />
                <span />
              </p>
            </div>
          )}
        </div>

        {error && (
          <div className="notice error" role="alert">
            <strong>Chat failed</strong>
            <span>{error}</span>
          </div>
        )}

        <form className="chat-composer" onSubmit={sendMessage}>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleComposerKey}
            placeholder="Ask the local model anything…"
            rows={3}
            disabled={busy}
          />
          <div className="chat-composer-actions">
            <small>⌘ / Ctrl + Enter to send</small>
            <button
              type="submit"
              className="button primary"
              disabled={busy || draft.trim().length === 0}
            >
              <Send size={16} /> Send
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
