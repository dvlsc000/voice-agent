export function PageHeader({ title, detail, actions }: { title: string; detail?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="max-w-[60ch]">
        <h1>{title}</h1>
        {detail ? <p className="mt-1 text-ink-soft">{detail}</p> : null}
      </div>
      {actions ? <div className="flex gap-2">{actions}</div> : null}
    </header>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="px-5 py-8">
      <p className="font-medium">{title}</p>
      {children ? <div className="mt-1 max-w-[60ch] text-ink-soft">{children}</div> : null}
    </div>
  );
}
