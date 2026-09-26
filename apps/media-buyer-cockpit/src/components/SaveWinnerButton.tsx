import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { ImageOff, Star } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { CreativePreview } from "@/components/CreativePreview";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { metaImageUsable } from "@/lib/metaMedia";
import type { Range } from "@/lib/range";
import { api } from "../../convex/_generated/api";

/**
 * "Save as winner" on one row of the Ads table in Ads management.
 *
 * The weekly check only keeps ads under $15 a lead with at least $100 spent.
 * This lets the media buyer keep an ad she knows is worth reusing, with a line
 * on why. The numbers saved are the ad's own, over the range she is looking
 * at, worked out on the server. [aziz, 2026-09-16]
 */

/** What `winnerSaves.savedIn` says about one ad id. */
export type SavedState = {
  saved: boolean;
  savedBy?: string;
  savedByName?: string;
  savedAt?: number;
  auto: boolean;
};

/** The parts of a range table row this needs. */
export type SaveRow = { key: string; leads: number; adIds?: string[] };

const NOTE_MAX = 500;
const BAR_CPL = 15;
const BAR_SPEND = 100;

const usd = (n: number | undefined) =>
  n === undefined || Number.isNaN(n)
    ? "n/a"
    : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** 1726444800000 -> "16 Sep". */
