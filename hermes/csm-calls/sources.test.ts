import { expect, test } from "bun:test";
import { keepManual } from "./sources";

test("a manual match cannot reattach its recording to another client's appointment", () => {
  const update = keepManual(
    { task_id: "client-b", linked_call_id: 24, match_method: "appointment_time" },
    { task_id: "client-a", linked_call_id: null, match_method: "manual" },
  );
  expect(update.task_id).toBe("client-a");
  expect(update.linked_call_id).toBeNull();
  expect(update.match_method).toBe("manual");
});
