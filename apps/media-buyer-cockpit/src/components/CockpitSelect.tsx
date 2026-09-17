import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

/** Compact, keyboard-accessible picker; the caller retains all save behavior. */
export function CockpitSelect({
  value,
  options,
  onValueChange,
  label,
  disabled = false,
  placeholder = "Choose",
}: {
  value: string;
  options: { value: string; label: string }[];
  onValueChange: (value: string) => void;
  label: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger
        className="cockpit-select-trigger"
        aria-label={label}
        title={label}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent
        className="cockpit-select-menu"
        align="start"
        sideOffset={6}
      >
        {options
          .filter(option => option.value !== "")
          .map(option => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  );
}
