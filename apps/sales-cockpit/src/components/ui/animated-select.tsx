import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import * as React from "react";

const EMPTY_VALUE = "__mahara_empty_option__";

type Option = {
  value: string;
  label: React.ReactNode;
  disabled: boolean;
  group?: string;
};

function optionText(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(optionText).join("");
  return "";
}

function readOptions(children: React.ReactNode, group?: string): Option[] {
  const options: Option[] = [];
  React.Children.forEach(children, child => {
    if (!React.isValidElement(child)) return;
    if (child.type === React.Fragment) {
      options.push(
        ...readOptions(
          (child.props as { children?: React.ReactNode }).children,
          group,
        ),
      );
    } else if (child.type === "optgroup") {
      const props =
        child.props as React.OptgroupHTMLAttributes<HTMLOptGroupElement>;
      options.push(...readOptions(props.children, props.label));
    } else if (child.type === "option") {
      const props =
        child.props as React.OptionHTMLAttributes<HTMLOptionElement>;
      options.push({
        value: String(props.value ?? optionText(props.children)),
        label: props.children,
        disabled: Boolean(props.disabled),
        group,
      });
    }
  });
  return options;
}

/** A drop-in visual replacement for the cockpit's single-value native selects. */
export function AnimatedSelect({
  children,
  className,
  value,
  defaultValue,
  onChange,
  disabled,
  multiple,
  id,
  name,
  required,
  title,
  "aria-label": ariaLabel,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const options = React.useMemo(() => readOptions(children), [children]);
  const [localValue, setLocalValue] = React.useState(
    String(defaultValue ?? ""),
  );
  const eventTarget = React.useRef<HTMLSelectElement>(null);

  // Native multi-selects have a different interaction contract and stay native.
  if (multiple) {
    return (
      <select
        {...rest}
        id={id}
        name={name}
        title={title}
        aria-label={ariaLabel}
        className={`cockpit-native-select ${className ?? ""}`}
        value={value}
        defaultValue={defaultValue}
        onChange={onChange}
        disabled={disabled}
        multiple
        required={required}
      >
        {children}
      </select>
    );
  }

  const firstValue = options.find(option => !option.disabled)?.value ?? "";
  const selectedValue =
    value !== undefined ? String(value) : localValue || firstValue;
  const radixValue = selectedValue === "" ? EMPTY_VALUE : selectedValue;

  function choose(next: string) {
    const nextValue = next === EMPTY_VALUE ? "" : next;
    if (value === undefined) setLocalValue(nextValue);
    if (eventTarget.current) {
      eventTarget.current.value = nextValue;
      const nativeEvent = new Event("change", { bubbles: true });
      const changeEvent = {
        target: eventTarget.current,
        currentTarget: eventTarget.current,
        nativeEvent,
        type: "change",
        bubbles: true,
        cancelable: true,
        defaultPrevented: false,
        eventPhase: 3,
        isTrusted: false,
        timeStamp: nativeEvent.timeStamp,
        preventDefault: () => nativeEvent.preventDefault(),
        stopPropagation: () => nativeEvent.stopPropagation(),
        isDefaultPrevented: () => nativeEvent.defaultPrevented,
        isPropagationStopped: () => false,
        persist: () => {},
      } as React.ChangeEvent<HTMLSelectElement>;
      onChange?.(changeEvent);
    }
  }

  const groups: { label?: string; items: Option[] }[] = [];
  for (const option of options) {
    if (groups.length === 0 || groups.at(-1)?.label !== option.group) {
      groups.push({ label: option.group, items: [] });
    }
    groups.at(-1)?.items.push(option);
  }

  function item(option: Option, index: number) {
    return (
      <Select.Item
        key={`${option.value}-${index}`}
        value={option.value === "" ? EMPTY_VALUE : option.value}
        disabled={option.disabled}
        className="cockpit-animated-select-item"
      >
        <Select.ItemText>{option.label}</Select.ItemText>
        <Select.ItemIndicator className="cockpit-animated-select-check">
          <Check aria-hidden="true" size={15} />
        </Select.ItemIndicator>
      </Select.Item>
    );
  }

  return (
    <>
      <Select.Root
        value={radixValue}
        onValueChange={choose}
        disabled={disabled}
      >
        <Select.Trigger
          id={id}
          title={title}
          aria-label={ariaLabel}
          aria-required={required}
          data-cockpit-select=""
          className={`cockpit-animated-select-trigger ${className ?? ""}`}
        >
          <Select.Value />
          <Select.Icon className="cockpit-animated-select-chevron">
            <ChevronDown aria-hidden="true" size={16} />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content
            className="cockpit-animated-select-content"
            position="popper"
            sideOffset={6}
            align="start"
          >
            <Select.Viewport className="cockpit-animated-select-viewport">
              {groups.map((group, groupIndex) =>
                group.label ? (
                  <Select.Group key={`${group.label}-${groupIndex}`}>
                    <Select.Label className="cockpit-animated-select-label">
                      {group.label}
                    </Select.Label>
                    {group.items.map(item)}
                  </Select.Group>
                ) : (
                  <React.Fragment key={`ungrouped-${groupIndex}`}>
                    {group.items.map(item)}
                  </React.Fragment>
                ),
              )}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
      <select
        ref={eventTarget}
        value={selectedValue}
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        onChange={() => {}}
      >
        {children}
      </select>
      {name && (
        <input
          type="hidden"
          name={name}
          value={selectedValue}
          disabled={disabled}
        />
      )}
    </>
  );
}
