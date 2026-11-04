/**
 * How a Hermes answer is read: plain paragraphs, headings, bullet and numbered
 * lists, and **bold** runs. Pure, no React, so the chat panel never needs
 * dangerouslySetInnerHTML and Arabic text keeps its own direction.
 */

export type HermesSpan = { text: string; bold: boolean };

export type HermesBlock =
  | { kind: "paragraph" | "heading"; spans: HermesSpan[] }
  | { kind: "bullets" | "numbered"; items: HermesSpan[][] };

export type AssistantApp = "media-buyer" | "client-success" | "creative";

export const ASSISTANTS: Record<
  AssistantApp,
  { name: string; role: string; intro: string }
> = {
  "media-buyer": {
    name: "Signal",
    role: "Ads assistant",
    intro:
      "I'm Signal. I watch your ads: spend, leads, cost per lead and which ads are getting tired. Ask me about any client or campaign.",
  },
  "client-success": {
    name: "Anchor",
    role: "Client assistant",
    intro:
      "I'm Anchor. I keep track of your clients: their comments, lead sync, open tasks and what to tell them next.",
  },
  creative: {
    name: "Lens",
    role: "Creative assistant",
    intro:
      "I'm Lens. I follow creative requests and which ads and hooks work best, and I help you find new angles.",
  },
};

const BULLET = /^[-*•]\s+/;
const NUMBERED = /^\d+[.)]\s+/;
const HEADING = /^#{1,3} /;
const RULE = /^\s*([-*_])\1{2,}\s*$/;

function parseInline(s: string): HermesSpan[] {
  const spans: HermesSpan[] = [];
  const bold = /\*\*(.+?)\*\*/g;
  let last = 0;
  let match: RegExpExecArray | null = bold.exec(s);
  while (match) {
    if (match.index > last) {
      spans.push({ text: s.slice(last, match.index), bold: false });
    }
    spans.push({ text: match[1], bold: true });
    last = match.index + match[0].length;
    match = bold.exec(s);
  }
  if (last < s.length) spans.push({ text: s.slice(last), bold: false });
  return spans;
}

export function parseHermesText(text: string): HermesBlock[] {
  const blocks: HermesBlock[] = [];
  let kind: "paragraph" | "bullets" | "numbered" | null = null;
  let paragraph: string[] = [];
  let items: string[] = [];

  const flush = () => {
    if (kind === "paragraph" && paragraph.length > 0) {
      blocks.push({
        kind: "paragraph",
        spans: parseInline(paragraph.join("\n")),
      });
    }
    if ((kind === "bullets" || kind === "numbered") && items.length > 0) {
      blocks.push({ kind, items: items.map(parseInline) });
    }
    kind = null;
    paragraph = [];
    items = [];
  };

  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    if (!line.trim()) {
      flush();
      continue;
    }
    if (RULE.test(line)) {
      flush();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({
        kind: "heading",
        spans: parseInline(line.slice(heading[0].length)),
      });
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet) {
      if (kind !== "bullets") flush();
      kind = "bullets";
      items.push(line.slice(bullet[0].length));
      continue;
    }
    const numbered = NUMBERED.exec(line);
    if (numbered) {
      if (kind !== "numbered") flush();
      kind = "numbered";
      items.push(line.slice(numbered[0].length));
      continue;
    }
    if (kind !== "paragraph") flush();
    kind = "paragraph";
    paragraph.push(line);
  }
  flush();
  return blocks;
}

export function hermesSuggestions(
  app: AssistantApp,
  client?: string | null,
): string[] {
  const name = client?.trim() ? client.trim() : null;
  if (app === "media-buyer") {
    return name
      ? [
          `How is ${name} doing this week?`,
          `Which ${name} ad has the best cost per lead?`,
          `Write 3 captions for ${name}'s best ad`,
        ]
      : [
          "Which campaigns need attention today?",
          "Where did cost per lead rise this week?",
          "How are the ads doing today so far?",
        ];
  }
  if (app === "client-success") {
    return name
      ? [
          `Summarise ${name}'s latest updates`,
          `What should I tell ${name} this week?`,
          `Any open tasks for ${name}?`,
        ]
      : [
          "Which clients need a check-in?",
          "Summarise this week's client comments",
          "Which clients have lead sync problems?",
        ];
  }
  return name
    ? [
        `Which ${name} ads are winning?`,
        `Give me 3 new angles for ${name}`,
        `What does ${name} want changed?`,
      ]
    : [
        "Which clients need new creatives?",
        "What creative requests are open?",
        "Give me 3 hook ideas for a design firm",
      ];
}
