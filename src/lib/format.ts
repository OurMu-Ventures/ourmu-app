export function ugx(value: number | string | bigint) {
  return `UGX ${Number(value).toLocaleString("en-UG")}`;
}
export function date(value: string) {
  return new Intl.DateTimeFormat("en-UG", { dateStyle: "medium" }).format(
    new Date(value),
  );
}
export function dateTime(value: string) {
  return new Intl.DateTimeFormat("en-UG", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
