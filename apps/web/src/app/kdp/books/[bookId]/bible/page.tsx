"use client";

import type {
  BibleCharacter,
  CanonChange,
  Clue,
  StoryBible,
  StoryBibleRecord,
} from "@ai-studio/contracts";
import { clueKinds, clueStatuses } from "@ai-studio/contracts";
import { History, Plus, Save, Trash2, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import { useBook } from "@/components/kdp/book-context";
import { EmptyPanel, Pill } from "@/components/kdp/kdp-ui";
import {
  errorMessage,
  formatDateTime,
  kdpPath,
  kdpSend,
  useResource,
} from "@/lib/kdp";

type BibleResponse = {
  record: StoryBibleRecord | null;
  versions: Array<{
    version: number;
    updatedBy: string;
    note: string | null;
    createdAt: string;
  }>;
  canonChanges: CanonChange[];
};

const tabs = [
  "Overview",
  "Characters",
  "Places & objects",
  "Timeline",
  "Clues & payoffs",
  "Canon",
  "History",
] as const;
type Tab = (typeof tabs)[number];

const newId = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).slice(2, 10)}`;

/** Drops the blank lines list editors keep while typing. */
function clean<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .filter((item) => typeof item !== "string" || item.trim().length > 0)
      .map((item: unknown) => clean(item)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, clean(item)]),
    ) as T;
  }
  return value;
}

function Text({
  label,
  value,
  onChange,
  rows = 2,
}: {
  label: string;
  value: string | null;
  onChange: (value: string) => void;
  rows?: number;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {rows === 1 ? (
        <input
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <textarea
          rows={rows}
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </label>
  );
}

function Lines({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
}) {
  return (
    <label className="field">
      <span>{label} (one per line)</span>
      <textarea
        rows={Math.min(8, Math.max(3, value.length + 1))}
        value={value.join("\n")}
        onChange={(event) =>
          onChange(
            event.target.value
              .split("\n")
              .filter(
                (line, index, all) => line.trim() || index === all.length - 1,
              ),
          )
        }
      />
    </label>
  );
}

function EntityCard({
  title,
  onRemove,
  children,
}: {
  title: string;
  onRemove: () => void;
  children: ReactNode;
}) {
  return (
    <details className="kdp-entity" open={false}>
      <summary>
        <strong>{title || "Untitled"}</strong>
      </summary>
      <div className="kdp-entity-body">
        {children}
        <button
          type="button"
          className="button danger small"
          onClick={onRemove}
        >
          <Trash2 size={14} /> Remove
        </button>
      </div>
    </details>
  );
}

function CharacterEditor({
  character,
  onChange,
}: {
  character: BibleCharacter;
  onChange: (value: BibleCharacter) => void;
}) {
  const set = <K extends keyof BibleCharacter>(
    key: K,
    value: BibleCharacter[K],
  ) => onChange({ ...character, [key]: value });
  return (
    <>
      <div className="field-grid">
        <Text
          label="Name"
          rows={1}
          value={character.name}
          onChange={(value) => set("name", value)}
        />
        <Text
          label="Role"
          rows={1}
          value={character.role}
          onChange={(value) => set("role", value)}
        />
        <Text
          label="Age"
          rows={1}
          value={character.age}
          onChange={(value) => set("age", value || null)}
        />
        <Text
          label="Speech pattern"
          rows={1}
          value={character.speechPattern}
          onChange={(value) => set("speechPattern", value)}
        />
      </div>
      <Text
        label="Description"
        value={character.description}
        onChange={(value) => set("description", value)}
        rows={3}
      />
      <Text
        label="Physical details"
        value={character.physicalDetails}
        onChange={(value) => set("physicalDetails", value || null)}
      />
      <div className="field-grid">
        <Text
          label="Motivation"
          value={character.motivation}
          onChange={(value) => set("motivation", value)}
        />
        <Text
          label="Goal"
          value={character.goal}
          onChange={(value) => set("goal", value)}
        />
        <Text
          label="Fear"
          value={character.fear}
          onChange={(value) => set("fear", value)}
        />
        <Text
          label="Secret"
          value={character.secret}
          onChange={(value) => set("secret", value || null)}
        />
      </div>
      <Text
        label="Arc"
        value={character.arc}
        onChange={(value) => set("arc", value)}
      />
      <Text
        label="Current state (updated after each chapter)"
        value={character.state}
        onChange={(value) => set("state", value || null)}
      />
      <Lines
        label="Relationships as “Name: relation”"
        value={character.relationships.map(
          (item) => `${item.with}: ${item.relation}`,
        )}
        onChange={(lines) =>
          set(
            "relationships",
            lines
              .filter((line) => line.includes(":"))
              .map((line) => {
                const [name, ...rest] = line.split(":");
                return {
                  with: name!.trim(),
                  relation: rest.join(":").trim() || "—",
                };
              }),
          )
        }
      />
    </>
  );
}

export default function BiblePage() {
  const { bookId, settledVersion, activeJobs } = useBook();
  const resource = useResource<BibleResponse>(kdpPath(bookId, "/bible"));
  const [draft, setDraft] = useState<StoryBible>();
  const [baseVersion, setBaseVersion] = useState<number>();
  const [tab, setTab] = useState<Tab>("Overview");
  const [status, setStatus] = useState<{
    kind: "idle" | "saving" | "saved" | "error";
    message?: string;
  }>({ kind: "idle" });
  const dirty =
    draft !== undefined &&
    resource.data?.record !== undefined &&
    JSON.stringify(draft) !== JSON.stringify(resource.data.record?.bible);

  const record = resource.data?.record ?? null;
  // Adopt the server copy when nothing local is pending.
  const [adoptedVersion, setAdoptedVersion] = useState<number>();
  if (record && record.version !== adoptedVersion && !dirty) {
    setAdoptedVersion(record.version);
    setDraft(structuredClone(record.bible));
    setBaseVersion(record.version);
  }

  const reload = resource.reload;
  useEffect(() => {
    if (settledVersion === 0) return;
    const timer = setTimeout(() => void reload(), 0);
    return () => clearTimeout(timer);
  }, [settledVersion, reload]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  if (resource.loading) return <div className="kdp-card" aria-busy="true" />;
  if (!record || !draft) {
    return (
      <EmptyPanel
        icon={<Users size={22} />}
        title="No story bible yet"
        action={
          <Link className="button primary" href={`/kdp/books/${bookId}#bible`}>
            Go to Story Blueprint
          </Link>
        }
      >
        Choose a concept and build the story bible on the Story Blueprint page.
      </EmptyPanel>
    );
  }

  const update = (patch: Partial<StoryBible>) =>
    setDraft({ ...draft, ...patch });
  const save = () => {
    setStatus({ kind: "saving" });
    kdpSend<StoryBibleRecord>(kdpPath(bookId, "/bible"), "PUT", {
      baseVersion,
      bible: clean(draft),
    })
      .then(async (saved) => {
        setBaseVersion(saved.version);
        setAdoptedVersion(saved.version);
        setDraft(structuredClone(saved.bible));
        await reload();
        setStatus({
          kind: "saved",
          message: `Saved as version ${saved.version}`,
        });
      })
      .catch((reason: unknown) =>
        setStatus({ kind: "error", message: errorMessage(reason) }),
      );
  };
  const discard = () => {
    setDraft(structuredClone(record.bible));
    setBaseVersion(record.version);
    setStatus({ kind: "idle" });
  };
  const inspectionRunning = activeJobs.some((job) => job.kind === "draft");

  return (
    <div className="kdp-bible">
      <div className="kdp-bible-bar">
        <div
          className="segmented kdp-bible-tabs"
          role="tablist"
          aria-label="Story bible sections"
        >
          {tabs.map((name) => (
            <button
              key={name}
              role="tab"
              aria-selected={tab === name}
              className={tab === name ? "selected" : ""}
              onClick={() => setTab(name)}
            >
              {name}
            </button>
          ))}
        </div>
        <div className="kdp-actions">
          <span
            className={`kdp-saved${status.kind === "error" ? " error" : dirty ? " dirty" : ""}`}
            aria-live="polite"
          >
            {status.kind === "saving"
              ? "Saving…"
              : status.kind === "error"
                ? status.message
                : dirty
                  ? "Unsaved changes"
                  : (status.message ??
                    `Version ${record.version} · ${formatDateTime(record.updatedAt)}`)}
          </span>
          {dirty && (
            <button
              type="button"
              className="button ghost small"
              onClick={discard}
            >
              Discard
            </button>
          )}
          <button
            type="button"
            className="button primary small"
            disabled={!dirty || status.kind === "saving"}
            onClick={save}
          >
            <Save size={14} /> Save bible
          </button>
        </div>
      </div>
      {inspectionRunning && dirty && (
        <p className="notice error">
          Chapters are being inspected and may update the bible. Save soon, or
          reload after the job finishes.
        </p>
      )}

      {tab === "Overview" && (
        <section className="kdp-card">
          <Text
            label="Premise"
            value={draft.premise}
            rows={3}
            onChange={(value) => update({ premise: value })}
          />
          <Text
            label="Theme"
            value={draft.theme}
            onChange={(value) => update({ theme: value })}
          />
          <Text
            label="Viewpoint rules"
            value={draft.viewpointRules}
            onChange={(value) => update({ viewpointRules: value })}
          />
          <Text
            label="Ending resolution"
            value={draft.endingResolution}
            rows={3}
            onChange={(value) => update({ endingResolution: value })}
          />
          <div className="kdp-grid-2">
            <Lines
              label="Setting rules"
              value={draft.settingRules}
              onChange={(value) => update({ settingRules: value })}
            />
            <Lines
              label="Major events"
              value={draft.majorEvents}
              onChange={(value) => update({ majorEvents: value })}
            />
            <Lines
              label="Plot constraints"
              value={draft.plotConstraints}
              onChange={(value) => update({ plotConstraints: value })}
            />
            <Lines
              label="Unresolved story questions"
              value={draft.unresolvedQuestions}
              onChange={(value) => update({ unresolvedQuestions: value })}
            />
          </div>
          <h3 className="kdp-subhead">Tone and prose style</h3>
          <Text
            label="Narrative voice"
            value={draft.styleGuide.narrativeVoice}
            rows={3}
            onChange={(value) =>
              update({
                styleGuide: { ...draft.styleGuide, narrativeVoice: value },
              })
            }
          />
          <div className="kdp-grid-3">
            <Lines
              label="Prose rules"
              value={draft.styleGuide.proseRules}
              onChange={(value) =>
                update({
                  styleGuide: { ...draft.styleGuide, proseRules: value },
                })
              }
            />
            <Lines
              label="Dialogue rules"
              value={draft.styleGuide.dialogueRules}
              onChange={(value) =>
                update({
                  styleGuide: { ...draft.styleGuide, dialogueRules: value },
                })
              }
            />
            <Lines
              label="Avoid"
              value={draft.styleGuide.avoid}
              onChange={(value) =>
                update({ styleGuide: { ...draft.styleGuide, avoid: value } })
              }
            />
          </div>
        </section>
      )}

      {tab === "Characters" && (
        <section className="kdp-card">
          <header>
            <div>
              <h2>Characters</h2>
              <p>
                Motivations, fears, goals, secrets and relationships. Writers
                receive the characters in each chapter.
              </p>
            </div>
            <button
              type="button"
              className="button secondary small"
              onClick={() =>
                update({
                  characters: [
                    ...draft.characters,
                    {
                      id: newId("char"),
                      name: "New character",
                      role: "supporting",
                      age: null,
                      description: "Who they are.",
                      physicalDetails: null,
                      motivation: "What drives them.",
                      fear: "What they fear.",
                      goal: "What they want.",
                      secret: null,
                      arc: "How they change.",
                      speechPattern: "How they talk.",
                      relationships: [],
                      state: null,
                    },
                  ],
                })
              }
            >
              <Plus size={14} /> Add character
            </button>
          </header>
          {draft.characters.map((character, index) => (
            <EntityCard
              key={character.id}
              title={`${character.name} · ${character.role}`}
              onRemove={() =>
                update({
                  characters: draft.characters.filter(
                    (_, position) => position !== index,
                  ),
                })
              }
            >
              <CharacterEditor
                character={character}
                onChange={(value) =>
                  update({
                    characters: draft.characters.map((item, position) =>
                      position === index ? value : item,
                    ),
                  })
                }
              />
            </EntityCard>
          ))}
        </section>
      )}

      {tab === "Places & objects" && (
        <div className="kdp-grid-2">
          {(["locations", "objects"] as const).map((key) => (
            <section className="kdp-card" key={key}>
              <header>
                <h2>
                  {key === "locations"
                    ? "Important locations"
                    : "Important objects"}
                </h2>
                <button
                  type="button"
                  className="button secondary small"
                  onClick={() =>
                    update({
                      [key]: [
                        ...draft[key],
                        {
                          id: newId(key === "locations" ? "loc" : "obj"),
                          name: "New entry",
                          description: "Description.",
                          significance: "Why it matters.",
                        },
                      ],
                    } as Partial<StoryBible>)
                  }
                >
                  <Plus size={14} /> Add
                </button>
              </header>
              {draft[key].map((item, index) => (
                <EntityCard
                  key={item.id}
                  title={item.name}
                  onRemove={() =>
                    update({
                      [key]: draft[key].filter(
                        (_, position) => position !== index,
                      ),
                    } as Partial<StoryBible>)
                  }
                >
                  {(["name", "description", "significance"] as const).map(
                    (field) => (
                      <Text
                        key={field}
                        label={field[0]!.toUpperCase() + field.slice(1)}
                        rows={field === "name" ? 1 : 2}
                        value={item[field]}
                        onChange={(value) =>
                          update({
                            [key]: draft[key].map((entry, position) =>
                              position === index
                                ? { ...entry, [field]: value }
                                : entry,
                            ),
                          } as Partial<StoryBible>)
                        }
                      />
                    ),
                  )}
                </EntityCard>
              ))}
            </section>
          ))}
        </div>
      )}

      {tab === "Timeline" && (
        <section className="kdp-card">
          <header>
            <div>
              <h2>Chronology</h2>
              <p>
                Story events in order. Events marked hidden are the truth the
                reader learns later.
              </p>
            </div>
            <button
              type="button"
              className="button secondary small"
              onClick={() =>
                update({
                  chronology: [
                    ...draft.chronology,
                    {
                      id: newId("evt"),
                      when: "When",
                      event: "What happens",
                      characters: [],
                      hiddenFromReader: false,
                      chapterNumber: null,
                    },
                  ],
                })
              }
            >
              <Plus size={14} /> Add event
            </button>
          </header>
          <div className="kdp-table-wrap">
            <table className="kdp-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Event</th>
                  <th>Chapter</th>
                  <th>Hidden</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {draft.chronology.map((event, index) => {
                  const set = (patch: Partial<typeof event>) =>
                    update({
                      chronology: draft.chronology.map((item, position) =>
                        position === index ? { ...item, ...patch } : item,
                      ),
                    });
                  return (
                    <tr key={event.id}>
                      <td>
                        <input
                          aria-label="When"
                          value={event.when}
                          onChange={(change) =>
                            set({ when: change.target.value })
                          }
                        />
                      </td>
                      <td>
                        <textarea
                          aria-label="Event"
                          rows={2}
                          value={event.event}
                          onChange={(change) =>
                            set({ event: change.target.value })
                          }
                        />
                      </td>
                      <td>
                        <input
                          aria-label="Chapter"
                          type="number"
                          min={1}
                          value={event.chapterNumber ?? ""}
                          onChange={(change) =>
                            set({
                              chapterNumber: change.target.value
                                ? Number(change.target.value)
                                : null,
                            })
                          }
                        />
                      </td>
                      <td>
                        <input
                          aria-label="Hidden from the reader"
                          type="checkbox"
                          checked={event.hiddenFromReader}
                          onChange={(change) =>
                            set({ hiddenFromReader: change.target.checked })
                          }
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label="Remove event"
                          onClick={() =>
                            update({
                              chronology: draft.chronology.filter(
                                (_, position) => position !== index,
                              ),
                            })
                          }
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "Clues & payoffs" && (
        <section className="kdp-card">
          <header>
            <div>
              <h2>Clues, foreshadowing and payoffs</h2>
              <p>Status is updated as chapters plant and pay off each entry.</p>
            </div>
            <button
              type="button"
              className="button secondary small"
              onClick={() =>
                update({
                  clues: [
                    ...draft.clues,
                    {
                      id: newId("clue"),
                      kind: "clue",
                      description: "What the reader sees",
                      payoff: "What it means later",
                      plantChapter: null,
                      payoffChapter: null,
                      status: "planned",
                      notes: null,
                    },
                  ],
                })
              }
            >
              <Plus size={14} /> Add clue
            </button>
          </header>
          {draft.clues.map((clue, index) => {
            const set = (patch: Partial<Clue>) =>
              update({
                clues: draft.clues.map((item, position) =>
                  position === index ? { ...item, ...patch } : item,
                ),
              });
            return (
              <EntityCard
                key={clue.id}
                title={`${clue.kind}: ${clue.description}`}
                onRemove={() =>
                  update({
                    clues: draft.clues.filter(
                      (_, position) => position !== index,
                    ),
                  })
                }
              >
                <div className="field-grid">
                  <label className="field">
                    <span>Kind</span>
                    <select
                      value={clue.kind}
                      onChange={(event) =>
                        set({ kind: event.target.value as Clue["kind"] })
                      }
                    >
                      {clueKinds.map((kind) => (
                        <option key={kind}>{kind}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Status</span>
                    <select
                      value={clue.status}
                      onChange={(event) =>
                        set({ status: event.target.value as Clue["status"] })
                      }
                    >
                      {clueStatuses.map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Planted in chapter</span>
                    <input
                      type="number"
                      min={1}
                      value={clue.plantChapter ?? ""}
                      onChange={(event) =>
                        set({
                          plantChapter: event.target.value
                            ? Number(event.target.value)
                            : null,
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Paid off in chapter</span>
                    <input
                      type="number"
                      min={1}
                      value={clue.payoffChapter ?? ""}
                      onChange={(event) =>
                        set({
                          payoffChapter: event.target.value
                            ? Number(event.target.value)
                            : null,
                        })
                      }
                    />
                  </label>
                </div>
                <Text
                  label="Description"
                  value={clue.description}
                  onChange={(value) => set({ description: value })}
                />
                <Text
                  label="Payoff"
                  value={clue.payoff}
                  onChange={(value) => set({ payoff: value })}
                />
                <Text
                  label="Notes"
                  value={clue.notes}
                  onChange={(value) => set({ notes: value || null })}
                />
              </EntityCard>
            );
          })}
        </section>
      )}

      {tab === "Canon" && (
        <div className="kdp-grid-2">
          <section className="kdp-card">
            <header>
              <div>
                <h2>Established facts</h2>
                <p>
                  Recorded from each drafted chapter. Writers must not
                  contradict them.
                </p>
              </div>
            </header>
            {draft.canonFacts.length === 0 && (
              <p className="kdp-muted">
                Facts appear after chapters are drafted and inspected.
              </p>
            )}
            <ul className="kdp-facts">
              {draft.canonFacts.map((fact, index) => (
                <li key={fact.id}>
                  <span>
                    {fact.chapterNumber ? `Ch. ${fact.chapterNumber}` : "—"}
                  </span>
                  <input
                    aria-label="Fact"
                    value={fact.fact}
                    onChange={(event) =>
                      update({
                        canonFacts: draft.canonFacts.map((item, position) =>
                          position === index
                            ? { ...item, fact: event.target.value }
                            : item,
                        ),
                      })
                    }
                  />
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Remove fact"
                    onClick={() =>
                      update({
                        canonFacts: draft.canonFacts.filter(
                          (_, position) => position !== index,
                        ),
                      })
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <section className="kdp-card">
            <header>
              <div>
                <h2>Proposed canon changes</h2>
                <p>
                  Changes a chapter made to established canon. Update the bible
                  if you accept them.
                </p>
              </div>
            </header>
            {(resource.data?.canonChanges ?? []).length === 0 && (
              <p className="kdp-muted">No canon changes recorded.</p>
            )}
            <ul className="kdp-plain-list">
              {(resource.data?.canonChanges ?? []).map((change) => (
                <li key={change.id}>
                  <Pill
                    tone={change.status === "proposed" ? "warn" : "neutral"}
                  >
                    {change.status}
                  </Pill>{" "}
                  {change.change}
                  {change.reason && (
                    <small className="kdp-muted"> — {change.reason}</small>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      {tab === "History" && (
        <section className="kdp-card">
          <header>
            <div>
              <h2>
                <History size={18} /> Version history
              </h2>
              <p>
                Every save, generation and chapter inspection creates a version.
              </p>
            </div>
          </header>
          <ol className="kdp-versions">
            {(resource.data?.versions ?? []).map((version) => (
              <li key={version.version}>
                <strong>v{version.version}</strong>{" "}
                <Pill>{version.updatedBy}</Pill> {version.note ?? ""}{" "}
                <small>{formatDateTime(version.createdAt)}</small>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
