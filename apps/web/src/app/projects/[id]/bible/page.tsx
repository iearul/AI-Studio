"use client";

import type {
  Bible,
  Character,
  CharacterReferencePrompt,
  Location,
  Project,
  Prop,
  ReferenceCoverage,
  ReferenceImage,
  ReferenceView,
} from "@ai-film-studio/contracts";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Copy,
  ImagePlus,
  MapPin,
  Package,
  PencilLine,
  Plus,
  ShieldCheck,
  Sparkles,
  Upload,
  UserRound,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import {
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  Suspense,
  useEffect,
  useMemo,
  useState,
} from "react";

import { apiBaseUrl, apiFetch } from "@/lib/api";

type BibleKind = "characters" | "locations" | "props";
type BibleEntity = Character | Location | Prop;

const tabs: Array<{
  kind: BibleKind;
  label: string;
  singular: string;
  icon: typeof UserRound;
}> = [
  {
    kind: "characters",
    label: "Characters",
    singular: "character",
    icon: UserRound,
  },
  { kind: "locations", label: "Locations", singular: "location", icon: MapPin },
  { kind: "props", label: "Props", singular: "prop", icon: Package },
];

const viewsByKind: Record<BibleKind, ReferenceView[]> = {
  characters: [
    "front",
    "three-quarter",
    "profile",
    "full-body",
    "neutral",
    "expression",
    "other",
  ],
  locations: ["exterior-day", "exterior-night", "interior", "detail", "other"],
  props: ["front", "three-quarter", "profile", "detail", "other"],
};

function list(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function text(form: FormData, name: string): string {
  return String(form.get(name) ?? "").trim();
}

function entitySummary(kind: BibleKind, entity: BibleEntity): string {
  if (kind === "characters") {
    const character = entity as Character;
    return (
      character.faceDescription ||
      character.culturalAppearance ||
      character.defaultClothing.join(", ") ||
      "Add appearance and wardrobe details."
    );
  }
  if (kind === "locations") {
    const location = entity as Location;
    return (
      location.description ||
      [location.type, location.countryCulture].filter(Boolean).join(" · ") ||
      "Add architecture, materials, and atmosphere."
    );
  }
  const prop = entity as Prop;
  return (
    prop.description ||
    prop.significance ||
    "Add visual and continuity details."
  );
}

function ReferenceUploader({
  projectId,
  kind,
  entity,
  view,
  onViewChange,
  onSaved,
  onError,
}: {
  projectId: string;
  kind: BibleKind;
  entity: BibleEntity;
  view: ReferenceView;
  onViewChange: (view: ReferenceView) => void;
  onSaved: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);

  function chooseFile(candidate: File | undefined) {
    if (!candidate) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(candidate.type)) {
      onError("Use a PNG, JPEG, or WebP image.");
      return;
    }
    onError("");
    setFile(candidate);
  }

  function drop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    chooseFile(event.dataTransfer.files[0]);
  }

  function paste(event: ClipboardEvent<HTMLLabelElement>) {
    const candidate = [...event.clipboardData.items]
      .find((item) => item.kind === "file" && item.type.startsWith("image/"))
      ?.getAsFile();
    if (!candidate) {
      onError("The clipboard does not contain an image.");
      return;
    }
    event.preventDefault();
    chooseFile(candidate);
  }

  async function upload() {
    if (!file) return;
    setBusy(true);
    onError("");
    try {
      const body = new FormData();
      body.append("file", file);
      await apiFetch<ReferenceImage>(
        `/projects/${projectId}/${kind}/${entity.id}/references?view=${view}`,
        { method: "POST", body },
      );
      setFile(undefined);
      await onSaved();
    } catch (reason) {
      onError(
        reason instanceof Error
          ? reason.message
          : "The reference image could not be uploaded.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="reference-uploader">
      <select
        aria-label={`Reference view for ${entity.name}`}
        value={view}
        onChange={(event) => onViewChange(event.target.value as ReferenceView)}
      >
        {viewsByKind[kind].map((value) => (
          <option key={value} value={value}>
            {value.replaceAll("-", " ")}
          </option>
        ))}
      </select>
      <label
        className="reference-file"
        onDragOver={(event) => event.preventDefault()}
        onDrop={drop}
        onPaste={paste}
        tabIndex={0}
      >
        <ImagePlus size={15} />
        <span>{file?.name ?? "Choose, drop, or paste image"}</span>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(event) => chooseFile(event.target.files?.[0])}
        />
      </label>
      <button
        className="button reference-upload-button"
        disabled={!file || busy}
        onClick={() => void upload()}
      >
        <Upload size={14} /> {busy ? "Uploading…" : "Attach"}
      </button>
    </div>
  );
}

