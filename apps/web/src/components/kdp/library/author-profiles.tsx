"use client";

import type { AuthorProfile, AuthorProfileInput } from "@ai-studio/contracts";
import {
  PenLine,
  Plus,
  Star,
  Trash2,
  TriangleAlert,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { EmptyPanel, Pill } from "@/components/kdp/kdp-ui";
import {
  errorMessage,
  kdpDelete,
  kdpSend,
  languageLabel,
  languageOptions,
  newIdempotencyKey,
  useResource,
} from "@/lib/kdp";

import { ConfirmDialog } from "./confirm-dialog";
import { readableErrors } from "./form-errors";
import { TextField } from "./wizard-fields";

type LinkDraft = { key: string; label: string; url: string };

type AuthorDraft = {
  penName: string;
  genres: string;
  defaultLanguage: string;
  defaultStyle: string;
  biography: string;
  shortBiography: string;
  website: string;
  links: LinkDraft[];
  dedication: string;
  contentNotice: string;
  aboutAuthor: string;
  callToAction: string;
  nextBookPreview: string;
  copyrightNotice: string;
  coverBranding: string;
  contentPreferences: string;
  isDefault: boolean;
  provisional: boolean;
};

type TextKey = {
  [K in keyof AuthorDraft]: AuthorDraft[K] extends string ? K : never;
}[keyof AuthorDraft];

const authorLabels: Record<string, string> = {
  penName: "Pen name",
  genres: "Genres",
  defaultLanguage: "Default language",
  defaultStyle: "Default style",
  biography: "Biography",
  shortBiography: "Short bio",
  website: "Website",
  links: "Links",
  dedication: "Dedication",
  contentNotice: "Content notice",
  aboutAuthor: "About the author",
  callToAction: "Call to action",
  nextBookPreview: "Next-book preview",
  copyrightNotice: "Copyright notice",
  coverBranding: "Cover branding",
  contentPreferences: "Content preferences",
};

function toDraft(profile: AuthorProfile | undefined): AuthorDraft {
  return {
    penName: profile?.penName ?? "",
    genres: profile?.genres.join(", ") ?? "",
    defaultLanguage: profile?.defaultLanguage ?? "en",
    defaultStyle: profile?.defaultStyle ?? "",
    biography: profile?.biography ?? "",
    shortBiography: profile?.shortBiography ?? "",
    website: profile?.website ?? "",
    links: (profile?.links ?? []).map((link, index) => ({
      key: `link-${index}`,
      label: link.label,
      url: link.url,
    })),
    dedication: profile?.dedication ?? "",
    contentNotice: profile?.contentNotice ?? "",
    aboutAuthor: profile?.aboutAuthor ?? "",
    callToAction: profile?.callToAction ?? "",
    nextBookPreview: profile?.nextBookPreview ?? "",
    copyrightNotice: profile?.copyrightNotice ?? "",
    coverBranding: profile?.coverBranding ?? "",
    contentPreferences: profile?.contentPreferences ?? "",
    isDefault: profile?.isDefault ?? false,
    provisional: profile?.provisional ?? true,
  };
}

const optional = (value: string) => value.trim() || null;

function fromDraft(draft: AuthorDraft): AuthorProfileInput {
  return {
    penName: draft.penName.trim(),
    genres: draft.genres
      .split(",")
      .map((genre) => genre.trim())
      .filter(Boolean),
    defaultLanguage: draft.defaultLanguage,
    defaultStyle: optional(draft.defaultStyle),
    biography: optional(draft.biography),
    shortBiography: optional(draft.shortBiography),
    website: optional(draft.website),
    links: draft.links
      .filter((link) => link.label.trim() || link.url.trim())
      .map((link) => ({ label: link.label.trim(), url: link.url.trim() })),
    dedication: optional(draft.dedication),
    contentNotice: optional(draft.contentNotice),
    aboutAuthor: optional(draft.aboutAuthor),
    callToAction: optional(draft.callToAction),
    nextBookPreview: optional(draft.nextBookPreview),
    copyrightNotice: optional(draft.copyrightNotice),
    coverBranding: optional(draft.coverBranding),
    contentPreferences: optional(draft.contentPreferences),
    isDefault: draft.isDefault,
    provisional: draft.provisional,
  };
}

function AuthorEditor({
  initial,
  onSaved,
  onCancel,
}: {
  initial: AuthorProfile | undefined;
  onSaved: (profile: AuthorProfile) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<AuthorDraft>(() => toDraft(initial));
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>();
  const languageId = useId();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    formRef.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, []);

  const text = (key: TextKey) => ({
    value: draft[key],
    onChange: (value: string) =>
      setDraft((current) => ({ ...current, [key]: value })),
  });
  const setLink = (key: string, field: "label" | "url", value: string) =>
    setDraft((current) => ({
      ...current,
      links: current.links.map((link) =>
        link.key === key ? { ...link, [field]: value } : link,
      ),
    }));

  const knownLanguage = languageOptions.some(
    (option) => option.code === draft.defaultLanguage,
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (draft.penName.trim().length < 2) {
      setErrors(["Pen name: use at least 2 characters."]);
      return;
    }
    setSaving(true);
    setErrors(undefined);
    try {
      const payload = fromDraft(draft);
      const profile = initial
        ? await kdpSend<AuthorProfile>(
            `/kdp/authors/${initial.id}`,
            "PATCH",
            payload,
          )
        : await kdpSend<AuthorProfile>("/kdp/authors", "POST", payload);
      onSaved(profile);
    } catch (reason) {
      setErrors(readableErrors(reason, authorLabels));
    } finally {
      setSaving(false);
    }
  };

  const title = initial ? `Edit ${initial.penName}` : "New pen name";
  return (
    <form
      ref={formRef}
      className="kdp-set-editor"
      onSubmit={submit}
      aria-label={title}
    >
      <header>
        <h3>{title}</h3>
        <button
          type="button"
          className="icon-button"
          onClick={onCancel}
          aria-label="Close without saving"
        >
          <X size={16} />
        </button>
      </header>
      <p className="kdp-muted">
        Pen names are public. Don’t enter a legal name, tax or address details.
      </p>

      <div className="field-grid">
        <TextField
          required
          label="Pen name"
          maxLength={120}
          placeholder="E. M. Thorne"
          {...text("penName")}
        />
        <div className="field">
          <label htmlFor={languageId} className="kdp-wiz-field-label">
            Default language
          </label>
          <select
            id={languageId}
            value={draft.defaultLanguage}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                defaultLanguage: event.target.value,
              }))
            }
          >
            {languageOptions.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
            {!knownLanguage && (
              <option value={draft.defaultLanguage}>
                {draft.defaultLanguage}
              </option>
            )}
          </select>
        </div>
        <TextField
          label="Genres"
          maxLength={800}
          placeholder="Psychological thriller, Mystery"
          help="Separate with commas."
          {...text("genres")}
        />
        <TextField
          label="Website"
          maxLength={500}
          placeholder="https://"
          {...text("website")}
        />
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={draft.isDefault}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                isDefault: event.target.checked,
              }))
            }
          />
          <span>
            <strong>Default pen name</strong>
            <small>Preselected for new stories.</small>
          </span>
        </label>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={draft.provisional}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                provisional: event.target.checked,
              }))
            }
          />
          <span>
            <strong>Name not yet checked for legal or trademark use</strong>
            <small>Clear this once you have checked the name.</small>
          </span>
        </label>
      </div>

      <fieldset className="kdp-set-links">
        <legend>Links</legend>
        {draft.links.map((link, index) => (
          <div key={link.key} className="kdp-set-link-row">
            <input
              className="kdp-set-input"
              value={link.label}
              maxLength={60}
              placeholder="Newsletter"
              aria-label={`Link ${index + 1} label`}
              onChange={(event) =>
                setLink(link.key, "label", event.target.value)
              }
            />
            <input
              className="kdp-set-input"
              type="url"
              value={link.url}
              maxLength={500}
              placeholder="https://"
              aria-label={`Link ${index + 1} address`}
              onChange={(event) => setLink(link.key, "url", event.target.value)}
            />
            <button
              type="button"
              className="icon-button"
              aria-label={`Remove link ${index + 1}`}
              onClick={() =>
                setDraft((current) => ({
                  ...current,
                  links: current.links.filter((item) => item.key !== link.key),
                }))
              }
            >
              <X size={15} />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="button ghost small"
          disabled={draft.links.length >= 10}
          onClick={() =>
            setDraft((current) => ({
              ...current,
              links: [
                ...current.links,
                { key: newIdempotencyKey(), label: "", url: "" },
              ],
            }))
          }
        >
          <Plus size={14} /> Add link
        </button>
      </fieldset>

      <details className="kdp-details kdp-set-group" open={!initial}>
        <summary>Writing defaults</summary>
        <div className="field-grid">
          <TextField
            full
            rows={3}
            label="Default style"
            maxLength={2000}
            placeholder="Close, restrained narration with precise detail"
            {...text("defaultStyle")}
          />
          <TextField
            full
            rows={3}
            label="Content preferences"
            maxLength={2000}
            placeholder="No on-page violence against children or animals"
            {...text("contentPreferences")}
          />
        </div>
      </details>

      <details className="kdp-details kdp-set-group">
        <summary>Biography and book matter</summary>
        <div className="field-grid">
          <TextField
            full
            rows={2}
            label="Short bio"
            maxLength={600}
            {...text("shortBiography")}
          />
          <TextField
            full
            rows={4}
            label="Biography"
            maxLength={4000}
            {...text("biography")}
          />
          <TextField
            full
            rows={4}
            label="About the author (back of the book)"
            maxLength={4000}
            {...text("aboutAuthor")}
          />
          <TextField
            rows={3}
            label="Dedication"
            maxLength={1000}
            {...text("dedication")}
          />
          <TextField
            rows={3}
            label="Content notice"
            maxLength={2000}
            {...text("contentNotice")}
          />
          <TextField
            rows={3}
            label="Call to action"
            maxLength={2000}
            placeholder="Join the newsletter for a free short story"
            {...text("callToAction")}
          />
          <TextField
            rows={3}
            label="Copyright notice"
            maxLength={2000}
            {...text("copyrightNotice")}
          />
          <TextField
            full
            rows={5}
            label="Next-book preview"
            maxLength={20_000}
            {...text("nextBookPreview")}
          />
          <TextField
            full
            rows={2}
            label="Cover branding"
            maxLength={1000}
            placeholder="Author name in condensed serif capitals, top third"
            {...text("coverBranding")}
          />
        </div>
      </details>

      {errors && (
        <div className="notice error" role="alert">
          <TriangleAlert size={16} aria-hidden="true" />
          <span>{errors.join(" ")}</span>
        </div>
      )}
      <div className="kdp-actions kdp-set-editor-actions">
        <button type="button" className="button secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="button primary" disabled={saving}>
          {saving ? "Saving…" : initial ? "Save pen name" : "Add pen name"}
        </button>
      </div>
    </form>
  );
}

function AuthorRow({
  author,
  onEdit,
  onDelete,
  disabled,
}: {
  author: AuthorProfile;
  onEdit: () => void;
  onDelete: () => void;
  disabled: boolean;
}) {
  const initial = Array.from(author.penName.trim())[0]?.toUpperCase() ?? "?";
  return (
    <li className="kdp-set-author">
      <span className="kdp-set-avatar" aria-hidden="true">
        {initial}
      </span>
      <div className="kdp-set-author-body">
        <h3>
          {author.penName}
          {author.isDefault && (
            <Pill tone="accent">
              <Star size={11} aria-hidden="true" /> Default
            </Pill>
          )}
          {author.provisional && <Pill tone="warn">Name not checked</Pill>}
        </h3>
        <p className="kdp-muted">
          {[languageLabel(author.defaultLanguage), author.genres.join(", ")]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {author.shortBiography && (
          <p className="kdp-set-author-bio">{author.shortBiography}</p>
        )}
      </div>
      <div className="kdp-actions">
        <button
          type="button"
          className="button secondary small"
          onClick={onEdit}
          disabled={disabled}
          aria-label={`Edit ${author.penName}`}
        >
          <PenLine size={14} /> Edit
        </button>
        <button
          type="button"
          className="button danger small"
          onClick={onDelete}
          disabled={disabled}
          aria-label={`Delete ${author.penName}`}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </li>
  );
}

/** Pen name list with inline create, edit and delete. */
export function AuthorProfiles() {
  const authors = useResource<{ items: AuthorProfile[] }>("/kdp/authors");
  const [editing, setEditing] = useState<string>();
  const [confirm, setConfirm] = useState<AuthorProfile>();
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<{
    tone: "success" | "error";
    text: string;
  }>();

  const saved = (profile: AuthorProfile, created: boolean) => {
    setEditing(undefined);
    setMessage({
      tone: "success",
      text: created ? `Added ${profile.penName}.` : `Saved ${profile.penName}.`,
    });
    void authors.reload();
  };

  const remove = async (author: AuthorProfile) => {
    setDeleting(true);
    setMessage(undefined);
    try {
      await kdpDelete(`/kdp/authors/${author.id}`);
      setMessage({ tone: "success", text: `Deleted ${author.penName}.` });
      void authors.reload();
    } catch (reason) {
      setMessage({ tone: "error", text: errorMessage(reason) });
    } finally {
      setDeleting(false);
      setConfirm(undefined);
    }
  };

  const items = authors.data?.items;
  return (
    <section
      className="kdp-card"
      id="pen-names"
      aria-labelledby="pen-names-title"
    >
      <header>
        <div>
          <h2 id="pen-names-title">Pen names</h2>
          <p>The public author identities your books are published under.</p>
        </div>
        <button
          type="button"
          className="button primary small"
          disabled={editing === "new"}
          onClick={() => {
            setMessage(undefined);
            setEditing("new");
          }}
        >
          <Plus size={14} /> Add pen name
        </button>
      </header>

      <div role="status" aria-live="polite">
        {message && (
          <div className={`notice ${message.tone} kdp-set-notice`}>
            <span>{message.text}</span>
          </div>
        )}
      </div>
      {authors.error && !items && (
        <div className="notice error" role="alert">
          {authors.error}
        </div>
      )}

      {editing === "new" && (
        <AuthorEditor
          initial={undefined}
          onSaved={(profile) => saved(profile, true)}
          onCancel={() => setEditing(undefined)}
        />
      )}

      {!items && !authors.error && (
        <div className="kdp-set-skeleton" aria-busy="true" />
      )}
      {items && items.length === 0 && editing !== "new" && (
        <EmptyPanel icon={<UserRound size={22} />} title="No pen names yet">
          Add one to start a book.
        </EmptyPanel>
      )}
      {items && items.length > 0 && (
        <ul className="kdp-set-authors">
          {items.map((author) =>
            editing === author.id ? (
              <li key={author.id}>
                <AuthorEditor
                  initial={author}
                  onSaved={(profile) => saved(profile, false)}
                  onCancel={() => setEditing(undefined)}
                />
              </li>
            ) : (
              <AuthorRow
                key={author.id}
                author={author}
                disabled={!!editing || deleting}
                onEdit={() => {
                  setMessage(undefined);
                  setEditing(author.id);
                }}
                onDelete={() => setConfirm(author)}
              />
            ),
          )}
        </ul>
      )}

      {confirm && (
        <ConfirmDialog
          title={`Delete ${confirm.penName}?`}
          confirmLabel="Delete pen name"
          busy={deleting}
          onCancel={() => setConfirm(undefined)}
          onConfirm={() => void remove(confirm)}
        >
          <p>
            Books must be moved to another pen name first. Published books on
            Amazon are not affected.
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}
