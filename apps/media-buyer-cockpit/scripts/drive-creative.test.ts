import { describe, expect, test } from "bun:test";
import {
  accessHint,
  driveId,
  isDriveLink,
  percent,
  reusable,
  waitingLabel,
} from "../convex/driveCreative";

describe("drive links", () => {
  test("ids come out of every link shape", () => {
    expect(
      driveId(
        "https://drive.google.com/file/d/1MtTZjwH7j56tZhfnB6wmKybWflQvDI7x/view?usp=drive_link",
      ),
    ).toBe("1MtTZjwH7j56tZhfnB6wmKybWflQvDI7x");
    expect(
      driveId(
        "https://drive.google.com/drive/folders/1QTXmav93kNIgp93ba_Cc8qfsE1ojN4E2?usp=sharing",
      ),
    ).toBe("1QTXmav93kNIgp93ba_Cc8qfsE1ojN4E2");
    expect(
      driveId(
        "https://drive.google.com/open?id=1QTXmav93kNIgp93ba_Cc8qfsE1ojN4E2",
      ),
    ).toBe("1QTXmav93kNIgp93ba_Cc8qfsE1ojN4E2");
    expect(driveId("1QTXmav93kNIgp93ba_Cc8qfsE1ojN4E2")).toBe(
      "1QTXmav93kNIgp93ba_Cc8qfsE1ojN4E2",
    );
    expect(driveId("https://example.com/video.mp4")).toBeUndefined();
    expect(isDriveLink("https://drive.google.com/file/d/x/view")).toBe(true);
    expect(isDriveLink("https://cdn.example.com/a.mp4")).toBe(false);
  });

  test("progress and the words around it", () => {
    expect(percent(undefined)).toBeUndefined();
    expect(
      percent({
        sessionId: "s",
        videoId: "v",
        start: 33_800_500,
        end: 34_000_000,
        size: 67_600_875,
      }),
    ).toBe(50);
    expect(
      percent({ sessionId: "s", videoId: "v", start: 0, end: 1, size: 0 }),
    ).toBeUndefined();
    expect(accessHint(404, "claude@x.iam.gserviceaccount.com")).toContain(
      "share it with claude@x.iam.gserviceaccount.com",
    );
    expect(accessHint(500, "")).toContain("HTTP 500");
    const t0 = 1_000_000;
    expect(waitingLabel([], t0, t0 + 95_000)).toContain("1 min 35s");
    expect(
      waitingLabel(
        [{ name: "Castello.mp4", link: "l", percent: 42 }],
        t0,
        t0 + 5_000,
      ),
    ).toBe("Castello.mp4: loading into the ad account, 42% · 5s");
  });

  test("a file already in the account is reused, a failed one is not", () => {
    const rows = [
      {
        media: [
          {
            name: "a.mp4",
            link: "https://drive.google.com/file/d/1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/view",
            videoId: "111",
          },
        ],
      },
      {
        media: [
          {
            name: "b.mp4",
            link: "https://drive.google.com/file/d/1BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB/view",
            error: "nope",
          },
        ],
      },
    ];
    expect(
      reusable(
        rows,
        "https://drive.google.com/file/d/1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/view?usp=drive_link",
      )?.videoId,
    ).toBe("111");
    expect(
      reusable(
        rows,
        "https://drive.google.com/file/d/1BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB/view",
      ),
    ).toBeUndefined();
    expect(
      reusable(
        rows,
        "https://drive.google.com/file/d/1CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC/view",
      ),
    ).toBeUndefined();
  });
});
