import { createHash } from "node:crypto";
import JSZip from "jszip";
import {
  BROKER_INTERVIEW_SCHEMA_VERSION,
  BROKER_INTERVIEW_SOURCE_TYPE,
  brokerInterviewSetSchema,
  type BrokerInterviewSet,
  type BrokerMarketContext,
  type BrokerObservation,
  type BrokerPublicationStatus,
  type BrokerTopic,
  type BrokerUnmatchedSection,
} from "../../src/report-engine/narratives/brokerInterviews.ts";
import { CHICAGO_SUBMARKETS } from "../../src/report-engine/submarkets.ts";
import { containsSalesforceIdToken } from "../../src/shared/salesforceIds.ts";

/**
 * Broker interview ingestion. Every byte of an uploaded interview is DATA:
 * nothing in it is ever executed or followed as an instruction. Output is a
 * normalized, classified BrokerInterviewSet; the raw file is never stored.
 *
 * Designed around the real interview format: a market heading per section,
 * Q1–Q7 prompts, "● Speaker:" lines, "○" statements and "■" sub-points,
 * interviewer notes, explicit confidentiality instructions, combined
 * sessions, and markets that are absent or marked N/A.
 */

export class BrokerInterviewIngestionError extends Error {
  constructor(
    message: string,
    readonly code:
      | "UNSUPPORTED_FILE_TYPE"
      | "UNREADABLE_FILE"
      | "NO_EXTRACTABLE_TEXT"
      | "FILE_TOO_LARGE",
  ) {
    super(message);
    this.name = "BrokerInterviewIngestionError";
  }
}

export const BROKER_INTERVIEW_MAX_BYTES = 15 * 1024 * 1024;

export type BrokerFileType = "pdf" | "docx";

export function detectBrokerFileType(
  fileName: string,
  bytes: Uint8Array,
): BrokerFileType {
  const isPdf = bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-";
  const isZip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (/\.pdf$/i.test(fileName) && isPdf) return "pdf";
  if (/\.docx$/i.test(fileName) && isZip) return "docx";
  if (/\.(pdf|docx)$/i.test(fileName))
    throw new BrokerInterviewIngestionError(
      `${fileName} is not a readable ${/\.pdf$/i.test(fileName) ? "PDF" : "Word (.docx)"} file.`,
      "UNREADABLE_FILE",
    );
  throw new BrokerInterviewIngestionError(
    "Broker interviews must be a PDF or Word (.docx) file.",
    "UNSUPPORTED_FILE_TYPE",
  );
}

export interface ExtractedPage {
  page: number;
  text: string;
}

async function extractPdf(bytes: Uint8Array): Promise<ExtractedPage[]> {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: false });
    return (text as string[]).map((page, index) => ({ page: index + 1, text: page }));
  } catch (error) {
    throw new BrokerInterviewIngestionError(
      `The PDF could not be read (${error instanceof Error ? error.message : "unknown error"}).`,
      "UNREADABLE_FILE",
    );
  }
}

const XML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};
const decodeXml = (value: string) =>
  value
    .replace(/&(amp|lt|gt|quot|apos);/g, (entity) => XML_ENTITIES[entity]!)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));

/** Word list levels map onto the same ●/○/■ markers the PDF export uses. */
const LIST_GLYPHS = ["●", "○", "■", "■", "■"];

async function extractDocx(bytes: Uint8Array): Promise<ExtractedPage[]> {
  let xml: string | undefined;
  try {
    const zip = await JSZip.loadAsync(bytes);
    xml = await zip.file("word/document.xml")?.async("string");
  } catch (error) {
    throw new BrokerInterviewIngestionError(
      `The Word document could not be read (${error instanceof Error ? error.message : "unknown error"}).`,
      "UNREADABLE_FILE",
    );
  }
  if (!xml)
    throw new BrokerInterviewIngestionError(
      "The Word document has no readable body (word/document.xml is missing).",
      "UNREADABLE_FILE",
    );
  const pages: ExtractedPage[] = [{ page: 1, text: "" }];
  const body = xml.replace(/<w:tbl\b[\s\S]*?<\/w:tbl>/g, (table) =>
    table.replace(/<\/w:tc>/g, " "),
  );
  for (const paragraph of body.match(/<w:p\b[\s\S]*?<\/w:p>/g) ?? []) {
    if (/<w:br\b[^>]*w:type="page"/.test(paragraph) || /<w:pageBreakBefore\b/.test(paragraph))
      pages.push({ page: pages.length + 1, text: "" });
    const text = decodeXml(
      (paragraph.match(/<w:t\b[^>]*>[\s\S]*?<\/w:t>|<w:tab\/>|<w:br\/>/g) ?? [])
        .map((run) =>
          run === "<w:tab/>" ? " " : run === "<w:br/>" ? " " : run.replace(/<[^>]+>/g, ""),
        )
        .join(""),
    ).trim();
    if (!text) continue;
    const level = paragraph.match(/<w:ilvl w:val="(\d+)"/)?.[1];
    const listed = /<w:numPr>/.test(paragraph) && level !== undefined;
    const line = listed ? `${LIST_GLYPHS[Number(level)] ?? "■"} ${text}` : text;
    const current = pages[pages.length - 1]!;
    current.text += `${current.text ? "\n" : ""}${line}`;
  }
  return pages;
}

export async function extractBrokerInterviewText(
  fileName: string,
  bytes: Uint8Array,
): Promise<{ fileType: BrokerFileType; pages: ExtractedPage[] }> {
  if (bytes.length > BROKER_INTERVIEW_MAX_BYTES)
    throw new BrokerInterviewIngestionError(
      "Broker interview files must be 15 MB or smaller.",
      "FILE_TOO_LARGE",
    );
  const fileType = detectBrokerFileType(fileName, bytes);
  const pages = fileType === "pdf" ? await extractPdf(bytes) : await extractDocx(bytes);
  if (!pages.some((page) => page.text.trim().length >= 20))
    throw new BrokerInterviewIngestionError(
      "No text could be extracted. Scanned or image-only files are not supported; upload a text PDF or Word document.",
      "NO_EXTRACTABLE_TEXT",
    );
  return { fileType, pages };
}

