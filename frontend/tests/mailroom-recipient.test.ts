import assert from "node:assert/strict";
import test from "node:test";
import type { Person } from "../src/pages/mailroom/model.ts";
import {
  ALL_RECIPIENT_DEPARTMENTS,
  recipientDepartment,
  recipientDepartments,
  recipientOptions,
} from "../src/pages/mailroom/recipient-options.ts";

const person = (id: string, name: string, department: string, employeeNo: string): Person => ({
  id, name, department, employeeNo, repair: false, mailroom: false,
});
const people = [
  person("exact-repair-uuid", "同名同仁", "Repair", "R10"),
  person("exact-csr-uuid", "同名同仁", "客服", "C2"),
  person("missing-department-id", "未分類同仁", "  ", "N1"),
  person("other-repair-uuid", "同名同仁", "Repair", "R2"),
];

test("departments include all eligible departments and a visible missing-department label", () => {
  const options = recipientDepartments(people);
  assert.deepEqual(options[0], { value: ALL_RECIPIENT_DEPARTMENTS, label: "全部門" });
  assert.deepEqual(options.at(-1), { value: "department:", label: "未設定部門" });
  assert.equal(options.filter((option) => option.label === "Repair").length, 1);
  assert.deepEqual(recipientDepartments([]), [options[0]]);
});

test("sorting is stable, numeric employee numbers order naturally, and same names retain exact ids", () => {
  const sorted = recipientOptions(people);
  assert.deepEqual(recipientOptions([...people].reverse()), sorted);
  assert.equal(sorted.length, people.length);
  assert.deepEqual(
    sorted.filter((option) => option.label.startsWith("Repair")).map((option) => option.value),
    ["other-repair-uuid", "exact-repair-uuid"],
  );
  assert.deepEqual(new Set(sorted.map((option) => option.value)), new Set(people.map((item) => item.id)));
  assert(sorted.some((option) => option.label === "未設定部門 · 未分類同仁 · N1"));
});

test("department filtering returns only people ids and searches department, name and employee number", () => {
  const repair = recipientDepartment(people[0]);
  assert.deepEqual(recipientOptions(people, repair, "ｒ１０").map((option) => option.value), ["exact-repair-uuid"]);
  assert.deepEqual(recipientOptions(people, ALL_RECIPIENT_DEPARTMENTS, "客服 同名").map((option) => option.value), ["exact-csr-uuid"]);
  assert.deepEqual(recipientOptions(people, "department:", "未設定部門").map((option) => option.value), ["missing-department-id"]);
  assert.deepEqual(recipientOptions(people, repair, "C2"), []);
  assert.deepEqual(recipientOptions(people, "department:unknown"), []);
});

test("the caller's eligible list determines the scope without role expansion or list mutation", () => {
  const input = [people[1]];
  const before = structuredClone(input);
  assert.deepEqual(recipientOptions(input).map((option) => option.value), ["exact-csr-uuid"]);
  assert.deepEqual(input, before);
  assert.deepEqual(recipientOptions([]), []);
  const missingNumber = person("id-is-not-label", "同仁", "all", "");
  assert.equal(recipientDepartment(missingNumber), "department:all");
  assert.deepEqual(recipientOptions([missingNumber]), [{ value: "id-is-not-label", label: "all · 同仁" }]);
});
