/**
 * The `missing[]` disclosure.
 *
 * Every generation/variant data file lists what could NOT be verified — a
 * figure Porsche never published, a source conflict, an unconfirmed model.
 * That list is a feature, not a bug report, so it is rendered verbatim in a
 * `<details>` block: honest, collapsible, and searchable in the HTML. When the
 * list is empty the component renders nothing at all.
 */

export function DataNotes({
  notes,
  heading,
  accent,
  level = 3,
}: {
  notes: readonly string[] | undefined;
  heading: string;
  accent: string;
  level?: 2 | 3;
}) {
  if (!notes || notes.length === 0) return null;
  const Heading = level === 2 ? "h2" : "h3";

  return (
    <section className="px-[--gutter] pb-[--space-16]">
      <div className="mx-auto w-full max-w-[--maxw]">
        <details className="group border border-ink-4 bg-ink-2">
          <summary className="flex cursor-pointer list-none items-center gap-[--space-3] px-[--space-4] py-[--space-3] font-mono text-mono-xs uppercase tracking-[--tracking-mono] text-metal-300 transition-colors hover:text-metal-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards">
            <span
              aria-hidden="true"
              className="inline-block h-px w-6"
              style={{ backgroundColor: accent }}
            />
            <Heading className="font-mono text-mono-xs uppercase tracking-[--tracking-mono]">
              {heading} ({notes.length})
            </Heading>
            <span
              aria-hidden="true"
              className="ml-auto text-metal-500 transition-transform duration-[--dur-base] group-open:rotate-45"
            >
              +
            </span>
          </summary>
          <ul className="flex flex-col gap-[--space-2] border-t border-ink-4 px-[--space-4] py-[--space-4]">
            {notes.map((note, index) => (
              <li
                key={`${index}-${note.slice(0, 12)}`}
                className="font-mono text-mono-xs leading-relaxed tracking-[--tracking-mono] text-metal-500"
              >
                <span aria-hidden="true" className="mr-[--space-2] text-metal-700">
                  {String(index + 1).padStart(2, "0")}
                </span>
                {note}
              </li>
            ))}
          </ul>
        </details>
      </div>
    </section>
  );
}