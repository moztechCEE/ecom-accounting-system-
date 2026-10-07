import { useState } from "react";
import { Empty, Select } from "antd";
import type { Person } from "./model";
import {
  ALL_RECIPIENT_DEPARTMENTS,
  recipientDepartment,
  recipientDepartments,
  recipientOptions,
} from "./recipient-options";

type Props = {
  id?: string;
  value?: string;
  onChange?: (id: string | undefined) => void;
  people: Person[];
  label?: string;
  disabled?: boolean;
};

export default function RecipientPicker({
  id,
  value,
  onChange,
  people,
  label = "接收人",
  disabled = false,
}: Props) {
  const departments = recipientDepartments(people);
  const selected = people.find((person) => person.id === value);
  const selectedDepartment = selected && recipientDepartment(selected);
  const peopleKey = JSON.stringify(
    [...people]
      .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
      .map((person) => [
        person.id, recipientDepartment(person), person.name, person.employeeNo,
      ]),
  );
  const contextFor = (personId?: string) => JSON.stringify([personId, peopleKey]);
  const context = contextFor(value);
  const [selection, setSelection] = useState({
    context,
    value,
    department: selectedDepartment || ALL_RECIPIENT_DEPARTMENTS,
    query: "",
  });

  // Keep local filters in step with external Form resets and eligibility changes.
  // This never calls onChange: only a user's selection may change the Form value.
  if (selection.context !== context) {
    const department = value !== selection.value
      ? selectedDepartment || ALL_RECIPIENT_DEPARTMENTS
      : selectedDepartment &&
          selection.department !== ALL_RECIPIENT_DEPARTMENTS &&
          selectedDepartment !== selection.department
        ? selectedDepartment
        : departments.some((option) => option.value === selection.department)
          ? selection.department
          : ALL_RECIPIENT_DEPARTMENTS;
    setSelection({ context, value, department, query: "" });
  }

  const options = recipientOptions(people, selection.department, selection.query);
  const hintId = id ? `${id}-hint` : undefined;
  const unavailable = Boolean(value && !selected);

  function changeDepartment(department: string) {
    const nextValue = value &&
      department !== ALL_RECIPIENT_DEPARTMENTS &&
      (!selected || recipientDepartment(selected) !== department)
      ? undefined
      : value;
    setSelection({
      context: contextFor(nextValue),
      value: nextValue,
      department,
      query: "",
    });
    if (nextValue !== value) onChange?.(nextValue);
  }

  return (
    <div className="mailroom-recipient-picker">
      <div className="mailroom-recipient-controls">
        <Select
          className="mailroom-recipient-department"
          aria-label={`${label}部門`}
          disabled={disabled || people.length === 0}
          value={selection.department}
          options={departments}
          showSearch
          optionFilterProp="label"
          onChange={changeDepartment}
        />
        <Select
          id={id}
          className="mailroom-recipient-person"
          aria-label={label}
          aria-describedby={people.length === 0 || unavailable ? hintId : undefined}
          disabled={disabled || people.length === 0}
          placeholder="搜尋姓名或員工編號"
          value={value}
          status={unavailable ? "warning" : undefined}
          showSearch
          allowClear
          filterOption={false}
          searchValue={selection.query}
          options={options}
          labelRender={({ label: optionLabel }) =>
            unavailable ? "原指定同仁已不在可選名單" : optionLabel
          }
          onSearch={(query) => setSelection({ ...selection, query })}
          onChange={(personId: string | undefined) => {
            if (personId && !people.some((person) => person.id === personId)) return;
            setSelection({
              ...selection,
              context: contextFor(personId),
              value: personId,
              query: "",
            });
            onChange?.(personId);
          }}
          notFoundContent={
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={selection.query.trim()
                ? "沒有符合部門、姓名或員工編號的同仁"
                : "這個部門目前沒有可指派的同仁"}
            />
          }
        />
      </div>
      {people.length === 0 && (
        <div id={hintId} role="status" className="mailroom-recipient-empty">
          目前沒有可指派的{label}
        </div>
      )}
      {unavailable && people.length > 0 && (
        <div id={hintId} role="status" className="mailroom-recipient-empty">
          原接收人不在名單，請重新選擇。
        </div>
      )}
    </div>
  );
}
