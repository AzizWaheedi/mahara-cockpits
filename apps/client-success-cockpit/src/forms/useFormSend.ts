import { useEffect, useState } from "react";
import { type FormClient, readFormSends } from "./formClient";
import type { FormKey, FormSend } from "./formConfig";
import { useFormNews } from "./OpenFormButton";

/**
 * The newest send of one form for one client, as the cockpit noted it
 * (cockpit_csm_form_sends_read), read again whenever a form window says it
 * sent or checked that client. One read serves the client page's header and
 * its Onboarding panel, so the two never disagree. Null while unread, when
 * there is none, or when the read fails (the record is still the record).
 */
export function useFormSend(
  client: FormClient | null,
  taskId: string | null,
  form: FormKey,
): FormSend | null {
  const [found, setFound] = useState<{
    taskId: string;
    send: FormSend | null;
  } | null>(null);
  const [news, setNews] = useState(0);
  useFormNews(n => {
    if (n.taskId === taskId && n.form === form) setNews(x => x + 1);
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: news only asks for a fresh read
  useEffect(() => {
    if (!client || !taskId) return;
    let on = true;
    readFormSends(client, taskId, form).then(
      r => on && setFound({ taskId, send: r.sends[0] ?? null }),
      () => on && setFound({ taskId, send: null }),
    );
    return () => {
      on = false;
    };
  }, [client, taskId, form, news]);
  return found && found.taskId === taskId ? found.send : null;
}
