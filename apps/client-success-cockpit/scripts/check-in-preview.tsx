/** Local-only visual acceptance harness. No CRM connection or real client records. */
import React from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import { ClientCheckInCard } from "../src/components/ClientCheckIn";
import { CALLS, type CallKind } from "../src/lib/checkInCore";
import "../src/index.css";

const contact = { id: "fictional-contact", name: "Omar, Example Design", phone: null, email: null, url: "https://example.com/contact" };
const prepare = async ({ day, kind }: { day: string; kind: CallKind }) => ({
  contact,
  calendar: { id: "fictional-calendar", name: CALLS[kind].label, minutes: 30, kind, label: CALLS[kind].label },
  kind,
  slots: ["10:00", "10:30", "11:00", "13:00", "13:30", "15:00"].map(
    time => `${day}T${time}:00+03:00`,
  ),
  day,
  timezone: "Asia/Kuwait" as const,
});
const book = async ({ startTime }: { startTime: string }) => ({
  appointmentId: "fictional-receipt",
  startTime,
});
function Preview() {
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 py-10 sm:p-10">
      <p className="text-xs text-muted-foreground">
        Local preview · Fictional data · No invitations sent
      </p>
      <div>
        <p className="text-sm text-muted-foreground">
          Clients / Example Design
        </p>
        <h1 className="mt-3 text-2xl font-semibold">Example Design</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Active · Full service
        </p>
      </div>
      <ClientCheckInCard
        taskId="86example1"
        clientName="Example Design"
        prepare={prepare}
        book={book}
        loadContact={async () => contact}
      />
      <div className="rounded-xl border p-6">
        <h2 className="font-medium">Client performance</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The booking and client ID controls sit above the existing client
          details.
        </p>
      </div>
      <Toaster />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Preview />
  </React.StrictMode>,
);