// --- Market heading recognition ----------------------------------------------

const normalizeHeading = (value: string) =>
  value
    .toLocaleLowerCase()
    .replace(/[‘’‛ʼ`´]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

/** Broker-specific aliases on top of the canonical registry. */
const EXTRA_ALIASES: Record<string, string[]> = {
  "southeast-wisconsin": ["SE Wisconsin", "S.E. Wisconsin", "SE WI", "Southeast WI"],
  "i80-joliet": ["I-80/Joliet Area", "I-80 / Joliet", "I-80 Joliet Area", "I-80 Corridor", "I-80", "Joliet"],
  "i55-corridor": ["I-55", "I55 Corridor", "I-55 Corr"],
  "i57-corridor": ["I-57", "I57 Corridor"],
  "i88-corridor": ["I-88", "I88 Corridor"],
  ohare: ["Ohare", "O Hare", "OHare"],
  "northwest-indiana": ["NW Indiana"],
  "northwest-cook": ["NW Cook"],
  "overall-market": ["Overall Market", "Overall", "Chicago Overall", "Market Overview"],
};

const ALIASES: { alias: string; marketId: string }[] = [
  ...CHICAGO_SUBMARKETS.flatMap((identity) =>
    [identity.id, identity.canonicalName, identity.displayName, ...(identity.aliases ?? [])].map(
      (alias) => ({ alias: normalizeHeading(alias), marketId: identity.id }),
    ),
  ),
  ...Object.entries(EXTRA_ALIASES).flatMap(([marketId, aliases]) =>
    aliases.map((alias) => ({ alias: normalizeHeading(alias), marketId })),
  ),
]
  // Longest first so "I-80/Joliet Area" wins over "I-80".
  .sort((left, right) => right.alias.length - left.alias.length);

const MARKET_NAMES = new Map<string, string>([
  ["overall-market", "Overall Market"],
  ...CHICAGO_SUBMARKETS.map((identity) => [identity.id, identity.displayName] as [string, string]),
]);

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every market an arbitrary piece of text names. */
const marketsMentioned = (text: string) => {
  const normalized = ` ${normalizeHeading(text)} `;
  const found = new Set<string>();
  let remaining = normalized;
  for (const { alias, marketId } of ALIASES) {
    const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(alias)}(?![a-z0-9])`);
    if (pattern.test(remaining)) {
      found.add(marketId);
      remaining = remaining.replace(pattern, "$1 ");
    }
  }
  return found;
};

export interface HeadingMatch {
  marketId?: string;
  ambiguous: boolean;
  notCovered: boolean;
  /** Other markets named in a parenthetical, e.g. a combined interview session. */
  relatedMarketIds: string[];
  heading: string;
}

/**
 * A line is a market heading when, after an optional bullet glyph, it is a
 * market name optionally followed by "- N/A", ":", or a parenthetical note,
 * and nothing else. Sentences that merely start with a market name
 * ("Chicago South was not captured") are not headings.
 */
export function matchMarketHeading(rawLine: string): HeadingMatch | undefined {
  const line = rawLine.replace(/^[●○■•▪\-*]\s*/, "").trim();
  if (!line || line.length > 90) return undefined;
  const normalized = normalizeHeading(line);
  const parenthetical = normalized.match(/\(([^)]*)\)\s*:?$/)?.[1] ?? "";
  const core = normalized
    .replace(/\([^)]*\)\s*:?$/, "")
    .replace(/\s*[-:]\s*(n\/a|na|not applicable|not covered|pending)\s*$/, "")
    .replace(/\s*:$/, "")
    .trim();
  const notCovered =
    /\s[-:]\s*(n\/a|na|not applicable|not covered|pending)\s*$/.test(
      normalized.replace(/\([^)]*\)\s*:?$/, ""),
    );
  if (!core) return undefined;
  const exact = ALIASES.filter(({ alias }) => alias === core);
  const coreMarkets = new Set(exact.map(({ marketId }) => marketId));
  if (!coreMarkets.size) {
    // "South Cook / Southwest Cook", "South Cook & Southwest Cook": a heading
    // made only of market names joined by separators is ambiguous.
    const parts = core.split(/\s*(?:\/|&|\+|,|\band\b)\s*/).filter(Boolean);
    const named = parts.map((part) => ALIASES.find(({ alias }) => alias === part)?.marketId);
    if (parts.length > 1 && named.every(Boolean))
      return { ambiguous: true, notCovered, relatedMarketIds: [...new Set(named as string[])], heading: line };
    return undefined;
  }
  const marketId = [...coreMarkets][0]!;
  const related = [...marketsMentioned(parenthetical)].filter((id) => id !== marketId);
  return { marketId, ambiguous: false, notCovered, relatedMarketIds: related, heading: line };
}

// --- Line model ----------------------------------------------------------------

interface Line {
  /** 0 plain, 1 ● speaker, 2 ○ statement, 3 ■ sub-point */
  level: 0 | 1 | 2 | 3;
  text: string;
  page: number;
}

const GLYPH_LEVEL: Record<string, 1 | 2 | 3> = { "●": 1, "•": 1, "○": 2, "◦": 2, "■": 3, "▪": 3 };
const QUESTION_LINE = /^(?:Q\d+(?:\s*(?:[–-]|and|&|,)\s*Q?\d+)*\s*[.:)]\s|Closing\b)/i;

