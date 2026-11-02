import Form from "next/form";

// GET search with client-side navigation: results render on the target
// page, so reload, back and shared links all keep the search.
export function PartnerSearchForm({
  id,
  action,
  name,
  label,
  defaultValue,
  keep = {},
}: {
  id: string;
  action: string;
  name: string;
  label: string;
  defaultValue: string;
  // Other filters on the target page that a new search should keep.
  keep?: Record<string, string>;
}) {
  return (
    <Form action={action} role="search" className="partner-search">
      {Object.entries(keep)
        .filter(([, value]) => value)
        .map(([key, value]) => (
          <input key={key} type="hidden" name={key} value={value} />
        ))}
      <label htmlFor={id}>{label}</label>
      <input
        // Remount when the URL changes so Clear and back reset the field.
        key={defaultValue}
        id={id}
        name={name}
        type="search"
        defaultValue={defaultValue}
        placeholder="Name or email"
        autoComplete="off"
        maxLength={80}
      />
      <button className="button" type="submit">
        Search
      </button>
    </Form>
  );
}
