import type { Person } from "./model";

export const ALL_RECIPIENT_DEPARTMENTS = "all";
export const MISSING_RECIPIENT_DEPARTMENT = "未設定部門";

const collator = new Intl.Collator("zh-Hant", {
  numeric: true,
  sensitivity: "base",
});

export function recipientDepartment(person: Person) {
  return `department:${person.department.trim()}`;
}

function departmentLabel(person: Person) {
  return person.department.trim() || MISSING_RECIPIENT_DEPARTMENT;
}

function searchable(text: string) {
  return text.normalize("NFKC").toLocaleLowerCase("zh-Hant").trim();
}

export function recipientDepartments(people: Person[]) {
  const departments = new Map(
    people.map((person) => [recipientDepartment(person), departmentLabel(person)]),
  );
  return [
    { value: ALL_RECIPIENT_DEPARTMENTS, label: "全部門" },
    ...[...departments].sort(([leftKey, left], [rightKey, right]) => {
      if (leftKey === "department:") return 1;
      if (rightKey === "department:") return -1;
      return collator.compare(left, right);
    }).map(([value, label]) => ({ value, label })),
  ];
}

export function recipientOptions(
  people: Person[],
  department = ALL_RECIPIENT_DEPARTMENTS,
  query = "",
) {
  const terms = searchable(query).split(/\s+/).filter(Boolean);
  return people
    .filter((person) =>
      department === ALL_RECIPIENT_DEPARTMENTS ||
      recipientDepartment(person) === department,
    )
    .filter((person) => {
      const haystack = searchable(
        `${departmentLabel(person)} ${person.name} ${person.employeeNo}`,
      );
      return terms.every((term) => haystack.includes(term));
    })
    .slice()
    .sort((left, right) =>
      collator.compare(departmentLabel(left), departmentLabel(right)) ||
      collator.compare(left.name, right.name) ||
      collator.compare(left.employeeNo, right.employeeNo) ||
      (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    )
    .map((person) => ({
      value: person.id,
      label: `${departmentLabel(person)} · ${person.name}${person.employeeNo ? ` · ${person.employeeNo}` : ""}`,
    }));
}
