"use client";

import type {
  AuthorProfile,
  BookSummary,
  PointOfView,
} from "@ai-studio/contracts";
import { pointsOfView } from "@ai-studio/contracts";
import {
  craftProfiles,
  getLengthPreset,
  lengthPresets,
  lengthWarnings,
  planChapterWords,
} from "@ai-studio/book-engine";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Info,
  LoaderCircle,
  PenLine,
  RotateCcw,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

import { readableErrors } from "@/components/kdp/library/form-errors";
import {
  ChapterPreview,
  ChipGroup,
  ChoiceGroup,
  FieldError,
  LevelSlider,
  StepIndicator,
  TextField,
} from "@/components/kdp/library/wizard-fields";
import {
  buildPayload,
  chaptersOf,
  clearDraft,
  customGenreValue,
  defaultWizardForm,
  endingLabels,
  genreOf,
  genreOptions,
  hasContent,
  loadDraft,
  maxTones,
  pacingLabels,
  payloadLabels,
  povLabels,
  saveDraft,
  sensualityLabels,
  stepErrors,
  suggestedChapters,
  tenseLabels,
  toneOptions,
  withPreset,
  withWords,
  wizardSteps,
  wordsOf,
  type FieldErrors,
  type WizardForm,
} from "@/components/kdp/library/wizard-model";
import {
  errorMessage,
  formatWords,
  kdpSend,
  languageLabel,
  languageOptions,
  startJob,
  useResource,
} from "@/lib/kdp";

type Setter = <K extends keyof WizardForm>(
  key: K,
  value: WizardForm[K],
) => void;

const options = <T extends string>(labels: Record<T, string>) =>
  (Object.keys(labels) as T[]).map((value) => ({
    value,
    label: labels[value],
  }));

const lastStep = wizardSteps.length - 1;

