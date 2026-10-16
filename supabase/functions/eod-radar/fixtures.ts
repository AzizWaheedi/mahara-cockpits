/**
 * Test-only: the post shapes the five EOD channels carried in October 2026,
 * with the answers cut down. Headers, Date, Name and Submitted by lines, the
 * posters and the bot ids are as Slack returned them; the people are the
 * roster's. index.ts never imports this.
 */
import type { Person } from "./match.ts";
import type { SlackMessage } from "./parse.ts";

export const CH = {
  tech: "C0AS90M9SN6",
  media: "C0AQ2LD0PL1",
  csms: "C09RQS2TFST",
  sales: "C0AF5PJEAUX",
  csr: "C09R4QJCZ5Y",
} as const;

/** Slack ts of a Kuwait wall-clock time: "2026-10-14 12:17" -> "1791971820.000100". */
export const tsAt = (kuwait: string, micro = "000100") => `${(Date.parse(`${kuwait.replace(" ", "T")}:00Z`) - 3 * 3600_000) / 1000}.${micro}`;

const MAKE = { user: "U0925Q9RT9C", bot_id: "B0925UM8VUN" };
const CLUB = { user: "U0C0MJZNS2Y", bot_id: "B0C02J2D37H" };
const SECOND = { user: "U0BTL0GH79N", bot_id: "B0BSPLUNH9U" };

const LONG = "Shades: three template ads delivered and approved. Madan: main video at eighty percent, colour pass tomorrow. City Wood: first cut sent for review with the new logo and typography as agreed in the meeting.";

/** Make, video editor, posted the next day with the EOD's own Date line. */
export const makeNextDay: SlackMessage = {
  ...MAKE, ts: tsAt("2026-10-14 12:17"),
  text: `*VIDEO EDITOR EOD*\n*Date - 13-10-2026*\n\n*Name - Ali*\nSubmitted by: <@U0C69400F1U>\n\n*OUTPUT*\nVideos completed today (count + client + delivery link) - ${LONG}\n\n*BLOCKERS*\nNone today\n\n*TOMORROW'S PLAN*\nFinish the Madan cut.`,
};

/** Make, systems manager: the Date line opens a bold it never closes. */
export const makeUnclosedDate: SlackMessage = {
  ...MAKE, ts: tsAt("2026-10-14 22:27"),
  text: `*SYSTEMS MANAGER EOD*\n*Date - 14-10-2026\n\n*Name - Muhammed Burhan*\nSubmitted by: <@U0AS90SHMH8>\n\n*HEALTH*\nFocus - 6\nEnergy - 6\n\n*DAILY WRAP UP*\nSummary of today - ${LONG}\n\n*ADDITIONAL NOTES*\nWins From Today - --\n1% improvement - --`,
};

/** Make, the CSR form: "*Name:* Daniya", 40 words, Wins left as ".". */
export const makeCsr: SlackMessage = {
  ...MAKE, ts: tsAt("2026-10-14 18:28"),
  text: "*CSR EOD:rocket:*\n*Date - 14-10-2026*\n\n*Name:* Daniya\nSubmitted by: <@U0ANNBCT3B3>\n*Energy 1-10:* 9\n*Biology 1-10:* 9\n*Focus 1-10:* 8\n\n*Outbound Dials Made:* 31\n*Time Spent Dialling:* 8\n*Appointments Booked:* 3\n\n*Wins:* .\n\n*How Can You (Or The Company) Improve?* .",
};

/** Make with a fallback Submitted by: Saleh's id (a deleted member) on Rasem's EOD. */
export const makeWrongSubmitter: SlackMessage = {
  ...MAKE, ts: tsAt("2026-10-10 17:52"),
  text: `*CLIENT SUCCESS EOD*\n*Date - 10-10-2026\n\n*Name - Rasem Abdel All*\nSubmitted by: <@U09SHBK2C9F>\n\n*CALL SUMMARY*\n${LONG}`,
};

/** Make: the second half of a long EOD, no header and no name. */
export const makeContinuation: SlackMessage = {
  ...MAKE, ts: tsAt("2026-10-12 19:26", "341619"),
  text: `Schedule Review Calls: set up a weekly review call. ${LONG}`,
};

/** Make: a test submission. */
export const makeTest: SlackMessage = {
  ...MAKE, ts: tsAt("2026-10-10 13:58"),
  text: "*VIDEO EDITOR EOD*\n*Date - 10-10-2026*\n\n*Name - Ali*\nSubmitted by: <@U0C69400F1U>\n\n*OUTPUT*\nVideos completed today (count + client + delivery link) - [TEST SUBMISSION] 0 - test only\n\n*DAY SUMMARY*\n[TEST SUBMISSION] Checking the Slack mention for Ali. Please ignore.",
};

/** The cockpit outbox through mahara-club-bot: ISO Date line, Submitted by from the seat. */
export const outboxClub: SlackMessage = {
  ...CLUB, ts: "1791971404.316399",
  text: "*SALES REP EOD*\n*Date - 2026-10-13*\n\n*Name - Ahmed Abushaiba*\nSubmitted by: <@U0B665Z7WCQ>\n\n*Today's Numbers*\nSlots available - 3\nDemos scheduled - 3\n\n*Objections*\n.\n\n*Day Summary*\n.\n\n_Filed in the sales cockpit._",
};

