/**
 * Genre-level craft guidance. Profiles describe techniques, never the voice of
 * a particular author, so drafts develop an independent narrative voice.
 */

export const proseGuidelines = [
  "Dramatize in concrete scenes; explain only what a scene cannot show.",
  "Reveal character through decisions, actions, dialogue and their consequences.",
  "Give each character a distinct way of speaking that follows from who they are and what they want.",
  "Vary sentence length and structure the way the moment demands, not by formula.",
  "Use sensory detail selectively: one precise detail that matters beats a list.",
  "Cut exposition the reader does not need yet; trust the reader to infer.",
  "Keep meaningful uncertainty alive instead of resolving every question early.",
  "Every scene needs friction: a want, an obstacle and a change by the end.",
  "Do not repeat the same chapter shape; vary openings, scene order and endings.",
  "Dialogue must move plot, reveal relationship or characterize, ideally two at once.",
  "Give characters real flaws and moral complexity that create consequences.",
  "Show emotional shifts through events and behaviour, not by naming feelings.",
  "Never summarize what the reader has already seen.",
  "Avoid generic motivational or inspirational language.",
  "End chapters on the beat the story needs; a cliffhanger only when it is earned.",
  "Use em dashes, ellipses, rhetorical questions and one-line dramatic fragments sparingly.",
  "Avoid stock genre imagery: pounding hearts, held breaths, widening eyes, creeping shadows, deafening silence, darkness that swallows.",
  "Avoid stock AI phrasing such as 'little did they know', 'everything changed', 'a testament to', 'tapestry', 'in that moment', 'something shifted'.",
  "Keep cause and effect logical: every event follows from earlier events or choices.",
  "Deliver the ending the story has promised, consistent with its genre and tone.",
] as const;

export const clicheWatchlist = [
  {
    pattern: /\bheart (?:pounded|hammered|raced|thudded|thundered)\b/gi,
    label: "pounding heart",
  },
  {
    pattern: /\b(?:held|holding) (?:his|her|their|my) breath\b/gi,
    label: "held breath",
  },
  { pattern: /\bbreath (?:caught|hitched)\b/gi, label: "caught breath" },
  {
    pattern: /\blet out a breath (?:s?he|they|I) didn'?t know\b/gi,
    label: "breath they didn't know they held",
  },
  { pattern: /\beyes (?:widened|narrowed|darted)\b/gi, label: "eye movements" },
  {
    pattern: /\bshadows? (?:crept|danced|stretched|loomed)\b/gi,
    label: "living shadows",
  },
  {
    pattern: /\b(?:deafening|eerie|oppressive|heavy) silence\b/gi,
    label: "loaded silence",
  },
  {
    pattern: /\bdarkness (?:swallowed|pressed|closed in)\b/gi,
    label: "swallowing darkness",
  },
  { pattern: /\bblood ran cold\b/gi, label: "blood ran cold" },
  { pattern: /\bshiver (?:ran|went) down\b/gi, label: "shiver down the spine" },
  { pattern: /\bjaw (?:tightened|clenched)\b/gi, label: "clenched jaw" },
  { pattern: /\bknuckles (?:white|whitened)\b/gi, label: "white knuckles" },
] as const;

export const aiPhraseWatchlist = [
  /\blittle did (?:s?he|they|I|we|he|anyone) know\b/gi,
  /\b(?:and )?(?:everything|nothing would ever be the same|it all) changed\b/gi,
  /\ba testament to\b/gi,
  /\btapestry\b/gi,
  /\bin that (?:very )?moment\b/gi,
  /\bsomething (?:shifted|had shifted)\b/gi,
  /\bcouldn'?t help but\b/gi,
  /\bthe weight of (?:it all|the world|everything)\b/gi,
  /\bpalpable\b/gi,
  /\bunbeknownst\b/gi,
  /\ba stark reminder\b/gi,
  /\bdelve[ds]?\b/gi,
  /\bsymphony of\b/gi,
  /\bdance of (?:light|shadows?)\b/gi,
  /\bit was as if\b/gi,
  /\ba mix(?:ture)? of [a-z]+ and [a-z]+\b/gi,
] as const;

