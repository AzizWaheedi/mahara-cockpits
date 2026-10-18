import { Loader2 } from "lucide-react";
import { useId, useState } from "react";
import { daysInMonth } from "@/components/ceo/format";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, useAction } from "@/lib/cockpitApi";
import { cn } from "@/lib/utils";
import { lowerFirst, type Part, type PayEntry } from "@/types/ceo/payPlan";
import { errorText, FIELD, LABEL, NumberBox } from "./fields";
import { entryShape, monthName } from "./payCopy";

/**
 * "Add a count" (PAY-PLANS.md 8.5): one audited entry for what the data
 * cannot see, typed by the CEO. What it asks follows the part: a count, or
 * cash with the month of the engagement, and for renewals, reactivations,
 * upsells, recurring services and referrals the client, the day the payment
 * cleared (in the month) and the payment or signed contract it rests on
 * (decision 8). An adjustment is a signed amount with a note, and says the
 * approved month it corrects. The server checks it all again and its
 * sentence is shown as said ("Cleared on 3 Nov: add it to November.").
 */

export type EntryTarget = {
  person: { personId: number; name: string };
  /** The month the entry counts in, "YYYY-MM". */
  month: string;
  /** The plan part, or "adjustment". */
  part: Part | "adjustment";
  /** Pre-filled values: a clawback's −1, drift's amount and note. */
  preset?: Partial<EntryDraft>;
};

type EntryDraft = {
  quantity: number;
  cashUsd: number;
  amountUsd: number;
  engagementMonth: number;
  client: string;
  product: string;
  clearedOn: string;
  postedOn: string;
  cancelledOn: string;
  evidenceRef: string;
  evidence: string;
  note: string;
  /** The approved month an adjustment corrects, "YYYY-MM". */
  fromMonth: string;
};

const blank: EntryDraft = {
  quantity: 1,
  cashUsd: Number.NaN,
  amountUsd: Number.NaN,
  engagementMonth: 1,
  client: "",
  product: "",
  clearedOn: "",
  postedOn: "",
  cancelledOn: "",
  evidenceRef: "",
  evidence: "",
  note: "",
  fromMonth: "",
};

/** What the dialog would send, or the first thing missing as a sentence. */
export function entryPayload(
  target: EntryTarget,
  d: EntryDraft,
): { payload: Record<string, unknown> } | { problem: string } {
  const shape = entryShape(target.part);
  const month = target.month.slice(0, 7);
  const inMonth = (day: string) => day.slice(0, 7) === month;
  const out: Record<string, unknown> = {
    personId: target.person.personId,
    month,
    partKey: target.part === "adjustment" ? "adjustment" : target.part.key,
  };
  const text = (k: keyof EntryDraft) => String(d[k] ?? "").trim();
  if (shape.kind === "adjustment") {
    if (!Number.isFinite(d.amountUsd) || d.amountUsd === 0)
      return { problem: "Type the amount: plus to add, minus to take back." };
    if (!text("note")) return { problem: "Say what the adjustment is for." };
    out.amountUsd = d.amountUsd;
    if (text("fromMonth")) out.fromMonth = text("fromMonth").slice(0, 7);
  } else if (shape.kind === "count") {
    if (!Number.isInteger(d.quantity))
      return { problem: "Type the count as a whole number." };
    if (d.quantity < 0 && !text("note"))
      return {
        problem: "A count below zero takes one back: say why in the note.",
      };
    out.quantity = d.quantity;
  } else {
    if (!Number.isFinite(d.cashUsd) || d.cashUsd < 0)
      return { problem: "Type the cash, in dollars." };
    out.cashUsd = d.cashUsd;
    if (shape.engagement) {
      if (!Number.isInteger(d.engagementMonth) || d.engagementMonth < 1)
        return { problem: "Say which month of the engagement it is, from 1." };
      out.engagementMonth = d.engagementMonth;
    }
  }
  // As cockpit_ceo_pay_entry_save: a share that ends is matched by client at
  // any amount; the general conditions bind only a count or cash that is not 0.
  if (shape.client && !text("client")) return { problem: "Name the client." };
  const amount =
    shape.kind === "count"
      ? d.quantity
      : shape.kind === "cash"
        ? d.cashUsd
        : d.amountUsd;
  if (shape.conditions && amount !== 0) {
    if (!text("client")) return { problem: "Name the client." };
    if (!text("clearedOn"))
      return { problem: "Pick the day the payment cleared." };
    if (!inMonth(text("clearedOn")))
      return {
        problem: `It cleared outside ${monthName(month)}: add it to the month it cleared.`,
      };
    if (!text("evidenceRef"))
      return {
        problem: "Add the payment id or the signed contract it rests on.",
      };
  }
  // A review taken down (a count below zero) needs no link: the note says why.
  if (shape.review && d.quantity > 0) {
    if (!text("evidence")) return { problem: "Paste the link to the review." };
    if (!text("postedOn")) return { problem: "Pick the day it was posted." };
  }
  for (const k of [
    "client",
    "product",
    "clearedOn",
    "postedOn",
    "cancelledOn",
    "evidenceRef",
    "evidence",
    "note",
  ] as const)
    if (text(k)) out[k] = text(k);
  return { payload: out };
}