export default function BibleWorkspacePage() {
  return (
    <Suspense fallback={<BibleWorkspaceSkeleton />}>
      <BibleWorkspace />
    </Suspense>
  );
}

function BibleWorkspaceSkeleton() {
  return (
    <div className="page">
      <div className="project-detail-skeleton" />
    </div>
  );
}

function BibleWorkspace() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const initialKind: BibleKind =
    requestedTab === "locations" || requestedTab === "props"
      ? requestedTab
      : "characters";
  const [project, setProject] = useState<Project>();
  const [bible, setBible] = useState<Bible>();
  const [coverage, setCoverage] = useState<ReferenceCoverage>();
  const [kind, setKind] = useState<BibleKind>(initialKind);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<BibleEntity>();
  const [busy, setBusy] = useState(false);
  const [promptBusy, setPromptBusy] = useState<string>();
  const [referencePrompt, setReferencePrompt] =
    useState<CharacterReferencePrompt>();
  const [referencePromptCopied, setReferencePromptCopied] = useState(false);
  const [selectedViews, setSelectedViews] = useState<
    Record<string, ReferenceView>
  >({});
  const [error, setError] = useState("");
  const [copiedShot, setCopiedShot] = useState<string>();

  async function loadBible() {
    const [nextBible, nextCoverage] = await Promise.all([
      apiFetch<Bible>(`/projects/${id}/bible`),
      apiFetch<ReferenceCoverage>(`/projects/${id}/reference-coverage`),
    ]);
    setBible(nextBible);
    setCoverage(nextCoverage);
  }

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      apiFetch<Project>(`/projects/${id}`),
      apiFetch<Bible>(`/projects/${id}/bible`),
      apiFetch<ReferenceCoverage>(`/projects/${id}/reference-coverage`),
    ])
      .then(([nextProject, nextBible, nextCoverage]) => {
        if (cancelled) return;
        setProject(nextProject);
        setBible(nextBible);
        setCoverage(nextCoverage);
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not open the visual Bible.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const entities = useMemo(() => bible?.[kind] ?? [], [bible, kind]);
  const tab = tabs.find((item) => item.kind === kind)!;
  const TabIcon = tab.icon;

  function openCreate() {
    setEditing(undefined);
    setError("");
    setModalOpen(true);
  }

  function openEdit(entity: BibleEntity) {
    setEditing(entity);
    setError("");
    setModalOpen(true);
  }

  async function saveEntity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    let payload: Record<string, unknown>;
    if (kind === "characters") {
      const age = text(form, "age");
      payload = {
        name: text(form, "name"),
        age: age ? Number(age) : null,
        gender: text(form, "gender"),
        culturalAppearance: text(form, "culturalAppearance"),
        faceDescription: text(form, "faceDescription"),
        hair: text(form, "hair"),
        eyes: text(form, "eyes"),
        skin: text(form, "skin"),
        height: text(form, "height"),
        bodyType: text(form, "bodyType"),
        defaultClothing: list(form.get("defaultClothing")),
        alternativeClothing: list(form.get("alternativeClothing")),
        accessories: list(form.get("accessories")),
        personality: text(form, "personality"),
        voice: text(form, "voice"),
        speechStyle: text(form, "speechStyle"),
      };
    } else if (kind === "locations") {
      payload = {
        name: text(form, "name"),
        countryCulture: text(form, "countryCulture"),
        type: text(form, "type"),
        description: text(form, "description"),
        architecture: text(form, "architecture"),
        materials: list(form.get("materials")),
        furniture: list(form.get("furniture")),
        defaultLighting: text(form, "defaultLighting"),
        colorPalette: list(form.get("colorPalette")),
        nearbyEnvironment: text(form, "nearbyEnvironment"),
        periodDetails: text(form, "periodDetails"),
      };
    } else {
      payload = {
        name: text(form, "name"),
        description: text(form, "description"),
        materials: list(form.get("materials")),
        colors: list(form.get("colors")),
        significance: text(form, "significance"),
        continuityNotes: text(form, "continuityNotes"),
      };
    }

    try {
      await apiFetch(
        `/projects/${id}/${kind}${editing ? `/${editing.id}` : ""}`,
        {
          method: editing ? "PUT" : "POST",
          body: JSON.stringify(payload),
        },
      );
      await loadBible();
      setModalOpen(false);
      setEditing(undefined);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : `Could not save the ${tab.singular}.`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function copyPrompt(shotId: string, prompt: string) {
    await navigator.clipboard.writeText(prompt);
    setCopiedShot(shotId);
    window.setTimeout(() => setCopiedShot(undefined), 1500);
  }

  async function openCharacterPrompt(
    character: Character,
    view: ReferenceView,
  ) {
    setPromptBusy(character.id);
    setError("");
    try {
      const result = await apiFetch<CharacterReferencePrompt>(
        `/projects/${id}/characters/${character.id}/reference-prompt?view=${encodeURIComponent(view)}`,
      );
      setReferencePromptCopied(false);
      setReferencePrompt(result);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not prepare the character reference prompt.",
      );
    } finally {
      setPromptBusy(undefined);
    }
  }

  async function copyCharacterPrompt() {
    if (!referencePrompt) return;
    try {
      await navigator.clipboard.writeText(referencePrompt.prompt);
      setReferencePromptCopied(true);
      window.setTimeout(() => setReferencePromptCopied(false), 1500);
    } catch {
      setError(
        "The prompt could not be copied. Select the prompt text and copy it manually.",
      );
    }
  }

  if (!project || !bible || !coverage) {
    return (
      <div className="page">
        {error ? (
          <div className="notice error">
            <strong>Visual Bible unavailable</strong>
            <span>{error}</span>
          </div>
        ) : (
          <div className="project-detail-skeleton" />
        )}
      </div>
    );
  }

  return (
    <div className="page bible-page">
      <Link className="back-link" href={`/projects/${project.id}`}>
        <ArrowLeft size={16} /> {project.title}
      </Link>
      <header className="bible-heading">
        <div>
          <span className="eyebrow">
            <ShieldCheck size={14} /> Continuity system
          </span>
          <h1>Visual Bible</h1>
          <p>
            Define identity once. Every matching shot inherits the same visual
            facts and reference images automatically.
          </p>
        </div>
        <div className="coverage-badge">
          <strong>
            {coverage.totals.ready}/{coverage.totals.shots}
          </strong>
          <span>shots resolved</span>
        </div>
      </header>

      {error && (
        <div className="notice error bible-notice">
          <span>{error}</span>
        </div>
      )}

      <section className="bible-workspace">
        <div
          className="bible-tabs"
          role="tablist"
          aria-label="Visual Bible sections"
        >
          {tabs.map(({ kind: value, label, icon: Icon }) => (
            <button
              role="tab"
              aria-selected={kind === value}
              className={kind === value ? "active" : ""}
              key={value}
              onClick={() => {
                setKind(value);
                setError("");
              }}
            >
              <Icon size={16} /> {label}
              <span>{bible[value].length}</span>
            </button>
          ))}
        </div>
        <div className="bible-section-heading">
          <div>
            <h2>{tab.label}</h2>
            <p>
              Stable IDs, structured details, and local reference images remain
              portable with the project.
            </p>
          </div>
          <button className="button primary" onClick={openCreate}>
            <Plus size={16} /> Add {tab.singular}
          </button>
        </div>

        {entities.length === 0 ? (
          <div className="bible-empty">
            <span>
              <TabIcon size={24} />
            </span>
            <h3>No {tab.label.toLowerCase()} yet</h3>
            <p>
              Use the exact name already present in the shot plan to resolve it
              automatically.
            </p>
            <button className="button secondary" onClick={openCreate}>
              Create the first {tab.singular}
            </button>
          </div>
        ) : (
          <div className="bible-card-grid">
            {entities.map((entity) => {
              const selectedView =
                selectedViews[entity.id] ?? viewsByKind[kind][0]!;
              return (
                <article className="bible-card" key={entity.id}>
                  <header>
                    <span className="entity-code">{entity.code}</span>
                    <button
                      className="icon-button"
                      aria-label={`Edit ${entity.name}`}
                      onClick={() => openEdit(entity)}
                    >
                      <PencilLine size={15} />
                    </button>
                  </header>
                  <h3>{entity.name}</h3>
                  <p>{entitySummary(kind, entity)}</p>
                  {kind === "characters" && (
                    <button
                      className="button secondary character-prompt-button"
                      disabled={Boolean(promptBusy)}
                      onClick={() =>
                        void openCharacterPrompt(
                          entity as Character,
                          selectedView,
                        )
                      }
                    >
                      {promptBusy === entity.id ? (
                        "Preparing…"
                      ) : (
                        <>
                          <Sparkles size={14} /> Prompt for{" "}
                          {selectedView.replaceAll("-", " ")}
                        </>
                      )}
                    </button>
                  )}
                  {entity.references.length > 0 ? (
                    <div className="reference-grid">
                      {entity.references.map((reference) => (
                        <figure key={reference.id}>
                          <Image
                            unoptimized
                            src={`${apiBaseUrl}/projects/${project.id}/references/${reference.id}/content`}
                            alt={`${entity.name} ${reference.view} reference`}
                            width={112}
                            height={82}
                          />
                          <figcaption>
                            {reference.view.replaceAll("-", " ")}
                          </figcaption>
                        </figure>
                      ))}
                    </div>
                  ) : (
                    <div className="reference-placeholder">
                      <ImagePlus size={17} /> No image references yet
                    </div>
                  )}
                  <ReferenceUploader
                    projectId={project.id}
                    kind={kind}
                    entity={entity}
                    view={selectedView}
                    onViewChange={(view) =>
                      setSelectedViews((current) => ({
                        ...current,
                        [entity.id]: view,
                      }))
                    }
                    onSaved={loadBible}
                    onError={setError}
                  />
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="coverage-panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">
              <Sparkles size={14} /> Automatic inheritance
            </span>
            <h2>Shot reference coverage</h2>
            <p>
              Names and stable IDs resolve deterministically. Missing records
              are surfaced; the system never guesses.
            </p>
          </div>
          <div className="coverage-totals">
            <span>{coverage.totals.unresolved} unresolved</span>
            <span>{coverage.totals.withoutImages} images pending</span>
          </div>
        </div>
        {coverage.shots.length === 0 ? (
          <div className="coverage-empty">
            Build the story plan first to see per-shot continuity coverage.
          </div>
        ) : (
          <div className="coverage-list">
            {coverage.shots.map((shot) => (
              <details
                className={shot.ready ? "coverage-shot ready" : "coverage-shot"}
                key={shot.shotId}
              >
                <summary>
                  <span className="coverage-status">
                    {shot.ready ? <CheckCircle2 size={18} /> : <X size={18} />}
                  </span>
                  <strong>{shot.shotCode}</strong>
                  <span>
                    {shot.ready
                      ? `${shot.characters.length} character · ${shot.location ? "location matched" : "no location"}`
                      : shot.unresolved.map((item) => item.value).join(", ")}
                  </span>
                  <i>{shot.ready ? "Resolved" : "Needs Bible record"}</i>
                </summary>
                <div className="coverage-details">
                  {shot.warnings.length > 0 && (
                    <div className="coverage-warnings">
                      {shot.warnings.map((warning) => (
                        <span key={warning}>{warning}</span>
                      ))}
                    </div>
                  )}
                  <pre>{shot.prompt}</pre>
                  <button
                    className="button secondary copy-prompt"
                    onClick={() => void copyPrompt(shot.shotId, shot.prompt)}
                  >
                    {copiedShot === shot.shotId ? (
                      <Check size={15} />
                    ) : (
                      <Copy size={15} />
                    )}
                    {copiedShot === shot.shotId ? "Copied" : "Copy prompt"}
                  </button>
                </div>
              </details>
            ))}
          </div>
        )}
      </section>

      {modalOpen && (
        <div className="modal-backdrop" role="presentation">
          <section
            className="story-modal bible-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bible-modal-title"
          >
            <header>
              <span className="settings-icon">
                <TabIcon size={19} />
              </span>
              <div>
                <h2 id="bible-modal-title">
                  {editing ? "Edit" : "Add"} {tab.singular}
                </h2>
                <p>
                  Use the exact screenplay name. Comma-separate list fields.
                </p>
              </div>
              <button
                className="icon-button"
                aria-label="Close"
                onClick={() => setModalOpen(false)}
              >
                <X size={19} />
              </button>
            </header>
            {error && (
              <div className="notice error">
                <span>{error}</span>
              </div>
            )}
            <EntityForm
              kind={kind}
              entity={editing}
              busy={busy}
              onSubmit={saveEntity}
            />
          </section>
        </div>
      )}

      {referencePrompt && (
        <div className="modal-backdrop" role="presentation">
          <section
            className="story-modal reference-prompt-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reference-prompt-title"
          >
            <header>
              <span className="settings-icon">
                <Sparkles size={19} />
              </span>
              <div>
                <h2 id="reference-prompt-title">Character reference prompt</h2>
                <p>
                  Copy this into ChatGPT or Gemini image creation, then attach
                  the result as the {referencePrompt.view.replaceAll("-", " ")}{" "}
                  view.
                </p>
              </div>
              <button
                className="icon-button"
                aria-label="Close character reference prompt"
                onClick={() => setReferencePrompt(undefined)}
              >
                <X size={19} />
              </button>
            </header>

            {!referencePrompt.ready && (
              <div className="notice warning reference-prompt-warning">
                <span>
                  Better consistency needs:{" "}
                  {referencePrompt.missingDetails.join(", ")}. You can still use
                  this prompt; ChatGPT will choose the missing details and the
                  uploaded image becomes their source of truth.
                </span>
              </div>
            )}

            <ol className="reference-prompt-steps">
              <li>Copy the detailed prompt.</li>
              <li>Create one image in ChatGPT or Gemini.</li>
              <li>
                Close this window, choose the same{" "}
                {referencePrompt.view.replaceAll("-", " ")} view, then drop or
                paste the image into its card.
              </li>
            </ol>

            <textarea
              className="reference-prompt-text"
              aria-label="Character reference prompt text"
              readOnly
              value={referencePrompt.prompt}
            />

            <footer className="reference-prompt-footer">
              <span>Suggested filename: {referencePrompt.filename}</span>
              <button
                className="button primary"
                onClick={() => void copyCharacterPrompt()}
              >
                {referencePromptCopied ? (
                  <Check size={15} />
                ) : (
                  <Copy size={15} />
                )}
                {referencePromptCopied ? "Copied" : "Copy image prompt"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}

function EntityForm({
  kind,
  entity,
  busy,
  onSubmit,
}: {
  kind: BibleKind;
  entity?: BibleEntity;
  busy: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  const character =
    kind === "characters" ? (entity as Character | undefined) : undefined;
  const location =
    kind === "locations" ? (entity as Location | undefined) : undefined;
  const prop = kind === "props" ? (entity as Prop | undefined) : undefined;
  return (
    <form className="bible-form" onSubmit={(event) => void onSubmit(event)}>
      <label className="field full">
        <span>Name *</span>
        <input name="name" required minLength={2} defaultValue={entity?.name} />
      </label>
      {kind === "characters" && (
        <>
          <label className="field">
            <span>Age</span>
            <input
              name="age"
              type="number"
              min="0"
              max="150"
              defaultValue={character?.age ?? ""}
            />
          </label>
          <label className="field">
            <span>Gender</span>
            <input name="gender" defaultValue={character?.gender} />
          </label>
          <label className="field full">
            <span>Cultural appearance</span>
            <input
              name="culturalAppearance"
              defaultValue={character?.culturalAppearance}
            />
          </label>
          <label className="field full">
            <span>Face description</span>
            <textarea
              name="faceDescription"
              defaultValue={character?.faceDescription}
            />
          </label>
          <label className="field">
            <span>Hair</span>
            <input name="hair" defaultValue={character?.hair} />
          </label>
          <label className="field">
            <span>Eyes</span>
            <input name="eyes" defaultValue={character?.eyes} />
          </label>
          <label className="field">
            <span>Skin</span>
            <input name="skin" defaultValue={character?.skin} />
          </label>
          <label className="field">
            <span>Height</span>
            <input name="height" defaultValue={character?.height} />
          </label>
          <label className="field">
            <span>Body type</span>
            <input name="bodyType" defaultValue={character?.bodyType} />
          </label>
          <label className="field full">
            <span>Default clothing</span>
            <input
              name="defaultClothing"
              defaultValue={character?.defaultClothing.join(", ")}
            />
          </label>
          <label className="field full">
            <span>Alternative clothing</span>
            <input
              name="alternativeClothing"
              defaultValue={character?.alternativeClothing.join(", ")}
            />
          </label>
          <label className="field full">
            <span>Accessories</span>
            <input
              name="accessories"
              defaultValue={character?.accessories.join(", ")}
            />
          </label>
          <label className="field full">
            <span>Personality</span>
            <textarea
              name="personality"
              defaultValue={character?.personality}
            />
          </label>
          <label className="field">
            <span>Voice</span>
            <input name="voice" defaultValue={character?.voice} />
          </label>
          <label className="field">
            <span>Speech style</span>
            <input name="speechStyle" defaultValue={character?.speechStyle} />
          </label>
        </>
      )}
      {kind === "locations" && (
        <>
          <label className="field">
            <span>Location type</span>
            <input name="type" defaultValue={location?.type} />
          </label>
          <label className="field">
            <span>Country / culture</span>
            <input
              name="countryCulture"
              defaultValue={location?.countryCulture}
            />
          </label>
          <label className="field full">
            <span>Description</span>
            <textarea name="description" defaultValue={location?.description} />
          </label>
          <label className="field full">
            <span>Architecture</span>
            <input name="architecture" defaultValue={location?.architecture} />
          </label>
          <label className="field">
            <span>Materials</span>
            <input
              name="materials"
              defaultValue={location?.materials.join(", ")}
            />
          </label>
          <label className="field">
            <span>Furniture</span>
            <input
              name="furniture"
              defaultValue={location?.furniture.join(", ")}
            />
          </label>
          <label className="field full">
            <span>Default lighting</span>
            <input
              name="defaultLighting"
              defaultValue={location?.defaultLighting}
            />
          </label>
          <label className="field full">
            <span>Color palette</span>
            <input
              name="colorPalette"
              defaultValue={location?.colorPalette.join(", ")}
            />
          </label>
          <label className="field full">
            <span>Nearby environment</span>
            <textarea
              name="nearbyEnvironment"
              defaultValue={location?.nearbyEnvironment}
            />
          </label>
          <label className="field full">
            <span>Period details</span>
            <textarea
              name="periodDetails"
              defaultValue={location?.periodDetails}
            />
          </label>
        </>
      )}
      {kind === "props" && (
        <>
          <label className="field full">
            <span>Description</span>
            <textarea name="description" defaultValue={prop?.description} />
          </label>
          <label className="field">
            <span>Materials</span>
            <input name="materials" defaultValue={prop?.materials.join(", ")} />
          </label>
          <label className="field">
            <span>Colors</span>
            <input name="colors" defaultValue={prop?.colors.join(", ")} />
          </label>
          <label className="field full">
            <span>Story significance</span>
            <textarea name="significance" defaultValue={prop?.significance} />
          </label>
          <label className="field full">
            <span>Continuity notes</span>
            <textarea
              name="continuityNotes"
              defaultValue={prop?.continuityNotes}
            />
          </label>
        </>
      )}
      <footer>
        <span>Saved records update the portable manifest.</span>
        <button className="button primary" disabled={busy} type="submit">
          {busy ? "Saving…" : entity ? "Save changes" : "Create record"}
        </button>
      </footer>
    </form>
  );
}
