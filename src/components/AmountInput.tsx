"use client";

import { useEffect, useRef, type ComponentProps } from "react";

import { amountValue, formatAmountInput } from "@/lib/amount-input";

type AmountInputProps = Omit<
  ComponentProps<"input">,
  "name" | "value" | "defaultValue" | "onChange" | "type" | "ref"
> & {
  // Submitted without grouping commas through a hidden input, so server
  // actions keep receiving plain amounts such as "1250000.50".
  name?: string;
  value: string;
  onValueChange: (value: string) => void;
  // Shown by the browser on submit, like a native min or step mismatch.
  error?: string;
};

// A UGX amount field that adds grouping commas as the user types.
export function AmountInput({
  name,
  value,
  onValueChange,
  error = "",
  inputMode = "decimal",
  ...props
}: AmountInputProps) {
  const input = useRef<HTMLInputElement>(null);
  // Change events no longer know whether a selection was deleted, so note it
  // before each edit.
  const selectionBeforeInput = useRef(false);
  useEffect(() => {
    input.current?.setCustomValidity(error);
  }, [error]);
  useEffect(() => {
    const field = input.current;
    if (!field) return;
    const noteSelection = () => {
      selectionBeforeInput.current = field.selectionStart !== field.selectionEnd;
    };
    field.addEventListener("beforeinput", noteSelection);
    return () => field.removeEventListener("beforeinput", noteSelection);
  }, []);
  return (
    <>
      <input
        autoComplete="off"
        {...props}
        ref={input}
        type="text"
        inputMode={inputMode}
        value={value}
        onChange={(event) => {
          const field = event.currentTarget;
          const inputType = (event.nativeEvent as InputEvent).inputType;
          const edit = formatAmountInput(
            value,
            field.value,
            field.selectionStart ?? field.value.length,
            inputType,
            selectionBeforeInput.current,
          );
          selectionBeforeInput.current = false;
          field.value = edit.value;
          field.setSelectionRange(edit.caret, edit.caret);
          onValueChange(edit.value);
        }}
      />
      {name && <input type="hidden" name={name} value={amountValue(value)} />}
    </>
  );
}
