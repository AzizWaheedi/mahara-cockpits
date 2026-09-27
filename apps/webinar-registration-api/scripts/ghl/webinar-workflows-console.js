// Run in the GHL workflow-builder console frame. Browser session stays in-browser.
// AUDIT_ONLY=true reads all published workflows + WEBBY drafts. It changes nothing.
// After reviewing the report, set AUDIT_ONLY=false to create ONE internal-only DRAFT.
// It never edits existing workflows, publishes, enrolls contacts, or sends messages.
(async () => {
  const AUDIT_ONLY = true;
  const LOC = "7NI8yyJtwsh2OOWA5Icr",
    BASE = "https://backend.leadconnectorhq.com";
  const NAME = "WEBBY - P1 Reconcile Webinar Journey",
    FOLDER = "WEBBY | Pipeline Sync";
  const out = {
    version: 3,
    at: new Date().toISOString(),
    location: LOC,
    audit: [],
    complete: false,
  };
  const safe = (value) =>
    String(value ?? "")
      .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[redacted]")
      .replace(/EAA[\w-]+/g, "[redacted]")
      .replace(/token=[^&\s]+/g, "token=[redacted]");
  function download() {
    const a = document.createElement("a"),
      url = URL.createObjectURL(
        new Blob([JSON.stringify(out, null, 2)], { type: "application/json" }),
      );
    a.href = url;
    a.download = "webinar-workflow-result.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  try {
    const looksLikeGhlJwt = (s) => {
      try {
        if (typeof s !== "string" || s.split(".").length !== 3) return false;
        const p = JSON.parse(
          atob(s.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
        );
        return p.aud === "highlevel-backend" && p.exp * 1000 > Date.now();
      } catch {
        return false;
      }
    };
    let token = await new Promise((res) => {
      let r;
      try {
        r = indexedDB.open("firebaseLocalStorageDb");
      } catch {
        return res(null);
      }
      r.onerror = () => res(null);
      r.onsuccess = () => {
        try {
          const all = r.result
            .transaction("firebaseLocalStorage", "readonly")
            .objectStore("firebaseLocalStorage")
            .getAll();
          all.onsuccess = () => {
            for (const row of all.result) {
              const t = row?.value?.stsTokenManager?.accessToken;
              if (t) return res(t);
            }
            res(null);
          };
          all.onerror = () => res(null);
        } catch {
          res(null);
        }
      };
    });
    if (!looksLikeGhlJwt(token))
      throw new Error(
        "Sign in and select the client-app-automation-workflows console frame.",
      );
    const H = {
      "token-id": token,
      channel: "APP",
      source: "WEB_USER",
      version: "2021-04-15",
      "Content-Type": "application/json",
    };
    async function api(method, path, body) {
      const r = await fetch(BASE + path, {
        method,
        headers: H,
        redirect: "error",
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!r.ok)
        throw new Error(
          `GHL HTTP ${r.status}; stop and inspect before rerunning`,
        );
      return r.json();
    }
    async function list() {
      const rows = [],
        seen = new Set();
      for (let offset = 0; offset < 10000; offset += 100) {
        const x = await api(
          "GET",
          `/workflow/${LOC}/list?limit=100&offset=${offset}`,
        );
        if (!Array.isArray(x.rows)) throw new Error("Workflow list incomplete");
        for (const r of x.rows) {
          const id = r._id || r.id;
          if (!id || seen.has(id))
            throw new Error("Workflow pagination changed");
          seen.add(id);
          rows.push(r);
        }
        if (x.rows.length < 100) return rows;
      }
      throw new Error("Workflow list exceeds audit bound");
    }
    function workflowSteps(w) {
      if (Array.isArray(w.workflowData?.templates))
        return w.workflowData.templates;
      // GHL omits workflowData for a newly created, empty draft. Only our
      // exact internal workflow may be initialized; unknown graphs stay held.
      if (
        w.name === NAME &&
        w.status === "draft" &&
        (w.workflowData == null ||
          (typeof w.workflowData === "object" &&
            !Array.isArray(w.workflowData) &&
            Object.keys(w.workflowData).length === 0))
      )
        return [];
      out.workflowShape = {
        id: w.id || w._id,
        name: safe(w.name),
        status: w.status,
        keys: Object.keys(w),
        dataKeys: Object.keys(w.workflowData || {}),
      };
      throw new Error("Unknown workflow graph shape; left unchanged");
    }
    const rows = await list();
    for (const row of rows.filter(
      (r) =>
        r.type !== "directory" &&
        (r.status === "published" || /^WEBBY/i.test(r.name)),
    )) {
      const id = row._id || row.id,
        w = await api("GET", `/workflow/${LOC}/${id}`),
        t = await api("GET", `/workflow/${LOC}/trigger?workflowId=${id}`);
      if (!Array.isArray(t)) throw new Error("Workflow body incomplete");
      const steps = workflowSteps(w);
      // Allowlisted structural fields only. No message copy, bodies, headers, keys or contact records.
      out.audit.push({
        id,
        name: safe(w.name || row.name),
        status: w.status,
        version: w.version,
        allowMultiple: w.allowMultiple,
        stepCounts: steps.reduce(
          (a, s) => ((a[s.type] = (a[s.type] || 0) + 1), a),
          {},
        ),
        pipelineTargets: steps
          .filter((s) => s.attributes?.pipeline_id)
          .map((s) => ({
            pipeline: s.attributes.pipeline_id,
            stage: s.attributes.pipeline_stage_id,
          })),
        triggers: t.map((t) => ({
          id: t.id,
          type: t.type,
          active: t.active,
          conditions: (t.conditions || []).map((c) => ({
            field: safe(c.field),
            operator: safe(c.operator),
            value: [
              "calendar.id",
              "form.id",
              "appointment.status",
              "appointment.eventType",
              "pipeline.id",
              "pipeline_stage.id",
              "opportunity.pipelineId",
              "opportunity.pipelineStageId",
              "opportunity.status",
              "contactMode",
              "appointment.modifiedBy",
              "tagsAdded",
            ].includes(c.field)
              ? safe(JSON.stringify(c.value))
              : "[not exported]",
          })),
        })),
      });
    }
    out.auditComplete = true;
    if (AUDIT_ONLY) {
      out.complete = true;
      out.result = "audit_only";
      download();
      console.log("Webinar workflow audit downloaded. No changes made.");
      return;
    }
    let folder = rows.filter(
      (r) => r.name === FOLDER && r.type === "directory",
    );
    if (folder.length > 1) throw new Error("Duplicate folder names");
    if (!folder.length) {
      const r = await api("POST", `/workflow/${LOC}`, {
        name: FOLDER,
        type: "directory",
      });
      folder = [r];
    }
    const parentId = folder[0]._id || folder[0].id;
    if (!parentId) throw new Error("Folder receipt missing");
    let matches = rows.filter((r) => r.name === NAME);
    if (matches.length > 1) throw new Error("Duplicate workflow names");
    let id = matches[0]?._id || matches[0]?.id;
    if (!id) {
      const created = await api("POST", `/workflow/${LOC}`, {
        name: NAME,
        type: "workflow",
        parentId,
        status: "draft",
      });
      id = created._id || created.id;
    }
    if (!id)
      throw new Error(
        "Workflow create receipt missing; read list before retrying",
      );
    let w = await api("GET", `/workflow/${LOC}/${id}`);
    if (w.status !== "draft")
      throw new Error("Existing workflow is not draft; left unchanged");
    const expected = {
      event: "CUSTOM",
      method: "POST",
      url: "https://webby-live-training.vercel.app/api/ghl-pipeline",
      body: {
        contentType: "application/json",
        rawData: JSON.stringify({
          location_id: LOC,
          contact_id: "{{contact.id}}",
        }),
        keyValueData: [],
      },
      headers: [],
      parameters: [],
      authorization: {
        type: "API_KEY",
        data: {
          key: "Authorization",
          value: "Bearer {{ custom_values.webby_pipeline_secret }}",
          passBy: "headers",
        },
      },
      saveResponse: false,
      webhookResponse: { selectedContact: "" },
    };
    out.draft = { id, name: NAME, status: w.status, version: w.version };
    const steps = workflowSteps(w);
    if (
      steps.length &&
      (steps.length !== 1 ||
        steps[0].type !== "custom_webhook" ||
        JSON.stringify(steps[0].attributes) !== JSON.stringify(expected))
    )
      throw new Error("Draft has changed; refusing to overwrite");
    if (!steps.length)
      await api("PUT", `/workflow/${LOC}/${id}`, {
        version: w.version,
        name: NAME,
        status: "draft",
        allowMultiple: true,
        workflowData: {
          templates: [
            {
              id: crypto.randomUUID(),
              order: 0,
              name: "Reconcile verified webinar evidence",
              type: "custom_webhook",
              attributes: expected,
            },
          ],
        },
      });
    const desired = [
      {
        type: "form_submission",
        name: "Webinar form submitted",
        conditions: [
          {
            operator: "is-any-of",
            field: "form.id",
            value: ["5wC0SkFcgCfFzbpOUBWk"],
            title: "Form is",
            type: "string",
          },
        ],
      },
    ];
    for (const tag of [
      "webby-registered",
      "webby-attended",
      "webby-noshow",
      "webby-survey-done",
      "webby-booked",
    ])
      desired.push({
        type: "contact_tag",
        name: `Webinar hint: ${tag}`,
        conditions: [
          {
            operator: "index-of-true",
            field: "tagsAdded",
            value: tag,
            title: "Tag Added",
            type: "select",
            id: "tag-added",
          },
        ],
      });
    for (const calendar of [
      "cFeDl0FY8iaXll61lus8",
      "dsqmJ393Dwl9fDSbIVOI",
      "NDBNz6Og4yfpdpWmHrue",
      "jQqXS1YuFnmGZKLkrE62",
    ])
      desired.push({
        type: "appointment",
        name: `Confirmed sales booking: ${calendar}`,
        conditions: [
          {
            operator: "==",
            field: "appointment.eventType",
            value: "normal",
            title: "Event Type",
            type: "select",
          },
          {
            operator: "==",
            field: "appointment.status",
            value: "confirmed",
            title: "Appointment status is",
            type: "select",
          },
          {
            operator: "==",
            field: "calendar.id",
            value: calendar,
            title: "In calendar",
            type: "select",
          },
        ],
      });
    const existing = await api(
      "GET",
      `/workflow/${LOC}/trigger?workflowId=${id}`,
    );
    if (!Array.isArray(existing)) throw new Error("Trigger read incomplete");
    const signature = (t) =>
      JSON.stringify({ type: t.type, conditions: t.conditions });
    if (
      existing.some((t) => !desired.some((d) => signature(d) === signature(t)))
    )
      throw new Error("Unknown draft trigger; left unchanged");
    for (const t of desired) {
      if (existing.filter((x) => signature(x) === signature(t)).length > 1)
        throw new Error("Duplicate trigger");
      if (!existing.some((x) => signature(x) === signature(t)))
        await api("POST", `/workflow/${LOC}/trigger`, {
          ...t,
          active: true,
          workflowId: id,
          workflow_id: id,
          location_id: LOC,
          masterType: "highlevel",
          belongs_to: "workflow",
          schedule_config: {},
          actions: [{ workflow_id: id, type: "add_to_workflow" }],
        });
    }
    w = await api("GET", `/workflow/${LOC}/${id}`);
    const got = await api("GET", `/workflow/${LOC}/trigger?workflowId=${id}`);
    const saved = w.workflowData?.templates;
    if (
      w.status !== "draft" ||
      w.allowMultiple !== true ||
      saved?.length !== 1 ||
      saved[0].next ||
      saved[0].parentKey ||
      saved[0].parent ||
      JSON.stringify(saved[0].attributes) !== JSON.stringify(expected) ||
      !Array.isArray(got) ||
      got.length !== desired.length ||
      desired.some(
        (d) => got.filter((t) => signature(t) === signature(d)).length !== 1,
      )
    )
      throw new Error("Draft readback differs; do not publish");
    out.complete = true;
    out.result = "draft_verified";
    out.draft = {
      id,
      name: NAME,
      status: w.status,
      steps: 1,
      triggers: got.length,
    };
    out.remaining = [
      "Set private webby_pipeline_secret to the server's WEBINAR_PIPELINE_SIGNAL_SECRET",
      "Deploy and test the endpoint and worker",
      "Audit existing active triggers before contact writes",
      "Keep old WEBBY workflows draft until the new registration and personal-link delivery are connected",
      "Do not publish until isolated acceptance and launch approval",
    ];
    download();
    console.log(
      "Webinar pipeline bridge verified as DRAFT. No existing workflow changed or message sent.",
    );
  } catch (error) {
    out.error = safe(error.message);
    download();
    console.error(out.error);
  }
})();
