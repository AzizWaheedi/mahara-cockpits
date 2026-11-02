import {
  Globe,
  Mail,
  MessageCircle,
  MessageSquare,
  MessagesSquare,
  Phone,
} from "lucide-react";
import type { InboxChannel } from "../lib/messages";

/**
 * A channel's small mark in its own ink (--ch-*). Instagram and Facebook are
 * drawn here as plain shapes (a rounded square with a lens, a lower-case f):
 * the icon set carries no brand marks.
 */
export function ChannelGlyph({
  channel,
  className = "size-3.5",
  tinted = true,
}: {
  channel: InboxChannel;
  className?: string;
  tinted?: boolean;
}) {
  const color = tinted
    ? `var(--ch-${channel === "call" || channel === "webchat" || channel === "google" ? "sms" : channel})`
    : undefined;
  const style = color ? { color } : undefined;
  if (channel === "instagram")
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        className={className}
        style={style}
        aria-hidden
      >
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" />
      </svg>
    );
  if (channel === "facebook")
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        className={className}
        style={style}
        aria-hidden
      >
        <path d="M15 3.5h-2a3.5 3.5 0 0 0-3.5 3.5v14" />
        <path d="M7 11h7.5" />
      </svg>
    );
  const Icon =
    channel === "whatsapp"
      ? MessageCircle
      : channel === "email"
        ? Mail
        : channel === "call"
          ? Phone
          : channel === "webchat"
            ? MessagesSquare
            : channel === "google"
              ? Globe
              : MessageSquare;
  return <Icon className={className} style={style} aria-hidden />;
}
