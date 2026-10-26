import { useState } from "react";

const guides = [
  { language: "English", id: "5pfkucw6kh", duration: "3:22" },
  { language: "العربية", id: "vtw74gdruq", duration: "3:40" },
];

export function OnboardingGuides() {
  const [notice, setNotice] = useState("");
  async function copy(url: string, language: string) {
    try {
      await navigator.clipboard.writeText(url);
      setNotice(
        `${language} guide link copied. Paste it into your client message.`,
      );
    } catch {
      setNotice("Open the guide and copy its address from your browser.");
    }
  }
  return (
    <section
      className="rounded-xl border bg-card p-4 shadow-sm"
      aria-label="Client setup guides"
    >
      <h3 className="font-semibold">Send before the onboarding call</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        One guide for portal access, Google Calendar and WhatsApp. Ask the
        client to complete the connections before the call and confirm the
        status in their portal.
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        {guides.map(guide => {
          const url = `https://home.wistia.com/medias/${guide.id}`;
          return (
            <div
              key={guide.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2"
            >
              <a
                className="text-sm font-medium text-primary underline underline-offset-4"
                href={url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Watch {guide.language} · {guide.duration}
              </a>
              <button
                type="button"
                className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
                onClick={() => void copy(url, guide.language)}
                aria-label={`Copy ${guide.language} guide link`}
              >
                Copy link
              </button>
            </div>
          );
        })}
      </div>
      <p role="status" className="mt-2 text-xs text-muted-foreground">
        {notice}
      </p>
    </section>
  );
}
