"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "cn";
import { Button } from "./button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "./dropdown-menu";

type ChoiceMenuProps<T extends string> = {
  label: string;
  options: readonly { value: T; label: string }[];
  id?: string;
  name?: string;
  disabled?: boolean;
  className?: string;
  title?: string;
  icon?: ReactNode;
} & (
  | { value: T; onValueChange: (value: T) => void; defaultValue?: never }
  | { defaultValue: T; value?: never; onValueChange?: never }
);

export function ChoiceMenu<T extends string>(props: ChoiceMenuProps<T>) {
  const { label, options, disabled, name } = props;
  const [localValue, setLocalValue] = useState(props.defaultValue);
  const value = props.value ?? localValue;
  const valueId = useId();
  const selected = options.find((option) => option.value === value);

  return <>
    {name && <input type="hidden" name={name} value={value} disabled={disabled} />}
    <DropdownMenu>
      <DropdownMenuTrigger id={props.id} aria-label={label} aria-describedby={valueId} title={props.title}
        disabled={disabled} render={<Button type="button" variant="outline" className={cn("max-w-full justify-between", props.className)} />}>
        {props.icon}<span className="truncate" id={valueId}>{selected?.label ?? value}</span><ChevronDown aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent aria-label={label} className="w-max max-w-(--available-width) min-w-(--anchor-width)">
        <DropdownMenuRadioGroup value={value} onValueChange={(next: T) => {
          if (props.onValueChange) props.onValueChange(next);
          else setLocalValue(next);
        }}>
          {options.map((option) => <DropdownMenuRadioItem key={option.value} value={option.value} closeOnClick>{option.label}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  </>;
}
