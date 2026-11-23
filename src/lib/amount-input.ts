// Live formatting for typed UGX amounts: grouping commas while typing, with
// the caret kept beside the same digit. Input that is not a plain amount is
// returned unchanged so it can never silently become a different amount.

export type AmountEdit = { value: string; caret: number };

const SIGNIFICANT = /[\d.]/;
const GROUPED_AMOUNT = /^(?:\d*|\d{1,3}(?:,\d{3})+)(?:\.\d*)?$/;
const SPACE_GROUPED_AMOUNT = /^\d{1,3}(?:\s+\d{3})+(?:\.\d*)?$/;

function significant(text: string) {
  return [...text].filter((char) => SIGNIFICANT.test(char)).join("");
}

export function formatAmountInput(
  previous: string,
  entered: string,
  caret: number,
  inputType?: string,
): AmountEdit {
  // Pasted amounts often carry spaces or a currency prefix ("UGX 125 000").
  const supplied = entered.trim().replace(/^ugx\s*/i, "");
  const stripped = SPACE_GROUPED_AMOUNT.test(supplied)
    ? supplied.replace(/\s+/g, "")
    : supplied;
  // A normal edit can shift commas already placed by the formatter.
  const editingGroupedAmount =
    /^(?:insertText|deleteContentBackward|deleteContentForward)$/.test(inputType ?? "") &&
    GROUPED_AMOUNT.test(previous) &&
    (entered.match(/,/g)?.length ?? 0) <= (previous.match(/,/g)?.length ?? 0);
  if (!GROUPED_AMOUNT.test(stripped) && !editingGroupedAmount)
    return { value: entered, caret };
  if (!/^\d*(?:\.\d*)?$/.test(stripped.replaceAll(",", "")))
    return { value: entered, caret };

  let raw = significant(entered);
  let digitsBeforeCaret = significant(entered.slice(0, caret)).length;

  // Deleting a grouping comma alone would be undone by regrouping, so delete
  // the digit beside it instead, in the direction the key deletes.
  if (
    (inputType === "deleteContentBackward" || inputType === "deleteContentForward") &&
    entered.length < previous.length &&
    significant(previous) === raw
  ) {
    if (inputType === "deleteContentForward") {
      raw = raw.slice(0, digitsBeforeCaret) + raw.slice(digitsBeforeCaret + 1);
    } else if (digitsBeforeCaret > 0) {
      raw = raw.slice(0, digitsBeforeCaret - 1) + raw.slice(digitsBeforeCaret);
      digitsBeforeCaret -= 1;
    }
  }

  const [wholeEntered, fraction] = raw.split(".");
  let whole = wholeEntered;
  const withoutLeadingZeros = whole.replace(/^0+(?=\d)/, "");
  digitsBeforeCaret -= Math.min(
    digitsBeforeCaret,
    whole.length - withoutLeadingZeros.length,
  );
  whole = withoutLeadingZeros;
  if (whole === "" && fraction !== undefined) {
    whole = "0";
    digitsBeforeCaret += 1;
  }

  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const value = fraction === undefined ? grouped : `${grouped}.${fraction}`;
  let position = 0;
  for (
    let count = 0;
    position < value.length && count < digitsBeforeCaret;
    position++
  ) {
    if (value[position] !== ",") count++;
  }
  return { value, caret: position };
}

// Remove grouping only from whole amounts. Preserve invalid input for validation.
export function amountPrincipal(value: string) {
  return GROUPED_AMOUNT.test(value) && !value.includes(".")
    ? value.replaceAll(",", "")
    : value;
}

// Remove grouping from any well-formed amount, decimals included. Malformed
// input passes through unchanged so server validation still rejects it.
export function amountValue(value: string) {
  return GROUPED_AMOUNT.test(value) ? value.replaceAll(",", "") : value;
}

// Group a stored amount for display in an input, e.g. "1250000" -> "1,250,000".
export function groupAmount(value: string) {
  return formatAmountInput("", value, value.length).value;
}

// Mirror a server amount rule in the browser: up to `decimals` places and at
// least `min` (strictly above it when `aboveMin`). Empty input is left to
// `required`; anything else invalid gets the field's message.
export function amountRuleError(
  amount: string,
  rule: { decimals: number; min: number; aboveMin?: boolean },
  message: string,
) {
  if (!amount) return "";
  const pattern = new RegExp(`^\\d+(?:\\.\\d{1,${rule.decimals}})?$`);
  const value = Number(amount);
  const valid =
    pattern.test(amount) &&
    Number.isFinite(value) &&
    (rule.aboveMin ? value > rule.min : value >= rule.min);
  return valid ? "" : message;
}
