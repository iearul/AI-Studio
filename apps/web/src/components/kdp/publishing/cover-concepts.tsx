"use client";

import type { CoverConcept } from "@ai-film-studio/contracts";
import { LoaderCircle, Palette, Sparkles } from "lucide-react";

import { CopyButton, EmptyPanel } from "@/components/kdp/kdp-ui";
import { formatDate } from "@/lib/kdp";

const hexPattern = /#(?:[0-9a-f]{3}|[0-9a-f]{6})\b/i;

function PaletteChip({ value }: { value: string }) {
  const hex = value.match(hexPattern)?.[0];
  return (
    <li className="kdp-cover-chip">
      {hex && (
        <i
          style={{ background: hex }}
          aria-hidden="true"
          className="kdp-cover-swatch"
        />
      )}
      {value}
    </li>
  );
}

export function CoverConcepts({
  concepts,
  createdAt,
  running,
  busy,
  onGenerate,
}: {
  concepts: CoverConcept[];
  createdAt: string | null;
  running: boolean;
  busy: boolean;
  onGenerate: () => void;
}) {
  const button = (
    <button
      type="button"
      className={concepts.length > 0 ? "button secondary" : "button primary"}
      disabled={running || busy}
      onClick={onGenerate}
    >
      {running || busy ? (
        <LoaderCircle size={15} className="spin" />
      ) : (
        <Sparkles size={15} />
      )}
      {running
        ? "Creating concepts…"
        : concepts.length > 0
          ? "Create new concepts"
          : "Create cover concepts"}
    </button>
  );
  return (
    <section className="kdp-card">
      <header>
        <div>
          <h2>Cover concepts</h2>
          <p>
            Image prompts for an external image tool. Generate the artwork
            without any lettering, then add it below; the title and author are
            set in the composer.
          </p>
        </div>
        {concepts.length > 0 && button}
      </header>
      {concepts.length === 0 ? (
        <EmptyPanel
          icon={<Palette size={22} />}
          title="No cover concepts yet"
          action={button}
        >
          Get three to five cover directions with prompts, palette and
          typography suggestions based on your story.
        </EmptyPanel>
      ) : (
        <>
          {createdAt && (
            <p className="kdp-muted kdp-cover-concepts-date">
              Created {formatDate(createdAt)}
            </p>
          )}
          <div className="kdp-cover-concepts">
            {concepts.map((concept, index) => (
              <article
                key={`${concept.name}-${index}`}
                className="kdp-cover-concept"
              >
                <h3>{concept.name}</h3>
                <p className="kdp-muted">{concept.visualMotif}</p>
                <div className="kdp-cover-prompt">
                  <div>
                    <span>Main prompt</span>
                    <CopyButton
                      value={concept.mainPrompt}
                      label="Copy prompt"
                    />
                  </div>
                  <p>{concept.mainPrompt}</p>
                </div>
                {concept.negativePrompt && (
                  <div className="kdp-cover-prompt negative">
                    <div>
                      <span>Negative prompt</span>
                      <CopyButton
                        value={concept.negativePrompt}
                        label="Copy negative prompt"
                      />
                    </div>
                    <p>{concept.negativePrompt}</p>
                  </div>
                )}
                <dl className="kdp-cover-concept-facts">
                  <div>
                    <dt>Composition</dt>
                    <dd>{concept.composition}</dd>
                  </div>
                  <div>
                    <dt>Palette</dt>
                    <dd>
                      <ul className="kdp-cover-chips">
                        {concept.palette.map((color, colorIndex) => (
                          <PaletteChip key={colorIndex} value={color} />
                        ))}
                      </ul>
                    </dd>
                  </div>
                  <div>
                    <dt>Typography</dt>
                    <dd>
                      Title: {concept.typography.titleFont}
                      <br />
                      Author: {concept.typography.authorFont}
                      <br />
                      <span className="kdp-muted">
                        {concept.typography.notes}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt>Text placement</dt>
                    <dd>{concept.textPlacement}</dd>
                  </div>
                  <div>
                    <dt>Thumbnail readability</dt>
                    <dd>{concept.genreReadability}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