export type CraftProfile = {
  id: string;
  label: string;
  genres: RegExp;
  techniques: string[];
};

export const craftProfiles: CraftProfile[] = [
  {
    id: "psychological-suspense",
    label: "Psychological suspense",
    genres: /psycholog|domestic|suspense/i,
    techniques: [
      "Anchor tension in a narrator whose perception is plausible yet partial; let the reader notice what the narrator does not.",
      "Withhold by selection, not by trickery: every omission must be fair when the truth is revealed.",
      "Escalate through small social and domestic disturbances before overt danger.",
      "Let secrets surface through behaviour that contradicts what characters say.",
      "Seed the twist in plain sight early, framed so its meaning changes on reread.",
    ],
  },
  {
    id: "classic-detective",
    label: "Classic detective mystery",
    genres: /detective|mystery|cozy|whodunit|crime/i,
    techniques: [
      "Play fair: every clue needed for the solution appears on the page before the reveal.",
      "Give each suspect a believable motive, opportunity and a reason to lie about something unrelated.",
      "Interleave real clues with red herrings that have their own innocent explanation.",
      "Let the investigator's method and blind spots shape what is discovered and when.",
      "Stage the solution as a chain of reasoning the reader can check against earlier scenes.",
    ],
  },
  {
    id: "gothic-horror",
    label: "Gothic horror",
    genres: /gothic|horror|haunt|supernatural/i,
    techniques: [
      "Build dread through the wrongness of the ordinary before showing the threat.",
      "Keep the rules of the threat consistent, or keep its uncertainty consistent.",
      "Use place as pressure: architecture, isolation and history constrain the characters.",
      "Tie the supernatural to a human wound, guilt or secret so fear carries meaning.",
      "Ration revelation; each glimpse should answer one question and raise a worse one.",
    ],
  },
  {
    id: "domestic-thriller",
    label: "Domestic thriller",
    genres: /domestic|family|marriage/i,
    techniques: [
      "Let intimacy create danger: the people closest have the most power to harm.",
      "Make routine details (keys, phones, schedules) carry plot weight.",
      "Alternate safety and threat inside the same rooms to erode trust in the home.",
      "Give the antagonist coherent reasons that the reader can almost accept.",
    ],
  },
  {
    id: "literary-suspense",
    label: "Literary suspense",
    genres: /literary/i,
    techniques: [
      "Let tension arise from character and moral choice as much as from events.",
      "Use subtext in dialogue; what is avoided matters as much as what is said.",
      "Allow scenes to breathe, but end each one changed.",
      "Keep imagery motivated by the viewpoint character's history and mood.",
    ],
  },
  {
    id: "romantic-suspense",
    label: "Contemporary romantic suspense",
    genres: /romanc|romantic|love/i,
    techniques: [
      "Track the relationship and the external threat as two arcs that pressure each other.",
      "Earn intimacy through trust built under danger; each step costs something.",
      "Keep attraction specific to these two people, grounded in behaviour, not adjectives.",
      "Let the external plot force choices that test the relationship.",
      "Respect the book's sensuality level; fade to black or stay suggestive exactly as configured.",
    ],
  },
  {
    id: "general-fiction",
    label: "General fiction",
    genres: /.*/,
    techniques: [
      "Give the protagonist an active goal and a cost for pursuing it.",
      "Escalate stakes through consequences of earlier choices.",
      "Vary scene types: confrontation, discovery, reflection after action, decision.",
    ],
  },
];

export function resolveCraftProfile(
  profileId: string | null | undefined,
  genre: string,
  subgenre?: string | null,
): CraftProfile {
  const byId = craftProfiles.find((profile) => profile.id === profileId);
  if (byId) return byId;
  const haystack = `${subgenre ?? ""} ${genre}`;
  return (
    craftProfiles.find(
      (profile) =>
        profile.id !== "general-fiction" && profile.genres.test(haystack),
    ) ?? craftProfiles[craftProfiles.length - 1]!
  );
}