/** The cockpit outbox through the VPS worker, before the seat had a Slack id. */
export const outboxNoId: SlackMessage = {
  ...SECOND, ts: "1791572104.421879",
  text: "*SALES REP EOD*\n*Date - 2026-10-08*\n\n*Name - Ahmed Abushaiba*\nSubmitted by: Ahmed Abushaiba (no Slack id on their cockpit seat)\n\n*Today's Numbers*\nSlots available - 0\nDemos showed - 1",
};

/** The cockpit outbox, CSM form: the row names its channel "#eods-csms"; Slack has the post in its id. */
export const outboxCsm: SlackMessage = {
  ...CLUB, ts: tsAt("2026-10-14 20:05", "412233"),
  text: "*CSM EOD*\n*Date - 2026-10-14*\n\n*Name - Rasem Abdel All*\nSubmitted by: <@U0C5JHUCTPG>\n\n*HEALTH*\nEnergy - 8\nStress - 3\n\n*CALLS*\nThree onboarding calls held.",
};

/** A person's own message: no bot, no form. */
export const selfPosted: SlackMessage = {
  user: "U0AJQ8P1ACF", ts: tsAt("2026-10-14 21:40"),
  text: `Today: ${LONG} Tomorrow: relaunch Castello once the card is topped up. Blockers: the Visa has no balance.`,
};

/** A mention in an EOD channel, not an EOD. */
export const mention: SlackMessage = { user: "U0AS90SHMH8", ts: tsAt("2026-10-14 12:34"), text: "<@U0C69400F1U>" };
/** A manager's note in another team's EOD channel (Muhammed in #media-eods, 14 Oct 12:34): chat, not his EOD. */
export const managerNote: SlackMessage = { user: "U0AS90SHMH8", ts: tsAt("2026-10-14 12:34", "300000"), text: "<@U0C69400F1U> please post your EOD in this channel, not in DM" };
/** A promise in one's own EOD channel: says "EOD", is not one. */
export const eodLater: SlackMessage = { user: "U0B19NM24AD", ts: tsAt("2026-10-14 21:00"), text: "Will send my EOD later tonight, still exporting" };
/** A short EOD of one's own: an "EOD" first line and three lines under it. */
export const shortOwnEod: SlackMessage = { user: "U0B19NM24AD", ts: tsAt("2026-10-14 21:30"), text: "EOD 14 Oct\n- Madan cut sent\n- City Wood colour pass\n- Shades thumbnails" };
export const join: SlackMessage = { user: "U0C69400F1U", subtype: "channel_join", ts: tsAt("2026-10-14 12:34", "200000"), text: "<@U0C69400F1U> has joined the channel" };

/** A video editor's EOD signed with a first name three people share. */
export const ahmedOnly = (header: string): SlackMessage => ({
  ...MAKE, ts: tsAt("2026-10-14 20:10"),
  text: `*${header} EOD*\n*Date - 14-10-2026*\n\n*Name - Ahmed*\nSubmitted by: <@U09SHBK2C9F>\n\n*OUTPUT*\n${LONG}`,
});

/** The roster on 2026-10-15, with each role's EOD channel. */
export const PEOPLE: Person[] = [
  { personId: 4, name: "Ahmed Abusahiba", email: "ahmedabushaiba@maharamedia.com", role: "Closer", channel: CH.sales, channelName: "eods-salesreps", slackUserId: "U0B665Z7WCQ" },
  { personId: 7, name: "Daniya Ziad", email: "daniyaziad@maharamedia.com", role: "Call centre agent", channel: CH.csr, channelName: "eods-csr", slackUserId: "U0ANNBCT3B3" },
  { personId: 11, name: "Karim Abdelrahman", email: "karim@maharamedia.com", role: "Video editor", channel: CH.media, channelName: "media-eods", slackUserId: "U0B19NM24AD" },
  { personId: 12, name: "Lama Harb", email: "lamah@maharamedia.com", role: "Call centre agent", channel: CH.csr, channelName: "eods-csr", slackUserId: "U09SF7GUEHY" },
  { personId: 18, name: "Muhammed Burhan", email: "muhammedburhan@maharamedia.com", role: "Systems manager", channel: CH.tech, channelName: "tech-eods", slackUserId: "U0AS90SHMH8" },
  { personId: 19, name: "Nada Al Saed", email: "nada@maharamedia.com", role: "Media buyer", channel: CH.media, channelName: "media-eods", slackUserId: "U0AJQ8P1ACF" },
  { personId: 21, name: "Ahmed Sabry", email: "sabry@maharamedia.com", role: "Creative strategist", channel: CH.media, channelName: "media-eods", slackUserId: "U0B2SHGS1JA" },
  { personId: 26, name: "Ali", email: null, role: "Video editor", channel: CH.media, channelName: "media-eods", slackUserId: "U0C69400F1U" },
  { personId: 27, name: "Ahmed", email: null, role: "Video editor", channel: CH.media, channelName: "media-eods", slackUserId: null },
  { personId: 28, name: "Rasem Abdel All", email: "rasem@maharamedia.com", role: "Client success manager", channel: CH.csms, channelName: "eods-csms", slackUserId: "U0C5JHUCTPG" },
];
export const person = (id: number) => PEOPLE.find(p => p.personId === id)!;