export function dayLabel(ms: number | undefined): string {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

/** The sentence the server refused with, never a stack trace. */
function serverMessage(e: unknown, fallback: string): string {
  if (e instanceof ConvexError) return String(e.data);
  const msg = e instanceof Error ? e.message : String(e ?? "");
  const m = /Uncaught (?:ConvexError|Error): ([^\n]+)/.exec(msg);
  if (m) return m[1].trim();
  if (/network|fetch|connection|websocket/i.test(msg)) {
    return "The connection dropped before the change was saved. Check What works before trying again.";
  }
  return fallback;
}

const shortId = (id: string) => `ad ...${id.slice(-6)}`;

export function SaveWinnerButton({
  campaignName,
  range,
  row,
  leadsOnly,
  savedIn,
}: {
  campaignName: string;
  range: Range;
  row: SaveRow;
  /** Done With You: leads only, so bookings are left out of the numbers. */
  leadsOnly?: boolean;
  /** One read for the whole table, from CampaignRange. */
  savedIn?: Record<string, SavedState>;
}) {
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const unsave = useMutation(api.winnerSaves.unsave);
  const [busy, setBusy] = useState(false);

  // No leads, no cost per lead: nothing to save. Quiet rows land here too.
  if (!(row.leads > 0)) return null;

  const ids = row.adIds ?? [];
  const savedIds = ids.filter(id => savedIn?.[id]?.saved);
  const inWhatWorks = ids.some(id => savedIn?.[id]?.auto);
  const first = savedIds.length ? savedIn?.[savedIds[0]] : undefined;
  const removingState = removing ? savedIn?.[removing] : undefined;

  const doRemove = async (adId: string) => {
    setBusy(true);
    try {
      const res = await unsave({ adId });
      if (res.changed) toast.success("Removed from the team's saved winners.");
      else toast.info("That ad was not saved any more.");
    } catch (e) {
      toast.error(serverMessage(e, "The server did not remove it."));
    } finally {
      setBusy(false);
      setRemoving(null);
    }
  };

  return (
    <>
      {savedIds.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={busy}
              title={`Saved to What works by ${first?.savedByName ?? "the team"} on ${dayLabel(first?.savedAt)}`}
              className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium disabled:opacity-50"
            >
              <Star className="size-3 shrink-0 fill-current txt-good" />
              Saved
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="text-[12px] font-normal text-muted-foreground">
              {savedIds.length === 1
                ? `Saved by ${first?.savedByName ?? "the team"} on ${dayLabel(first?.savedAt)}`
                : `${savedIds.length} ads with this name are saved`}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {savedIds.map(id => (
              <DropdownMenuItem
                key={id}
                variant="destructive"
                onSelect={() => setRemoving(id)}
              >
                Remove from What works
                {savedIds.length > 1 ? ` (${shortId(id)})` : ""}
              </DropdownMenuItem>
            ))}
            {ids.length > savedIds.length && (
              <DropdownMenuItem onSelect={() => setSaving(true)}>
                Save another ad with this name
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span className="inline-flex items-center gap-1">
          {inWhatWorks && (
            <span
              className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
              title="The weekly check already put this ad in What works. Saving adds the team's note and numbers."
            >
              In What works
            </span>
          )}
          {/* One mark per ad: the chip already says it is a winner, so the
              button next to it carries no second star. */}
          <button
            type="button"
            onClick={() => setSaving(true)}
            title="Keep this ad in What works, with a note on why it works"
            className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {inWhatWorks ? null : <Star className="size-3 shrink-0" />}
            {inWhatWorks ? "Add a note" : "Save as winner"}
          </button>
        </span>
      )}

      {saving && (
        <SaveDialog
          campaignName={campaignName}
          range={range}
          row={row}
          leadsOnly={leadsOnly}
          savedIn={savedIn}
          onClose={() => setSaving(false)}
        />
      )}

      <AlertDialog
        open={removing !== null}
        onOpenChange={open => {
          if (!open && !busy) setRemoving(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove from What works?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove this ad from the team's saved winners? It stays in What
              works only if the weekly check also picked it.
              {removingState?.savedByName
                ? ` Saved by ${removingState.savedByName} on ${dayLabel(removingState.savedAt)}.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={e => {
                e.preventDefault();
                if (removing) void doRemove(removing);
              }}
            >
              {busy ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** The dialog, mounted only while open so its numbers are read only then. */
function SaveDialog({
  campaignName,
  range,
  row,
  leadsOnly,
  savedIn,
  onClose,
}: {
  campaignName: string;
  range: Range;
  row: SaveRow;
  leadsOnly?: boolean;
  savedIn?: Record<string, SavedState>;
  onClose: () => void;
}) {
  const ids = row.adIds ?? [];
  // Several ads with one name: she picks, unless only one is left to save.
  const unsaved = ids.filter(id => !savedIn?.[id]?.saved);
  const [picked, setPicked] = useState<string | undefined>(
    ids.length === 1
      ? ids[0]
      : unsaved.length === 1 && unsaved.length < ids.length
        ? unsaved[0]
        : undefined,
  );
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const save = useMutation(api.winnerSaves.save);
  const p = useQuery(api.winnerSaves.preview, {
    campaignName,
    adName: row.key,
    adIds: ids,
    adId: picked,
    start: range.start,
    end: range.end,
  });

  const adId = p?.adId;
  const pick = p?.candidates.find(c => c.adId === adId);
  const stats = p?.stats;
  const already = adId ? savedIn?.[adId] : undefined;
  const belowBar =
    stats !== undefined &&
    (stats.spend < BAR_SPEND ||
      (stats.cpl !== undefined && stats.cpl > BAR_CPL));
  const showBookings =
    !leadsOnly &&
    stats?.bookingsAttributed === true &&
    stats.bookings !== undefined;
  const blocked =
    !p || Boolean(p.refusal) || Boolean(p.problem) || !adId || !stats;

  const submit = async () => {
    if (!adId || blocked) return;
    setBusy(true);
    try {
      await save({
        campaignName,
        adId,
        adName: row.key,
        start: range.start,
        end: range.end,
        rangeLabel: range.label,
        note: note.trim() || undefined,
      });
      toast.success("Saved to What works.");
      onClose();
    } catch (e) {
      toast.error(serverMessage(e, "The server did not save it."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Save this ad to What works</DialogTitle>
          <DialogDescription className="text-[13px]">
            The team and the creative director will see it on What works, with
            your note and these numbers.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3">
          <CreativePreview
            name={row.key}
            size="lg"
            metaAdId={adId}
            accountId={pick?.accountId}
            stillUrl={pick?.stillUrl}
            stillTinyUrl={pick?.stillTinyUrl}
            thumbUrl={pick?.thumbUrl}
          />
          <div className="min-w-0">
            <div className="break-words text-[14px] font-semibold" dir="auto">
              {row.key}
            </div>
            <div className="text-[12px] text-muted-foreground">
              {campaignName}
            </div>
          </div>
        </div>

        {p === undefined && (
          <p className="text-[13px] text-muted-foreground">
            Working out this ad's numbers...
          </p>
        )}

        {p?.refusal && (
          <p className="rounded border callout-warn px-2.5 py-1.5 text-[13px]">
            {p.refusal}
          </p>
        )}

        {p && !p.refusal && p.candidates.length > 1 && (
          <div className="space-y-2">
            <p className="text-[13px]">
              {p.candidates.length} ads in this campaign use this name. Pick the
              one you mean.
            </p>
            <RadioGroup
              value={adId ?? ""}
              onValueChange={setPicked}
              className="gap-1.5"
            >
              {p.candidates.map(c => {
                const state = savedIn?.[c.adId];
                return (
                  <Label
                    key={c.adId}
                    htmlFor={`pick-${c.adId}`}
                    className="flex cursor-pointer items-center gap-2 rounded border px-2 py-1.5 text-[12px] font-normal hover:bg-muted/50"
                  >
                    <RadioGroupItem value={c.adId} id={`pick-${c.adId}`} />
                    <TinyStill
                      name={c.name}
                      urls={[
                        c.stillTinyUrl,
                        c.stillUrl,
                        // Meta's link can expire while the dialog is open.
                        metaImageUsable(c.thumbUrl) ? c.thumbUrl : undefined,
                      ]}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium tabular-nums">
                        {shortId(c.adId)}
                      </span>
                      <span className="block text-muted-foreground">
                        {c.status
                          ? `${c.live ? "Running" : "Not running"} (${c.status.toLowerCase().replace(/_/g, " ")})`
                          : "Not in Meta's current list"}
                      </span>
                    </span>
                    {state?.saved && (
                      <span className="rounded tone-good px-1.5 py-0.5 text-[10px] font-semibold uppercase">
                        Saved
                      </span>
                    )}
                  </Label>
                );
              })}
            </RadioGroup>
          </div>
        )}

        {p && !p.refusal && !adId && p.candidates.length > 1 && (
          <p className="text-[12px] text-muted-foreground">
            Pick an ad to see its numbers.
          </p>
        )}

        {stats && (
          <div className="rounded border bg-muted/30 px-3 py-2 text-[13px]">
            <div>
              <span className="font-semibold">{range.label}:</span>{" "}
              {usd(stats.spend)} spent, {plural(stats.leads, "lead")},{" "}
              {usd(stats.cpl)} a lead
              {showBookings &&
                `, ${plural(stats.bookings ?? 0, "booking")}${
                  stats.costPerBooking !== undefined
                    ? `, ${usd(stats.costPerBooking)} a booking`
                    : ""
                }`}
            </div>
            <div className="mt-0.5 text-[12px] text-muted-foreground">
              These numbers are saved with the ad and do not change later.
            </div>
          </div>
        )}

        {already?.saved && (
          <p className="text-[12px] text-muted-foreground">
            Already saved by {already.savedByName ?? "the team"} on{" "}
            {dayLabel(already.savedAt)}. Saving again replaces the note and the
            numbers.
          </p>
        )}

        {belowBar && !p?.problem && (
          <p className="rounded border callout-warn px-2.5 py-1.5 text-[12px]">
            This ad is above the usual bar ($15 a lead, at least $100 spent).
            You can still save it.
          </p>
        )}

        {p?.problem && (
          <p className="rounded border callout-warn px-2.5 py-1.5 text-[13px]">
            {p.problem}
          </p>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="winner-note" className="text-[13px]">
            Why it works (optional)
          </Label>
          <Textarea
            id="winner-note"
            value={note}
            maxLength={NOTE_MAX}
            rows={3}
            dir="auto"
            onChange={e => setNote(e.target.value.slice(0, NOTE_MAX))}
            placeholder="For example: the first line names the price, and the video shows the finished room in the first two seconds."
            className="text-[13px]"
          />
          <div className="text-right text-[11px] text-muted-foreground">
            {note.length}/{NOTE_MAX}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={blocked || busy}>
            {busy ? "Saving…" : "Save to What works"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A small still for the picker. Each failed image moves to the next link, and
 * a grey box shows when none loads.
 */
function TinyStill({
  name,
  urls,
}: {
  name: string;
  urls: (string | undefined)[];
}) {
  const list = urls.filter((u): u is string => Boolean(u));
  const [at, setAt] = useState(0);
  const src = list[at];
  if (!src) {
    return (
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-muted ring-1 ring-border"
        title="No saved picture for this ad yet"
      >
        <ImageOff className="h-3.5 w-3.5 text-muted-foreground" />
      </span>
    );
  }
  return (
    <img
      key={src}
      src={src}
      alt={name}
      loading="lazy"
      decoding="async"
      onError={() => setAt(i => i + 1)}
      className="h-8 w-8 shrink-0 rounded object-cover ring-1 ring-border"
    />
  );
}