function StepHeading({
  title,
  children,
  headingRef,
}: {
  title: string;
  children?: ReactNode;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  return (
    <header className="kdp-wiz-panel-head">
      <h2 ref={headingRef} tabIndex={-1}>
        {title}
      </h2>
      {children && <p>{children}</p>}
    </header>
  );
}

function IdeaStep({
  form,
  set,
  errors,
}: {
  form: WizardForm;
  set: Setter;
  errors: FieldErrors;
}) {
  const genreId = useId();
  return (
    <div className="field-grid">
      <TextField
        full
        required
        rows={5}
        label="Theme or idea"
        value={form.theme}
        onChange={(value) => set("theme", value)}
        maxLength={4000}
        placeholder="A night nurse notices that the same patient is admitted every Tuesday under a different name…"
        error={errors.theme}
        help={`${form.theme.length}/4,000`}
      />
      <div className="field">
        <label htmlFor={genreId} className="kdp-wiz-field-label">
          Genre <span aria-hidden="true">*</span>
        </label>
        <select
          id={genreId}
          value={form.genreChoice}
          onChange={(event) => set("genreChoice", event.target.value)}
        >
          {genreOptions.map((genre) => (
            <option key={genre} value={genre}>
              {genre}
            </option>
          ))}
          <option value={customGenreValue}>Other genre…</option>
        </select>
      </div>
      {form.genreChoice === customGenreValue && (
        <TextField
          required
          label="Your genre"
          value={form.customGenre}
          onChange={(value) => set("customGenre", value)}
          maxLength={80}
          placeholder="Folk horror"
          error={errors.customGenre}
        />
      )}
      <TextField
        label="Subgenre"
        value={form.subgenre}
        onChange={(value) => set("subgenre", value)}
        maxLength={80}
        placeholder="Unreliable narrator"
      />
      <TextField
        label="Audience"
        value={form.audience}
        onChange={(value) => set("audience", value)}
        maxLength={200}
        placeholder="Adult readers of twisty domestic suspense"
      />
      <TextField
        label="Working title"
        value={form.workingTitle}
        onChange={(value) => set("workingTitle", value)}
        maxLength={200}
        placeholder="Leave empty to decide later"
      />
      <TextField
        label="Subtitle"
        value={form.subtitle}
        onChange={(value) => set("subtitle", value)}
        maxLength={200}
      />
    </div>
  );
}

function LengthStep({
  form,
  set,
  setForm,
  errors,
}: {
  form: WizardForm;
  set: Setter;
  setForm: (update: (current: WizardForm) => WizardForm) => void;
  errors: FieldErrors;
}) {
  const wordsId = useId();
  const chaptersId = useId();
  const words = wordsOf(form);
  const validWords = words >= 300 && words <= 200_000;
  const chapters = chaptersOf(form);
  const suggested = suggestedChapters(form);
  const plan = validWords ? planChapterWords(words, chapters, form.pacing) : [];
  const warnings = validWords
    ? lengthWarnings(genreOf(form), words, chapters)
    : [];
  return (
    <div className="kdp-wiz-stack">
      <fieldset className="kdp-wiz-presets">
        <legend>Target length</legend>
        <div>
          {lengthPresets.map((preset) => {
            const selected = form.lengthPreset === preset.id;
            return (
              <label
                key={preset.id}
                className={`kdp-wiz-preset${selected ? " selected" : ""}`}
              >
                <input
                  type="radio"
                  name="length-preset"
                  checked={selected}
                  onChange={() =>
                    setForm((current) => withPreset(current, preset.id))
                  }
                />
                <strong>{preset.label}</strong>
                <small>
                  {preset.id === "custom"
                    ? "Up to 200,000 words"
                    : `${formatWords(preset.minWords)}–${formatWords(preset.maxWords)} words`}
                </small>
                {selected && <Check size={15} aria-hidden="true" />}
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="field-grid">
        <div className="field">
          <label htmlFor={wordsId} className="kdp-wiz-field-label">
            Target words <span aria-hidden="true">*</span>
          </label>
          <div className="input-suffix">
            <input
              id={wordsId}
              type="number"
              inputMode="numeric"
              min={300}
              max={200_000}
              step={500}
              required
              value={form.targetWords}
              aria-invalid={errors.targetWords ? true : undefined}
              aria-describedby={
                errors.targetWords ? `${wordsId}-error` : undefined
              }
              onChange={(event) =>
                setForm((current) => withWords(current, event.target.value))
              }
            />
            <em>words</em>
          </div>
          <FieldError id={`${wordsId}-error`} error={errors.targetWords} />
        </div>
        <div className="field">
          <label htmlFor={chaptersId} className="kdp-wiz-field-label">
            Chapters
          </label>
          <div className="kdp-wiz-inline">
            <input
              id={chaptersId}
              type="number"
              inputMode="numeric"
              min={1}
              max={150}
              value={
                form.chaptersEdited ? form.chapterCount : String(suggested)
              }
              aria-invalid={errors.chapterCount ? true : undefined}
              aria-describedby={`${chaptersId}-help`}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  chaptersEdited: true,
                  chapterCount: event.target.value,
                }))
              }
            />
            {form.chaptersEdited && (
              <button
                type="button"
                className="button ghost small"
                onClick={() => set("chaptersEdited", false)}
              >
                <RotateCcw size={13} /> Use {suggested}
              </button>
            )}
          </div>
          <small id={`${chaptersId}-help`} className="kdp-wiz-help">
            {form.chaptersEdited
              ? `Suggested for this length and pacing: ${suggested}`
              : "Suggested for this length, genre and pacing"}
            {validWords &&
              ` · about ${formatWords(Math.round(words / chapters))} words per chapter`}
          </small>
          <FieldError id={`${chaptersId}-error`} error={errors.chapterCount} />
        </div>
        <ChoiceGroup
          full
          legend="Pacing"
          value={form.pacing}
          options={options(pacingLabels)}
          onChange={(value) => set("pacing", value)}
        />
      </div>

      {plan.length > 0 && <ChapterPreview plan={plan} />}
      {warnings.map((warning) => (
        <p key={warning.message} className={`kdp-wiz-hint ${warning.level}`}>
          {warning.level === "warning" ? (
            <TriangleAlert size={15} aria-hidden="true" />
          ) : (
            <Info size={15} aria-hidden="true" />
          )}
          <span>{warning.message}</span>
        </p>
      ))}
    </div>
  );
}

function StyleStep({ form, set }: { form: WizardForm; set: Setter }) {
  const povId = useId();
  const sensualityId = useId();
  return (
    <div className="kdp-wiz-stack">
      <div className="field-grid">
        <div className="field">
          <label htmlFor={povId} className="kdp-wiz-field-label">
            Point of view
          </label>
          <select
            id={povId}
            value={form.pointOfView}
            onChange={(event) =>
              set("pointOfView", event.target.value as PointOfView)
            }
          >
            {pointsOfView.map((value) => (
              <option key={value} value={value}>
                {povLabels[value]}
              </option>
            ))}
          </select>
        </div>
        <ChoiceGroup
          legend="Tense"
          value={form.tense}
          options={options(tenseLabels)}
          onChange={(value) => set("tense", value)}
        />
        <ChipGroup
          full
          legend={`Tone (up to ${maxTones})`}
          values={form.tones}
          options={toneOptions}
          max={maxTones}
          onChange={(value) => set("tones", value)}
        />
      </div>
      <fieldset className="kdp-wiz-levels">
        <legend>Intensity</legend>
        <div>
          <LevelSlider
            label="Suspense"
            min={1}
            value={form.suspense}
            onChange={(value) => set("suspense", value)}
          />
          <LevelSlider
            label="Horror"
            min={0}
            value={form.horror}
            onChange={(value) => set("horror", value)}
          />
          <LevelSlider
            label="Romance"
            min={0}
            value={form.romance}
            onChange={(value) => set("romance", value)}
          />
          <LevelSlider
            label="Violence"
            min={0}
            value={form.violence}
            onChange={(value) => set("violence", value)}
          />
        </div>
      </fieldset>
      <div className="field-grid">
        <div className="field">
          <label htmlFor={sensualityId} className="kdp-wiz-field-label">
            Sensuality
          </label>
          <select
            id={sensualityId}
            value={form.sensuality}
            onChange={(event) =>
              set("sensuality", event.target.value as WizardForm["sensuality"])
            }
          >
            {options(sensualityLabels).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <ChoiceGroup
          legend="Ending"
          value={form.ending}
          options={options(endingLabels)}
          onChange={(value) => set("ending", value)}
        />
      </div>
    </div>
  );
}

function StoryStep({
  form,
  set,
  errors,
}: {
  form: WizardForm;
  set: Setter;
  errors: FieldErrors;
}) {
  const craftId = useId();
  const budgetId = useId();
  return (
    <div className="kdp-wiz-stack">
      <div className="field-grid">
        <TextField
          label="Setting"
          rows={3}
          value={form.setting}
          onChange={(value) => set("setting", value)}
          maxLength={1000}
          placeholder="A coastal town in Cornwall, out of season"
        />
        <TextField
          label="Time period"
          value={form.timePeriod}
          onChange={(value) => set("timePeriod", value)}
          maxLength={200}
          placeholder="Present day"
        />
        <TextField
          label="Main character"
          rows={3}
          value={form.mainCharacter}
          onChange={(value) => set("mainCharacter", value)}
          maxLength={2000}
        />
        <TextField
          label="Supporting characters"
          rows={3}
          value={form.supportingCharacters}
          onChange={(value) => set("supportingCharacters", value)}
          maxLength={4000}
        />
        <TextField
          full
          label="Central conflict"
          rows={3}
          value={form.centralConflict}
          onChange={(value) => set("centralConflict", value)}
          maxLength={2000}
        />
        <TextField
          full
          label="Special instructions"
          rows={3}
          value={form.specialInstructions}
          onChange={(value) => set("specialInstructions", value)}
          maxLength={4000}
        />
      </div>
      <details className="kdp-details kdp-wiz-advanced">
        <summary>Advanced settings</summary>
        <div className="field-grid">
          <TextField
            label="Avoid (themes, words, clichés)"
            rows={3}
            value={form.forbidden}
            onChange={(value) => set("forbidden", value)}
            maxLength={4000}
          />
          <TextField
            label="Must include"
            rows={3}
            value={form.mandatoryElements}
            onChange={(value) => set("mandatoryElements", value)}
            maxLength={4000}
          />
          <TextField
            full
            label="Reference material"
            rows={4}
            value={form.referenceMaterial}
            onChange={(value) => set("referenceMaterial", value)}
            maxLength={20_000}
            help="Research notes, facts or earlier books in the series. Only use material you have the rights to."
          />
          <TextField
            full
            label="Full custom brief"
            rows={6}
            value={form.customBrief}
            onChange={(value) => set("customBrief", value)}
            maxLength={20_000}
            help="Overrides the fields above where they conflict."
          />
          <div className="field">
            <label htmlFor={craftId} className="kdp-wiz-field-label">
              Craft profile
            </label>
            <select
              id={craftId}
              value={form.craftProfile}
              onChange={(event) => set("craftProfile", event.target.value)}
            >
              <option value="">Automatic (matches the genre)</option>
              {craftProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={budgetId} className="kdp-wiz-field-label">
              AI budget for this book
            </label>
            <div className="input-suffix">
              <input
                id={budgetId}
                type="number"
                inputMode="decimal"
                min={0}
                max={10_000}
                step={1}
                value={form.budgetUsd}
                placeholder="Studio default"
                aria-invalid={errors.budgetUsd ? true : undefined}
                aria-describedby={`${budgetId}-help`}
                onChange={(event) => set("budgetUsd", event.target.value)}
              />
              <em>USD</em>
            </div>
            <small id={`${budgetId}-help`} className="kdp-wiz-help">
              Jobs stop when the book reaches this amount.
            </small>
            <FieldError id={`${budgetId}-error`} error={errors.budgetUsd} />
          </div>
        </div>
      </details>
    </div>
  );
}

function AuthorStep({
  form,
  setForm,
  set,
  errors,
  authors,
  authorsError,
}: {
  form: WizardForm;
  setForm: (update: (current: WizardForm) => WizardForm) => void;
  set: Setter;
  errors: FieldErrors;
  authors: AuthorProfile[] | undefined;
  authorsError: string | undefined;
}) {
  const authorId = useId();
  const languageId = useId();
  const numberId = useId();
  const knownLanguage = languageOptions.some(
    (option) => option.code === form.language,
  );
  return (
    <div className="kdp-wiz-stack">
      <div className="field-grid">
        <div className="field">
          <label htmlFor={authorId} className="kdp-wiz-field-label">
            Pen name <span aria-hidden="true">*</span>
          </label>
          <select
            id={authorId}
            value={form.authorProfileId}
            disabled={!authors}
            aria-invalid={errors.authorProfileId ? true : undefined}
            aria-describedby={`${authorId}-help`}
            onChange={(event) => {
              const author = authors?.find(
                (item) => item.id === event.target.value,
              );
              setForm((current) => ({
                ...current,
                authorProfileId: event.target.value,
                language: author?.defaultLanguage ?? current.language,
              }));
            }}
          >
            {!authors && <option value="">Loading…</option>}
            {authors?.length === 0 && (
              <option value="">No pen names yet</option>
            )}
            {authors?.map((author) => (
              <option key={author.id} value={author.id}>
                {author.penName}
                {author.isDefault ? " (default)" : ""}
              </option>
            ))}
          </select>
          <small id={`${authorId}-help`} className="kdp-wiz-help">
            <Link href="/kdp/settings#pen-names">Add or edit pen names</Link>
          </small>
          <FieldError
            id={`${authorId}-error`}
            error={errors.authorProfileId ?? authorsError}
          />
        </div>
        <div className="field">
          <label htmlFor={languageId} className="kdp-wiz-field-label">
            Language <span aria-hidden="true">*</span>
          </label>
          <select
            id={languageId}
            value={form.language}
            onChange={(event) => set("language", event.target.value)}
          >
            {languageOptions.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
            {!knownLanguage && (
              <option value={form.language}>{form.language}</option>
            )}
          </select>
          <FieldError id={`${languageId}-error`} error={errors.language} />
        </div>
        <ChoiceGroup
          full
          legend="Series"
          value={form.isSeries ? "series" : "standalone"}
          options={[
            { value: "standalone", label: "Standalone" },
            { value: "series", label: "Part of a series" },
          ]}
          onChange={(value) => set("isSeries", value === "series")}
        />
        {form.isSeries && (
          <>
            <TextField
              required
              label="Series name"
              value={form.seriesName}
              onChange={(value) => set("seriesName", value)}
              maxLength={200}
              error={errors.seriesName}
            />
            <div className="field">
              <label htmlFor={numberId} className="kdp-wiz-field-label">
                Number in series
              </label>
              <input
                id={numberId}
                type="number"
                inputMode="numeric"
                min={1}
                max={999}
                value={form.seriesNumber}
                aria-invalid={errors.seriesNumber ? true : undefined}
                onChange={(event) => set("seriesNumber", event.target.value)}
              />
              <FieldError
                id={`${numberId}-error`}
                error={errors.seriesNumber}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ReviewSection({
  title,
  step,
  onEdit,
  rows,
}: {
  title: string;
  step: number;
  onEdit: (step: number) => void;
  rows: [string, ReactNode][];
}) {
  const shown = rows.filter(([, value]) => value !== null && value !== "");
  return (
    <section className="kdp-wiz-review-section">
      <header>
        <h3>{title}</h3>
        <button
          type="button"
          className="button ghost small"
          onClick={() => onEdit(step)}
          aria-label={`Edit ${title.toLowerCase()}`}
        >
          <PenLine size={13} /> Edit
        </button>
      </header>
      <dl>
        {shown.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function ReviewStep({
  form,
  authors,
  onEdit,
}: {
  form: WizardForm;
  authors: AuthorProfile[] | undefined;
  onEdit: (step: number) => void;
}) {
  const author = authors?.find((item) => item.id === form.authorProfileId);
  const craft = craftProfiles.find((item) => item.id === form.craftProfile);
  const words = wordsOf(form);
  const chapters = chaptersOf(form);
  const levels = `Suspense ${form.suspense}, horror ${form.horror}, romance ${form.romance}, violence ${form.violence}`;
  const filled = (value: string) => value.trim() || null;
  return (
    <div className="kdp-wiz-review">
      <ReviewSection
        title="Idea"
        step={0}
        onEdit={onEdit}
        rows={[
          ["Theme", form.theme.trim()],
          [
            "Genre",
            form.subgenre.trim()
              ? `${genreOf(form)} · ${form.subgenre.trim()}`
              : genreOf(form),
          ],
          ["Audience", filled(form.audience)],
          ["Working title", filled(form.workingTitle) ?? "Decide later"],
          ["Subtitle", filled(form.subtitle)],
        ]}
      />
      <ReviewSection
        title="Length"
        step={1}
        onEdit={onEdit}
        rows={[
          [
            "Target",
            `${formatWords(words)} words · ${getLengthPreset(form.lengthPreset).label}`,
          ],
          [
            "Chapters",
            `${chapters} · about ${formatWords(Math.round(words / Math.max(1, chapters)))} words each`,
          ],
          ["Pacing", pacingLabels[form.pacing]],
        ]}
      />
      <ReviewSection
        title="Style"
        step={2}
        onEdit={onEdit}
        rows={[
          [
            "Narration",
            `${povLabels[form.pointOfView]}, ${tenseLabels[form.tense].toLowerCase()} tense`,
          ],
          ["Tone", form.tones.length ? form.tones.join(", ") : null],
          ["Intensity", levels],
          ["Sensuality", sensualityLabels[form.sensuality]],
          ["Ending", endingLabels[form.ending]],
        ]}
      />
      <ReviewSection
        title="Story"
        step={3}
        onEdit={onEdit}
        rows={[
          ["Setting", filled(form.setting)],
          ["Time period", filled(form.timePeriod)],
          ["Main character", filled(form.mainCharacter)],
          ["Supporting characters", filled(form.supportingCharacters)],
          ["Central conflict", filled(form.centralConflict)],
          ["Special instructions", filled(form.specialInstructions)],
          ["Avoid", filled(form.forbidden)],
          ["Must include", filled(form.mandatoryElements)],
          [
            "Reference material",
            form.referenceMaterial.trim()
              ? `${formatWords(form.referenceMaterial.trim().length)} characters`
              : null,
          ],
          ["Custom brief", form.customBrief.trim() ? "Included" : null],
          ["Craft profile", craft?.label ?? "Automatic"],
          [
            "AI budget",
            form.budgetUsd.trim()
              ? `$${form.budgetUsd.trim()}`
              : "Studio default",
          ],
        ]}
      />
      <ReviewSection
        title="Pen name"
        step={4}
        onEdit={onEdit}
        rows={[
          ["Pen name", author?.penName ?? "Not chosen"],
          ["Language", languageLabel(form.language)],
          [
            "Series",
            form.isSeries
              ? `${form.seriesName.trim()}, book ${form.seriesNumber}`
              : "Standalone",
          ],
        ]}
      />
    </div>
  );
}

export default function NewStoryPage() {
  const router = useRouter();
  const [form, setFormState] = useState<WizardForm>(defaultWizardForm);
  const [step, setStep] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [restored, setRestored] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState<"create" | "develop">();
  const [submitErrors, setSubmitErrors] = useState<string[]>();
  const [created, setCreated] = useState<BookSummary>();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const authors = useResource<{ items: AuthorProfile[] }>("/kdp/authors");

  useEffect(() => {
    const timer = setTimeout(() => {
      const draft = loadDraft();
      if (draft && hasContent(draft.form)) {
        setFormState(draft.form);
        setStep(draft.step);
        setRestored(true);
      }
      setHydrated(true);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (hydrated) saveDraft(form, step);
  }, [form, step, hydrated]);

  const authorList = authors.data?.items;
  const fallbackAuthor =
    authorList?.find((author) => author.isDefault) ?? authorList?.[0];
  // The saved pen name may have been deleted; fall back to the default one.
  const effective: WizardForm = {
    ...form,
    authorProfileId: authorList?.some(
      (author) => author.id === form.authorProfileId,
    )
      ? form.authorProfileId
      : (fallbackAuthor?.id ?? ""),
  };

  const setForm = (update: (current: WizardForm) => WizardForm) =>
    setFormState(update);
  const set: Setter = (key, value) =>
    setFormState((current) => ({ ...current, [key]: value }));

  const errorsFor = (index: number) => stepErrors(effective, index);
  const firstInvalid = () =>
    wizardSteps.findIndex(
      (_, index) => Object.keys(errorsFor(index)).length > 0,
    );
  const canVisit = (index: number) => {
    for (let earlier = 0; earlier < index; earlier += 1) {
      if (Object.keys(errorsFor(earlier)).length > 0) return false;
    }
    return true;
  };

  const goTo = (index: number) => {
    setStep(index);
    setShowErrors(false);
    window.requestAnimationFrame(() => headingRef.current?.focus());
  };

  const focusFirstInvalid = () =>
    window.requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>('.kdp-wiz-panel [aria-invalid="true"]')
        ?.focus(),
    );

  const next = () => {
    if (Object.keys(errorsFor(step)).length > 0) {
      setShowErrors(true);
      focusFirstInvalid();
      return;
    }
    goTo(Math.min(lastStep, step + 1));
  };

  const startOver = () => {
    clearDraft();
    setFormState(defaultWizardForm);
    setRestored(false);
    setSubmitErrors(undefined);
    goTo(0);
  };

  const create = async (develop: boolean) => {
    const invalid = firstInvalid();
    if (invalid >= 0 && invalid < lastStep) {
      goTo(invalid);
      setShowErrors(true);
      focusFirstInvalid();
      return;
    }
    setBusy(develop ? "develop" : "create");
    setSubmitErrors(undefined);
    let book: BookSummary;
    try {
      book = await kdpSend<BookSummary>(
        "/kdp/books",
        "POST",
        buildPayload(effective),
      );
    } catch (reason) {
      setSubmitErrors(
        readableErrors(reason, payloadLabels, "Could not create the book."),
      );
      setBusy(undefined);
      return;
    }
    clearDraft();
    setHydrated(false);
    if (develop) {
      try {
        await startJob(book.id, { kind: "concepts" });
      } catch (reason) {
        setCreated(book);
        setSubmitErrors([
          `The book was created, but concept development did not start: ${errorMessage(reason)}`,
        ]);
        setBusy(undefined);
        return;
      }
    }
    router.push(`/kdp/books/${book.id}`);
  };

  const errors = showErrors ? errorsFor(step) : {};
  const stepId = wizardSteps[step]?.id ?? "idea";

  return (
    <div className="page kdp-page kdp-wiz-page">
      <header className="page-heading compact">
        <div>
          <span className="eyebrow">
            <Sparkles size={14} /> New story
          </span>
          <h1>Create a new story</h1>
          <p>Only the idea, genre, length and pen name are required.</p>
        </div>
      </header>

      <StepIndicator
        steps={wizardSteps}
        current={step}
        canVisit={canVisit}
        onSelect={goTo}
      />

      <div className="kdp-wiz-draft">
        <span role="status" aria-live="polite">
          {restored
            ? "Restored your unfinished story from this device."
            : hydrated && hasContent(form)
              ? "Draft saved on this device."
              : ""}
        </span>
        {hasContent(form) && !created && (
          <button
            type="button"
            className="kdp-lib-linkbutton"
            onClick={startOver}
          >
            Start over
          </button>
        )}
      </div>

      <form
        className="kdp-card kdp-wiz-panel"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (step < lastStep) next();
        }}
      >
        {stepId === "idea" && (
          <>
            <StepHeading
              title="What is the story about?"
              headingRef={headingRef}
            >
              A sentence or a page — whatever you have.
            </StepHeading>
            <IdeaStep form={form} set={set} errors={errors} />
          </>
        )}
        {stepId === "length" && (
          <>
            <StepHeading title="How long should it be?" headingRef={headingRef}>
              Chapters follow the length and pacing unless you set them.
            </StepHeading>
            <LengthStep
              form={form}
              set={set}
              setForm={setForm}
              errors={errors}
            />
          </>
        )}
        {stepId === "style" && (
          <>
            <StepHeading title="Voice and tone" headingRef={headingRef}>
              Optional. The defaults suit most thrillers.
            </StepHeading>
            <StyleStep form={form} set={set} />
          </>
        )}
        {stepId === "story" && (
          <>
            <StepHeading title="Story details" headingRef={headingRef}>
              Optional. Anything left empty is developed with the concepts.
            </StepHeading>
            <StoryStep form={form} set={set} errors={errors} />
          </>
        )}
        {stepId === "author" && (
          <>
            <StepHeading
              title="Pen name and language"
              headingRef={headingRef}
            />
            <AuthorStep
              form={effective}
              setForm={setForm}
              set={set}
              errors={errors}
              authors={authorList}
              authorsError={authors.error}
            />
          </>
        )}
        {stepId === "review" && (
          <>
            <StepHeading title="Review and create" headingRef={headingRef}>
              Everything here can still be changed later in the book.
            </StepHeading>
            <ReviewStep form={effective} authors={authorList} onEdit={goTo} />
          </>
        )}

        {showErrors && Object.keys(errors).length > 0 && (
          <p className="kdp-wiz-hint warning" role="alert">
            <TriangleAlert size={15} aria-hidden="true" />
            <span>Fix the highlighted fields to continue.</span>
          </p>
        )}

        {stepId === "review" && (
          <div className="kdp-wiz-create">
            <p className="kdp-wiz-note">
              <Info size={14} aria-hidden="true" />
              <span>
                Developing concepts uses the paid AI provider set in Settings
                and counts toward this book’s budget.
              </span>
            </p>
            {submitErrors && (
              <div className="notice error kdp-wiz-errors" role="alert">
                <TriangleAlert size={16} aria-hidden="true" />
                <div>
                  <strong>
                    {created ? "Almost there" : "Couldn’t create the book"}
                  </strong>
                  <ul>
                    {submitErrors.map((message) => (
                      <li key={message}>{message}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            {created ? (
              <div className="kdp-actions">
                <Link
                  className="button primary"
                  href={`/kdp/books/${created.id}`}
                >
                  Open the book <ArrowRight size={16} />
                </Link>
              </div>
            ) : (
              <div className="kdp-actions kdp-wiz-create-buttons">
                <button
                  type="button"
                  className="button secondary"
                  disabled={!!busy}
                  onClick={() => void create(false)}
                >
                  {busy === "create" && (
                    <LoaderCircle
                      size={15}
                      className="spin"
                      aria-hidden="true"
                    />
                  )}
                  Create only
                </button>
                <button
                  type="button"
                  className="button primary"
                  disabled={!!busy}
                  onClick={() => void create(true)}
                >
                  {busy === "develop" ? (
                    <LoaderCircle
                      size={15}
                      className="spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <Sparkles size={15} aria-hidden="true" />
                  )}
                  Create and develop 3 concepts
                </button>
              </div>
            )}
          </div>
        )}

        <div className="kdp-wiz-nav">
          {step > 0 ? (
            <button
              type="button"
              className="button secondary"
              onClick={() => goTo(step - 1)}
              disabled={!!busy}
            >
              <ArrowLeft size={16} /> Back
            </button>
          ) : (
            <Link href="/kdp" className="button secondary">
              Cancel
            </Link>
          )}
          {step < lastStep && (
            <button type="submit" className="button primary">
              {step === lastStep - 1 ? "Review" : "Next"}
              <ArrowRight size={16} />
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