export function PayEntryDialog({
  target,
  onClose,
  onDone,
}: {
  target: EntryTarget | null;
  onClose: () => void;
  /** Called with the sentence the card says after: "Added: 2 renewals for October." */
  onDone: (said: string) => Promise<void> | void;
}) {
  return (
    <Dialog open={target !== null} onOpenChange={o => (o ? null : onClose())}>
      <DialogContent className="ceo-root max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        {target ? (
          <EntryForm
            key={`${target.person.personId}-${target.month}-${target.part === "adjustment" ? "adjustment" : target.part.key}`}
            target={target}
            onClose={onClose}
            onDone={onDone}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function EntryForm({
  target,
  onClose,
  onDone,
}: {
  target: EntryTarget;
  onClose: () => void;
  onDone: (said: string) => Promise<void> | void;
}) {
  const save = useAction(api.ceo.pay.entry);
  const id = useId();
  const [d, setD] = useState<EntryDraft>({ ...blank, ...target.preset });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const shape = entryShape(target.part);
  const month = target.month.slice(0, 7);
  const first = `${month}-01`;
  const last = `${month}-${String(daysInMonth(month) ?? 28).padStart(2, "0")}`;
  const set = (patch: Partial<EntryDraft>) => setD(v => ({ ...v, ...patch }));
  const label =
    target.part === "adjustment" ? "An adjustment" : target.part.label;
  const verb =
    shape.kind === "adjustment"
      ? "Add the adjustment"
      : shape.kind === "cash"
        ? "Add the cash"
        : "Add the count";

  const submit = async () => {
    const built = entryPayload(target, d);
    if ("problem" in built) {
      setMsg(built.problem);
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await save(built.payload);
      onClose();
      await onDone(
        `Added to ${target.person.name}'s ${monthName(month)}: ${lowerFirst(label)}.`,
      );
    } catch (e) {
      setMsg(errorText(e, "The entry was not saved."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="grid gap-4"
      onSubmit={e => {
        e.preventDefault();
        void submit();
      }}
    >
      <DialogHeader className="pr-8">
        <DialogTitle>{`${label} for ${target.person.name}`}</DialogTitle>
        <DialogDescription>
          {shape.kind === "adjustment"
            ? `Counts in ${monthName(month)}${d.fromMonth ? `, correcting ${monthName(d.fromMonth)}` : ""}. Kept with your note; remove it later if it was wrong.`
            : `Counts in ${monthName(month)}. Each entry is kept with who typed it; remove one later if it was wrong.`}
        </DialogDescription>
      </DialogHeader>

      {shape.kind === "adjustment" ? (
        <Field label="Amount">
          <NumberBox
            value={d.amountUsd}
            onChange={amountUsd => set({ amountUsd })}
            label="Adjustment amount in dollars"
            prefix="$"
            width="w-28"
          />
          <span className="text-xs text-muted-foreground">
            Minus takes money back.
          </span>
        </Field>
      ) : shape.kind === "count" ? (
        <Field label="How many">
          <NumberBox
            value={d.quantity}
            onChange={quantity => set({ quantity })}
            label={`How many for ${label}`}
            width="w-20"
            integer
          />
          <span className="text-xs text-muted-foreground">
            −1 takes one back, with a note.
          </span>
        </Field>
      ) : (
        <div className="flex flex-wrap gap-4">
          <Field label="Cash">
            <NumberBox
              value={d.cashUsd}
              onChange={cashUsd => set({ cashUsd })}
              label={`Cash for ${label}`}
              prefix="$"
              width="w-28"
            />
          </Field>
          {shape.engagement ? (
            <Field label="Month of the engagement">
              <NumberBox
                value={d.engagementMonth}
                onChange={engagementMonth => set({ engagementMonth })}
                label="Month of the engagement"
                width="w-16"
                integer
              />
            </Field>
          ) : null}
        </div>
      )}

      {shape.conditions || shape.product ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            id={`${id}-client`}
            label={
              shape.client || shape.conditions ? "Client" : "Client (optional)"
            }
            value={d.client}
            onChange={client => set({ client })}
            placeholder="Client A"
          />
          {shape.product ? (
            <TextField
              id={`${id}-product`}
              label="Product"
              value={d.product}
              onChange={product => set({ product })}
              placeholder="Website build"
            />
          ) : null}
        </div>
      ) : null}

      {shape.conditions ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Payment cleared on">
            <DateInput
              value={d.clearedOn}
              min={first}
              max={last}
              onChange={e => set({ clearedOn: e.target.value })}
              aria-label="The day the payment cleared"
              className="ceo-select-md w-full"
            />
          </Field>
          <TextField
            id={`${id}-ref`}
            label="Payment id or signed contract"
            value={d.evidenceRef}
            onChange={evidenceRef => set({ evidenceRef })}
            placeholder="whop:pay_… or the contract id"
          />
        </div>
      ) : null}

      {shape.review ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            id={`${id}-link`}
            label="Link to the review"
            value={d.evidence}
            onChange={evidence => set({ evidence })}
            placeholder="https://"
          />
          <Field label="Posted on">
            <DateInput
              value={d.postedOn}
              max={last}
              onChange={e => set({ postedOn: e.target.value })}
              aria-label="The day the review was posted"
              className="ceo-select-md w-full"
            />
          </Field>
        </div>
      ) : null}

      {shape.cancel ? (
        <Field label="Client cancelled on (optional)">
          <DateInput
            value={d.cancelledOn}
            onChange={e => set({ cancelledOn: e.target.value })}
            aria-label="The day the client cancelled"
            className="ceo-select-md w-48"
          />
        </Field>
      ) : null}

      <TextField
        id={`${id}-note`}
        label={
          shape.kind === "adjustment" || d.quantity < 0
            ? "Note"
            : "Note (optional)"
        }
        value={d.note}
        onChange={note => set({ note })}
        placeholder={
          shape.kind === "adjustment"
            ? "What it corrects"
            : "Anything worth keeping with it"
        }
      />

      {msg ? (
        <p role="alert" className="text-sm text-[var(--ceo-critical)]">
          {msg}
        </p>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {verb}
        </Button>
      </DialogFooter>
    </form>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1">
      <span className={LABEL}>{label}</span>
      <span className="flex flex-wrap items-center gap-2">{children}</span>
    </div>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label htmlFor={id} className="grid gap-1">
      <span className={LABEL}>{label}</span>
      <input
        id={id}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(FIELD, "w-full")}
        maxLength={300}
      />
    </label>
  );
}

/** Remove an entry: it is kept, voided, with why. */
export function VoidEntryDialog({
  entry,
  label,
  onClose,
  onDone,
}: {
  entry: PayEntry | null;
  /** The part it was for, in words. */
  label: string;
  onClose: () => void;
  onDone: (said: string) => Promise<void> | void;
}) {
  const voidEntry = useAction(api.ceo.pay.voidEntry);
  const id = useId();
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <Dialog
      open={entry !== null}
      onOpenChange={o => {
        if (!o) {
          setWhy("");
          setMsg(null);
          onClose();
        }
      }}
    >
      <DialogContent className="ceo-root sm:max-w-md">
        <form
          className="grid gap-4"
          onSubmit={async e => {
            e.preventDefault();
            if (!entry) return;
            if (why.trim().length < 3) {
              setMsg("Say why, in a few words.");
              return;
            }
            setBusy(true);
            setMsg(null);
            try {
              await voidEntry({ id: entry.id, reason: why.trim() });
              setWhy("");
              onClose();
              await onDone(`Removed the ${lowerFirst(label)} entry.`);
            } catch (err) {
              setMsg(errorText(err, "The entry was not removed."));
            } finally {
              setBusy(false);
            }
          }}
        >
          <DialogHeader className="pr-8">
            <DialogTitle>{`Remove this ${lowerFirst(label)} entry`}</DialogTitle>
            <DialogDescription>
              It stops counting and is kept, marked removed, with your reason.
            </DialogDescription>
          </DialogHeader>
          <label htmlFor={`${id}-why`} className="grid gap-1">
            <span className={LABEL}>Why</span>
            <input
              id={`${id}-why`}
              value={why}
              onChange={e => setWhy(e.target.value)}
              placeholder="Typed twice"
              className={cn(FIELD, "w-full")}
              maxLength={300}
            />
          </label>
          {msg ? (
            <p role="alert" className="text-sm text-[var(--ceo-critical)]">
              {msg}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Remove the entry
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