function toLines(pages: ExtractedPage[]): Line[] {
  const lines: Line[] = [];
  for (const { page, text } of pages)
    for (const raw of text.split(/\r?\n/)) {
      const trimmed = raw.replace(/\s+/g, " ").trim();
      if (!trimmed) continue;
      const glyph = trimmed[0]!;
      const level = GLYPH_LEVEL[glyph];
      const body = level ? trimmed.slice(1).trim() : trimmed;
      const startsBlock =
        Boolean(level) || QUESTION_LINE.test(trimmed) || Boolean(matchMarketHeading(trimmed));
      const previous = lines[lines.length - 1];
      // PDF text wraps long bullets across lines; a line that does not start
      // a new block continues the previous one.
      if (!startsBlock && previous && previous.level > 0) {
        previous.text = `${previous.text} ${body}`;
        continue;
      }
      if (!startsBlock && previous && previous.level === 0 && !matchMarketHeading(previous.text)) {
        previous.text = `${previous.text} ${body}`;
        continue;
      }
      lines.push({ level: (level ?? 0) as Line["level"], text: body, page });
    }
  return lines;
}

// --- Classification --------------------------------------------------------------

const RESTRICTED_PATTERNS: [RegExp, string][] = [
  [/\bnot (?:to be|for) publici[sz]\w*/i, "marked not to be publicized"],
  [/\b(?:asked|wants?|prefers?) (?:us )?not to (?:publish|publicize|share|mention)/i, "source asked not to publish"],
  [/\b(?:do not|don't|never) (?:publish|publicize|print|share|quote)\b/i, "marked do not publish"],
  [/\bnot for (?:publication|attribution|release)\b/i, "marked not for publication"],
  [/\boff[- ]the[- ]record\b/i, "off the record"],
  [/\bconfidential\b/i, "marked confidential"],
  [/\brather (?:the report |we |you )?not (?:highlight|mention|publish|feature)/i, "source asked that it not be highlighted"],
  [/\b(?:not|never) (?:be )?highlighted\b|\b(?:do not|don't) highlight\b/i, "source asked that it not be highlighted"],
  [/\bkeep (?:this|it) (?:quiet|out of the report|internal)\b/i, "source asked to keep it internal"],
];

const UNCERTAIN_PATTERNS: [RegExp, string][] = [
  [/\bin the transcript\b/i, "entity name is a transcription guess"],
  [/\bgarbled\b/i, "transcript garbled"],
  [/\btranscript (?:reads|is unclear|unclear)\b/i, "transcript unclear"],
  [/\b(?:unclear|inaudible|unintelligible)\b/i, "transcript unclear"],
  [/\(I think\b|\bI think;|\bnot sure (?:if|whether|who)\b/i, "note-taker uncertainty"],
  [/\bcouldn't remember\b|\bcan't recall\b/i, "speaker recall uncertain"],
  [/\?\)/, "note-taker uncertainty"],
];

const REVIEW_PATTERNS: [RegExp, string][] = [
  [/\b(?:the )?(?:narrative|report|write-?up) should\b|\bmake sure (?:the )?(?:report|narrative)\b/i, "directive about report content (data, not instruction)"],
  [/\bignore (?:all |any |the )?(?:previous|prior|above)\b|\bsystem prompt\b|\byou are (?:an?|the) (?:ai|assistant|model)\b/i, "embedded instruction-like text"],
  [/https?:\/\/|www\.|\b[\w.+-]+@[\w-]+\.[\w.]+\b/i, "contains a link or email address"],
  [/\bcall (?:him|her|them)\b|\bfollow up with\b|\bwaiting on\b|\bin the system\b|\bdeal sheet\b|\bcomp(?:s)? (?:is|are) (?:still )?(?:pending|waiting)|\bwaiting on a comp\b|\bthe stats you showed\b|\bmentioned on the call\b|\bsince the last time you\b/i, "internal workflow or action item"],
  [/\bdeals? (?:is|are) (?:close|pending)\b|\bclose to done\b|\bnegotiating with\b|\bin negotiations?\b|\bunder contract\b|\bmay come off\b|\bdeals are pending\b/i, "pending or unannounced transaction"],
  [/\bwent under\b|\bbankrupt\w*|\bbusiness failures?\b|\bdefaults?\b|\blaid off\b|\blayoffs?\b/i, "names distress at an identifiable business"],
  [/\b(?:covered everything|didn't name a specific|no new points|not asked)\b/i, "not substantive"],
  [/\b(?:vacancy|availability|absorption)\b[^.]{0,30}\b(?:ticking up|ticking down|rising|falling|increas\w*|decreas\w*|went up|went down|is up|is down)\b|\b(?:expect|forecast)\w*\b[^.]{0,40}\b(?:absorption|vacancy|availability|rents?)\b/i, "describes or forecasts a governed metric; governed data is authoritative"],
  [/\b(?:leased|signed|deal|sold)\b[^.]{0,60}\d[\d,.]*\s?(?:k|m|million)?\s?sf\b|\d[\d,.]*\s?(?:k|m|million)?\s?sf\b[^.]{0,40}\b(?:leased|signed|deal|sold)\b/i, "specific transaction size; governed lease and sale records are authoritative"],
];

/** Governed-metric vocabulary: a broker figure here must never compete with governed data. */
const GOVERNED_METRIC_WORDS =
  /\b(vacan\w*|availability rate|available space|absorption|absorb\w*|under construction|deliver\w*|inventory|leasing (?:activity|volume)|total leasing|sales? volume|rents?\b|rates?\b|lease rate|asking|cap rate|pric\w*|per (?:square )?foot)/i;
const GOVERNED_QUANTITY = /\d[\d,.]*\s?%|\$\s?\d|\d[\d,.]*\s?(?:k|m|million)?\s?sf\b/i;
const GOVERNED_STATUS_ASSERTION =
  /\b(?:nothing|no(?:thing)? (?:new )?(?:space|product|buildings?)?|none|zero)\b[^.]{0,60}\b(?:under construction|delivered|deliveries)\b|\bshould count as under construction\b/i;

const INTERVIEWER_TEXT = /^(?:you\b|you asked\b|you noted\b|you framed\b|you summarized\b|you said\b|interviewer\b)/i;

const MACRO_WORDS = /\b(?:war|inflation|interest rates?|rate hike|tariffs?|diesel|fuel prices?|election|economy|recession|economists?)\b/i;

const TOPIC_RULES: [BrokerTopic, RegExp][] = [
  ["macro_sentiment", MACRO_WORDS],
  ["concessions", /\bfree rent\b|\bconcession|\bTI\b|\bTI dollars\b|\bincentive|\bhalf rent\b/i],
  ["lease_terms", /\b(?:\d+|one|two|three|five|ten)[- ](?:year|month)s?[- ]term|\bshort(?:er)?[- ]term|\bterm(?:s)?\b.*\b(?:shorter|longer|months?|years?)\b|\brenewal/i],
  ["clear_height", /\bclear[- ]height\b|\d+['’]\s?(?:clear|\+)|\bhigh(?:er)?[- ]clear\b|\blow[- ]clear\b/i],
  ["power", /\bpower\b|\bdata cent(?:er|re)/i],
  ["build_to_suit", /\bbuild[- ]to[- ]suit|\bBTS\b/i],
  ["site_supply", /\bsites?\b|\bland\b/i],
  ["development", /\bspec\b|\bdevelop|\bgroundbreak|\bconstruction\b|\bnew product\b/i],
  ["seller_expectations", /\bsellers?\b|\bowners? (?:won't|will not) sell/i],
  ["buyer_demand", /\bbuyers?\b|\bto buy\b|\bpurchas|\bfor sale\b|\bsale (?:side|activity)|\bsold\b|\bunder contract\b|\bBOV\b/i],
  ["landlord_behavior", /\blandlords?\b|\bowners?\b|\bpushing rents\b|\bholding (?:firm|rates)\b|\boccupancy\b/i],
  ["building_class", /\bclass [abc]\b|\bcore[- ]plus\b|\bolder\b.*\b(?:product|building)|\bnewer\b/i],
  ["geography", /\bmigrat|\bfarther (?:out|west|east)|\beast to west\b|\bskip(?:ping)?\b|\bspill\b|\bmoving (?:into|to)\b|\bcounty\b/i],
  ["size_segment", /\d+\s?[–-]\s?\d+\s?k\s?sf|\bk sf range\b|\bsmall[- ]bay\b|\bbig[- ]box\b|\bbulk\b|\bsize range/i],
  ["tenant_preferences", /\btenants? (?:want|will pay|prefer|need)|\bpay up\b/i],
  ["market_velocity", /\bvelocity\b|\bslow\b|\bsluggish\b|\bfaster\b|\bquickly\b|\btight(?:en|ening)?\b|\bboring\b/i],
  ["forward_outlook", /\bexpect\b|\bnext (?:quarter|year)\b|\bwatch\b|\bgoing forward\b|\bwill keep\b/i],
  ["tenant_activity", /\bactivity\b|\binquir|\btour|\btraffic\b|\bdemand\b|\bRFPs?\b|\bbusier\b|\brequirements?\b|\bdeals?\b/i],
];

const classifyTopic = (text: string): BrokerTopic =>
  TOPIC_RULES.find(([, pattern]) => pattern.test(text))?.[0] ?? "other";

const firstReason = (patterns: [RegExp, string][], text: string) =>
  patterns.filter(([pattern]) => pattern.test(text)).map(([, reason]) => reason);

// --- Parsing -----------------------------------------------------------------------

interface DraftObservation {
  statement: string;
  page: number;
  speaker: string | null;
  speakerRole: BrokerObservation["speakerRole"];
  question: string | null;
  /** Restriction inherited from a parent line ("Example, not to be publicized:"). */
  inheritedRestrictions: string[];
  inheritedUncertainty: string[];
}

interface DraftSection {
  marketId?: string;
  heading: string;
  page: number;
  ambiguous: boolean;
  notCovered: boolean;
  relatedMarketIds: string[];
  observations: DraftObservation[];
  rawText: string[];
}

// The colon must end the label ("Broker: text" or "Broker:"), so "https://" is never a label.
const SPEAKER_LABEL = /^([^:]{1,70}):(?:\s+(.*)|\s*)$/;
/** A label that only names who is speaking ("Broker", "You", "Dylan", "Mike and Brandon"). */
const SPEAKER_ONLY_LABEL =
  /^(?:(?:second |third |another )?broker(?:\s*\([^)]*\))?|you|interviewer|[A-Z][a-z]+(?:,? likely [A-Z][a-z]+)?(?:\s+and\s+[A-Z][a-z]+)?)$/i;

function parseSpeaker(text: string) {
  const match = text.match(SPEAKER_LABEL);
  if (!match) return undefined;
  const label = match[1]!.trim();
  // A label is short and descriptive ("Broker", "Dylan", "Broker, likely Chris",
  // "Follow-up on concessions"); a long sentence with a colon is not a label.
  if (label.split(/\s+/).length > 9) return undefined;
  const interviewer = /^(?:you|interviewer|moderator)\b/i.test(label);
  const followUp = /^follow-?up\b/i.test(label);
  const uncertain = /\blikely\b|\bunclear\b|\?/.test(label);
  const generic = /^(?:broker|second broker|third broker|another broker)\b/i.test(label);
  return {
    label,
    rest: (match[2] ?? "").trim(),
    role: interviewer ? ("interviewer" as const) : followUp ? ("unknown" as const) : ("broker" as const),
    // Speaker identities are reviewer-only; uncertain or generic labels are not names.
    speaker: interviewer || followUp || uncertain || generic ? null : label,
    followUp,
  };
}

/** Words a speaker label can contain that are not personal names. */
const NON_NAME_LABEL_WORDS = new Set([
  "broker", "brokers", "second", "third", "another", "you", "interviewer", "moderator",
  "follow", "followup", "summary", "example", "examples", "note", "notes", "closing",
  "background", "likely", "and", "context", "update", "question", "answer", "comment",
]);

/** Personal names from a speaker label ("Dylan", "Mike and Brandon", "Broker, likely Chris"). */
const labelNames = (label: string) =>
  label
    .split(/[\s,()/&]+/)
    .filter((word) => /^[A-Z][a-z]{2,}$/.test(word))
    .filter((word) => !NON_NAME_LABEL_WORDS.has(word.toLocaleLowerCase()));

function parseSections(lines: Line[], speakerNames: Set<string>): DraftSection[] {
  const sections: DraftSection[] = [];
  let current: DraftSection = {
    heading: "Preamble",
    page: lines[0]?.page ?? 1,
    ambiguous: false,
    notCovered: false,
    relatedMarketIds: [],
    observations: [],
    rawText: [],
  };
  sections.push(current);
  let question: string | null = null;
  let speaker: ReturnType<typeof parseSpeaker> | undefined;
  let parentStatement: DraftObservation | undefined;
  let speakerRestrictions: string[] = [];
  for (const line of lines) {
    const heading = line.level <= 1 ? matchMarketHeading(line.text) : undefined;
    if (heading) {
      current = {
        marketId: heading.ambiguous ? undefined : heading.marketId,
        heading: heading.heading,
        page: line.page,
        ambiguous: heading.ambiguous,
        notCovered: heading.notCovered,
        relatedMarketIds: heading.relatedMarketIds,
        observations: [],
        rawText: [],
      };
      sections.push(current);
      question = null;
      speaker = undefined;
      parentStatement = undefined;
      speakerRestrictions = [];
      continue;
    }
    current.rawText.push(line.text);
    if (line.level === 0) {
      if (QUESTION_LINE.test(line.text)) {
        question = line.text.slice(0, 200);
        speaker = undefined;
        parentStatement = undefined;
        speakerRestrictions = [];
      }
      continue;
    }
    if (line.level === 1) {
      parentStatement = undefined;
      const parsed = parseSpeaker(line.text);
      if (parsed) {
        if (SPEAKER_ONLY_LABEL.test(parsed.label) || /\blikely\b/i.test(parsed.label))
          labelNames(parsed.label).forEach((name) => speakerNames.add(name));
        speaker = parsed;
        speakerRestrictions = firstReason(RESTRICTED_PATTERNS, parsed.label);
        if (parsed.rest)
          current.observations.push({
            statement: parsed.rest,
            page: line.page,
            speaker: parsed.speaker,
            speakerRole: parsed.role,
            question,
            inheritedRestrictions: speakerRestrictions,
            inheritedUncertainty: [],
          });
      } else {
        // A speaker-less bullet ("You summarized this as ...", "Follow-up. You asked ...").
        speaker = undefined;
        speakerRestrictions = [];
        current.observations.push({
          statement: line.text,
          page: line.page,
          speaker: null,
          // "Follow-up, 'Have tenants' expectations changed?'" is the interviewer's question.
          speakerRole:
            INTERVIEWER_TEXT.test(line.text) ||
            /\byou asked\b/i.test(line.text) ||
            /^follow-?up\b/i.test(line.text)
              ? "interviewer"
              : "unknown",
          question,
          inheritedRestrictions: [],
          inheritedUncertainty: [],
        });
      }
      continue;
    }
    if (line.level === 2) {
      // "○ Broker: text" names a nested speaker; "○ Example, not to be
      // publicized:" with no text is a group header whose ■ sub-points (and
      // any restriction in the header) belong to it.
      const candidate = parseSpeaker(line.text);
      const bareSpeaker =
        candidate && !candidate.rest && SPEAKER_ONLY_LABEL.test(candidate.label);
      // Inside a statement bullet, only a real speaker label ("○ Broker: ...",
      // "○ You: ...") names a speaker; anything else is part of the statement.
      const namedSpeaker =
        candidate?.rest && SPEAKER_ONLY_LABEL.test(candidate.label) ? candidate : undefined;
      const nested = namedSpeaker ?? (bareSpeaker ? candidate : undefined);
      if (nested) labelNames(nested.label).forEach((name) => speakerNames.add(name));
      const role = nested ? nested.role : speaker?.followUp ? "broker" : (speaker?.role ?? "unknown");
      const text = nested ? nested.rest : line.text;
      parentStatement = {
        statement: text,
        page: line.page,
        speaker: nested ? nested.speaker : (speaker?.speaker ?? null),
        speakerRole: INTERVIEWER_TEXT.test(line.text) ? "interviewer" : role,
        question,
        inheritedRestrictions: speakerRestrictions,
        inheritedUncertainty: [],
      };
      // A bare "○ Broker:" collects its ■ points; it is pushed with the first one.
      if (text) current.observations.push(parentStatement);
      continue;
    }
    // ■ sub-point: part of its parent statement, so a restriction or
    // uncertainty on the parent ("Example, not to be publicized:") covers it.
    if (parentStatement) {
      if (!parentStatement.statement) {
        parentStatement.statement = line.text;
        current.observations.push(parentStatement);
      } else
        parentStatement.statement = /:\s*$/.test(parentStatement.statement)
          ? `${parentStatement.statement} ${line.text}`
          : `${parentStatement.statement}; ${line.text}`;
    }
    else
      current.observations.push({
        statement: line.text,
        page: line.page,
        speaker: speaker?.speaker ?? null,
        speakerRole: speaker?.role ?? "unknown",
        question,
        inheritedRestrictions: speakerRestrictions,
        inheritedUncertainty: [],
      });
  }
  return sections;
}

/** Interviewer framing or a restated question, even when a broker answer follows. */
const INTERVIEWER_FRAMING =
  /^(?:asked|when asked|after being asked|in response to (?:a|the|your) question|question\s*[:.])|\b(?:you|the interviewer|we|i) asked\b/i;

/** Malformed figures from transcription ("escalations2. 50– 1. 75– of"). */
const GARBLED_FIGURES: RegExp[] = [
  /[A-Za-z]{3,}\d/,
  /\d\.\s+\d/,
  /\d\s?[–-]\s+(?!(?:and|or|to)\b)[\da-z]/,
];

const COUNT_WORD = "(?:\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|eighteen|twenty|thirty|forty|sixty)";
/** "a 2-year term", "3 months of free rent", "topping out at about 48 months". */
const LEASE_DURATION = new RegExp(`\\b${COUNT_WORD}[- ]?(?:\\+\\s?)?(?:years?|yrs?|months?)\\b`, "i");
const LEASE_ECONOMICS_CONTEXT =
  /\b(?:terms?|leases?|leased|leasing|free rent|rent|deals?|renewals?|concessions?|abatement|topping out)\b/i;
const RENT_OR_PRICE_FIGURE =
  /\d[\d,.]*\s?\/\s?SF\b|\bpsf\b|\d[\d,.]*\s?(?:per (?:square )?(?:foot|ft)|cents)\b/i;
/** Words that put a named company or property in a deal, pricing, or occupancy context. */
const DEAL_CONTEXT =
  /\b(?:deals?|leas(?:e|ed|es|ing)|sold|sell|sale|signed|terms?|BOV|listing|bought|buyers?|pric(?:e|ed|es|ing)|rents?|renewal|acquired|purchas\w*|valuation|spec|develop\w*|build\w*|absorb\w*|occup\w*|expand\w*|planning|doing|took|moving|wouldn't|won't)\b/i;
/** The interviewee's own listing or deal ("He has a listing...", "where he repped the tenant"). */
const OWN_DEAL_ANECDOTE =
  /\b(?:listings?|repped|represented the (?:tenant|landlord|buyer|seller)|(?:he|she|they) (?:sold|leased|listed|signed)\b)/i;
/** A remark about the report or the interview rather than the market. */
const REPORT_META = /\b(?:the|this|your|our) (?:report|survey|interview)\b/i;
/** A short answer whose meaning depends on the interviewer's question. */
const ANSWER_FRAGMENT =
  /^["“]?(?:yes|no|not really|they aren't|it depends|i don't think so|i wouldn't say|probably not|not much)\b/i;
const STREET_ADDRESS =
  /\b\d{2,6}\s+(?:[NSEW]\.?\s+)?[A-Z][a-z]+(?:\s+(?:Rd|Road|St|Street|Ave|Avenue|Dr|Drive|Pkwy|Parkway|Blvd|Boulevard|Ln|Lane|Ct|Court|Way|Hwy|Highway))?\b/;

/**
 * Capitalized words that are geography, market vocabulary, or common
 * report terms rather than a named company or property.
 */
const NON_ENTITY_CAPITALS = new Set(
  [
    ...[...MARKET_NAMES.values()].flatMap((name) => name.split(/[\s/]+/)),
    "Cook", "County", "Kane", "DuPage", "Dupage", "O'Hare", "O’Hare", "Ohare", "Chicago", "Chicagoland",
    "Illinois", "Indiana", "Wisconsin", "Midwest", "Elgin", "Aurora", "Joliet", "Naperville", "Rockford",
    "North", "South", "East", "West", "Northwest", "Southwest", "Southeast", "Northeast", "Central",
    "Class", "Chinese", "China", "Mexico", "Mexican", "Iran", "Canada", "American", "Covid", "COVID",
    "Fed", "Federal", "Interstate", "Expressway", "Tollway", "Corridor", "Area", "Market", "Broker",
    "Brokers", "January", "February", "March", "April", "May", "June", "July", "August", "September",
    "October", "November", "December", "Christmas", "Thanksgiving", "Route",
    // Chicagoland municipalities and corridors: places, not deal parties.
    "Morris", "Minooka", "Channahon", "Lockport", "Elwood", "Romeoville", "Bolingbrook", "Batavia",
    "Geneva", "Itasca", "Bensenville", "Schaumburg", "Hoffman", "Estates", "Arlington", "Heights",
    "Elk", "Grove", "Village", "Wood", "Dale", "Portage", "Gary", "Hammond", "Valparaiso", "Crete",
    "Kenosha", "Pleasant", "Prairie", "Waukegan", "Gurnee", "Carol", "Stream", "Franklin", "Park",
    "Melrose", "Bedford", "Cicero", "Chicago", "Heights", "University", "Monee", "Peotone",
  ].map((word) => word.toLocaleLowerCase()),
);

/** Mid-sentence capitalized words across the document: the likely named companies and properties. */
function documentProperNouns(statements: string[]) {
  const nouns = new Set<string>();
  for (const text of statements)
    for (const sentence of text.split(/(?<=[.!?:;"”])\s+/))
      sentence
        .split(/\s+/)
        .slice(1)
        .map((word) => word.replace(/^[^A-Za-z]+|[^A-Za-z'’]+$/g, "").replace(/['’]s$/, ""))
        .filter((word) => /^[A-Z][a-zA-Z'’&-]{2,}$/.test(word))
        .filter((word) => !NON_ENTITY_CAPITALS.has(word.toLocaleLowerCase()))
        .forEach((word) => nouns.add(word));
  return nouns;
}

const wordPattern = (words: Iterable<string>) => {
  const list = [...words].map(escapeRegExp);
  return list.length ? new RegExp(`\\b(?:${list.join("|")})\\b`) : undefined;
};

interface DocumentVocabulary {
  /** Interview participants named in speaker labels; never published. */
  speakerNames: Set<string>;
  properNouns: Set<string>;
}

/**
 * Removes interview participants from a publishable statement where that can
 * be done without changing its meaning ("Agreed with Dylan." / "Brian agreed."
 * / "Brian said:" -> "A broker said:"). Returns residual=true when a name is
 * still present, which sends the observation to review instead.
 */
export function sanitizeSpeakerNames(statement: string, speakerNames: Iterable<string>) {
  const names = [...speakerNames].map(escapeRegExp);
  if (!names.length) return { text: statement, changed: false, residual: false };
  const name = `(?:${names.join("|")})`;
  const people = `${name}(?:(?:,\\s*|\\s+and\\s+)${name})*`;
  let text = statement
    .replace(new RegExp(`^(?:(?:he|she|they)\\s+)?(?:agreed|agrees|agreeing|concurred|concurs)\\s+with\\s+${people}\\b[.,;:]?\\s*`, "i"), "")
    .replace(new RegExp(`[;,]?\\s*${people}\\s+(?:agreed|agrees|concurred|concurs)(?:\\s+with\\s+(?:that|this|him|her))?\\.?\\s*$`), "")
    .replace(new RegExp(`\\b(?:according to|per)\\s+${people}\\b,?`, "g"), "according to a broker,")
    .replace(
      new RegExp(`\\b${people}\\s+(said|says|noted|notes|added|adds|explained|explains|mentioned|mentions|thinks|expects|believes|described|describes|pointed out|reported|reports)\\b`, "g"),
      "a broker $1",
    )
    .replace(/(^|[.!?]\s+)a broker\b/g, (_match, lead: string) => `${lead}A broker`)
    .replace(/\s+/g, " ")
    .trim();
  if (/^[a-z]/.test(text)) text = text[0]!.toLocaleUpperCase() + text.slice(1);
  return {
    text,
    changed: text !== statement,
    residual: new RegExp(`\\b${name}(?:['’]s)?\\b`).test(text),
  };
}

function classify(observation: DraftObservation, vocabulary: DocumentVocabulary): {
  status: BrokerPublicationStatus;
  reasons: string[];
} {
  const text = observation.statement;
  const restricted = [...observation.inheritedRestrictions, ...firstReason(RESTRICTED_PATTERNS, text)];
  if (restricted.length) return { status: "RESTRICTED", reasons: [...new Set(restricted)] };
  if (observation.speakerRole === "interviewer")
    return { status: "REVIEW_REQUIRED", reasons: ["interviewer statement, not broker commentary"] };
  if (INTERVIEWER_FRAMING.test(text))
    return { status: "REVIEW_REQUIRED", reasons: ["interviewer framing or restated question"] };
  const uncertain = [...observation.inheritedUncertainty, ...firstReason(UNCERTAIN_PATTERNS, text)];
  if (GARBLED_FIGURES.some((pattern) => pattern.test(text)))
    uncertain.push("malformed or ambiguous figures in the transcript");
  if (uncertain.length) return { status: "UNCERTAIN", reasons: [...new Set(uncertain)] };
  const review = firstReason(REVIEW_PATTERNS, text);
  // Broker interviews are never an alternate transaction database: deal
  // terms, rents, prices, and named deal parties stay with governed records.
  if (LEASE_DURATION.test(text) && LEASE_ECONOMICS_CONTEXT.test(text))
    review.push("broker-reported lease term or concession economics; governed lease records are authoritative");
  if (RENT_OR_PRICE_FIGURE.test(text))
    review.push("broker-reported rent or price figure; broker figures are never authoritative");
  if (STREET_ADDRESS.test(text))
    review.push("names a specific property address");
  const named = wordPattern(vocabulary.properNouns);
  if (named?.test(text) && DEAL_CONTEXT.test(text))
    review.push("names a specific company or property in a deal or pricing context");
  if (OWN_DEAL_ANECDOTE.test(text))
    review.push("the interviewee's own listing or deal; governed records are authoritative");
  if (REPORT_META.test(text)) review.push("comments on the report or interview, not the market");
  if (ANSWER_FRAGMENT.test(text) && text.split(/\s+/).length < 12)
    review.push("answer fragment whose meaning depends on the interviewer's question");
  if (containsSalesforceIdToken(text)) review.push("contains a record-identifier-like token");
  if (GOVERNED_STATUS_ASSERTION.test(text))
    review.push("asserts a governed construction/delivery status; governed data is authoritative");
  else if (GOVERNED_METRIC_WORDS.test(text) && GOVERNED_QUANTITY.test(text))
    review.push("states a quantity in a governed-metric domain; governed data is authoritative");
  else if (/\$\s?\d/.test(text))
    review.push("states a price or rent figure; broker figures are never authoritative");
  if (text.split(/\s+/).length < 4) review.push("too short to be a usable observation");
  if (/\?["”]?\s*$/.test(text)) review.push("a question, not an observation");
  if (review.length) return { status: "REVIEW_REQUIRED", reasons: [...new Set(review)] };
  return { status: "PUBLISHABLE", reasons: [] };
}

const OPINION_MARKERS = /\b(?:i think|he thinks|she thinks|he expects|she expects|expects?|believes?|feels?|sees?|called it|in his view|in her view|should|could|might|may|probably|likely)\b|^"|"\s*$/i;

/** Publication-safe statement text: collapse whitespace and drop stray glyphs. */
const cleanStatement = (text: string) =>
  text
    .replace(/[●○■•▪]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2_000);

export interface BuildBrokerInterviewSetInput {
  fileName: string;
  bytes: Uint8Array;
  period: string;
  uploadedAt?: string;
}

export async function buildBrokerInterviewSet(
  input: BuildBrokerInterviewSetInput,
): Promise<BrokerInterviewSet> {
  const { fileType, pages } = await extractBrokerInterviewText(input.fileName, input.bytes);
  return parseBrokerInterviewPages({
    pages,
    fileType,
    fileName: input.fileName,
    fileSha256: createHash("sha256").update(input.bytes).digest("hex"),
    period: input.period,
    uploadedAt: input.uploadedAt ?? new Date().toISOString(),
  });
}

export function parseBrokerInterviewPages(input: {
  pages: ExtractedPage[];
  fileType: BrokerFileType;
  fileName: string;
  fileSha256: string;
  period: string;
  uploadedAt: string;
}): BrokerInterviewSet {
  const speakerNames = new Set<string>();
  const sections = parseSections(toLines(input.pages), speakerNames);
  const properNouns = documentProperNouns(
    sections.flatMap((section) => section.observations.map((item) => cleanStatement(item.statement))),
  );
  speakerNames.forEach((name) => properNouns.delete(name));
  const vocabulary: DocumentVocabulary = { speakerNames, properNouns };
  const warnings: string[] = [];
  const unmatched: BrokerUnmatchedSection[] = [];
  const markets = new Map<string, BrokerMarketContext>();
  const topicCounters = new Map<string, number>();
  for (const section of sections) {
    const preview = section.rawText.join(" ").slice(0, 280);
    if (!section.marketId) {
      if (section.heading === "Preamble") {
        if (section.rawText.length) {
          unmatched.push({ heading: "Preamble", page: section.page, reason: "preamble", preview });
          for (const note of section.rawText)
            if (marketsMentioned(note).size && /\b(?:not captured|waiting|pending|n\/a|not covered|missing)\b/i.test(note))
              warnings.push(`Interview note: ${cleanStatement(note)}`);
        }
      } else {
        unmatched.push({
          heading: section.heading,
          page: section.page,
          reason: section.ambiguous ? "ambiguous_market" : "unrecognized_heading",
          preview,
        });
        warnings.push(
          section.ambiguous
            ? `Section "${section.heading}" names more than one market; it was not attributed to any market and needs review.`
            : `Section "${section.heading}" could not be matched to a report market and needs review.`,
        );
      }
      continue;
    }
    const marketId = section.marketId;
    const existing = markets.get(marketId);
    const market: BrokerMarketContext = existing ?? {
      marketId,
      marketName: MARKET_NAMES.get(marketId) ?? marketId,
      coverage: "not_covered",
      sectionHeadings: [],
      observations: [],
      warnings: [],
    };
    if (existing)
      market.warnings.push(
        `Duplicate section "${section.heading}" was merged into ${market.marketName}; review for repeated or conflicting commentary.`,
      );
    market.sectionHeadings.push(section.heading);
    if (section.relatedMarketIds.length)
      market.warnings.push(
        `Combined interview session with ${section.relatedMarketIds
          .map((id) => MARKET_NAMES.get(id) ?? id)
          .join(", ")}; commentary is attributed only by its own heading.`,
      );
    for (const draft of section.observations) {
      const original = cleanStatement(draft.statement);
      if (!original) continue;
      let { status, reasons } = classify({ ...draft, statement: original }, vocabulary);
      // Interview participants are reviewer-only: a publishable statement is
      // rewritten without them, or held for review when that is not possible.
      let statement = original;
      if (status === "PUBLISHABLE") {
        const sanitized = sanitizeSpeakerNames(original, speakerNames);
        if (sanitized.residual) {
          status = "REVIEW_REQUIRED";
          reasons = ["names an interview participant"];
        } else if (sanitized.text.split(/\s+/).length < 4) {
          status = "REVIEW_REQUIRED";
          reasons = ["too short to be a usable observation once participant names are removed"];
        } else statement = sanitized.text;
      }
      const topic = classifyTopic(statement);
      const counterKey = `${marketId}.${topic}`;
      const index = (topicCounters.get(counterKey) ?? 0) + 1;
      topicCounters.set(counterKey, index);
      market.observations.push({
        contextKey: `broker.${marketId}.${topic}.${index}`,
        marketId,
        topic,
        statement,
        ...(statement !== original ? { sourceStatement: original } : {}),
        publicationStatus: status,
        reasons,
        // Macro and forward-looking views are always broker opinion, never market fact.
        confidence:
          OPINION_MARKERS.test(statement) || MACRO_WORDS.test(statement)
            ? "broker_opinion"
            : "broker_observation",
        speaker: draft.speaker,
        speakerRole: draft.speakerRole,
        question: draft.question,
        page: draft.page,
      });
    }
    if (section.notCovered) {
      if (!market.observations.length)
        market.warnings.push(`${market.marketName} is marked not covered in this interview file.`);
    } else if (market.observations.length) market.coverage = "matched";
    if (
      market.observations.length &&
      market.observations.every((item) => item.publicationStatus === "RESTRICTED")
    )
      market.warnings.push(
        `Every observation for ${market.marketName} is restricted; no broker context will be sent for this market.`,
      );
    markets.set(marketId, market);
  }
  if (!markets.size)
    warnings.push(
      "No recognizable market headings were found. Narratives can still be generated without broker context.",
    );
  const needsReview =
    unmatched.some((item) => item.reason !== "preamble") ||
    [...markets.values()].some((market) => market.warnings.some((warning) => warning.startsWith("Duplicate")));
  return brokerInterviewSetSchema.parse({
    sourceType: BROKER_INTERVIEW_SOURCE_TYPE,
    schemaVersion: BROKER_INTERVIEW_SCHEMA_VERSION,
    sourceFileName: input.fileName.slice(0, 260),
    fileType: input.fileType,
    fileSha256: input.fileSha256,
    uploadedAt: input.uploadedAt,
    period: input.period,
    status: needsReview || !markets.size ? "review_needed" : "ready",
    pageCount: input.pages.length,
    markets: [...markets.values()].sort(
      (left, right) =>
        [...MARKET_NAMES.keys()].indexOf(left.marketId) -
        [...MARKET_NAMES.keys()].indexOf(right.marketId),
    ),
    unmatchedSections: unmatched,
    warnings,
  });
}
