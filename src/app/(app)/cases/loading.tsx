const ROWS = [
  ["70%", "60%"],
  ["55%", "45%"],
  ["80%", "70%"],
  ["62%", "52%"],
  ["74%", "66%"],
  ["50%", "40%"],
];

export default function Loading() {
  return (
    <div className="flex flex-col gap-4 px-4 py-4 md:px-8 md:py-6">
      <h1 className="text-[22px] font-semibold">Cases</h1>
      <div className="overflow-hidden rounded-lg border border-line bg-surface" aria-busy="true">
        <div className="h-8 border-b border-line bg-subtle" />
        {ROWS.map(([a, b], i) => (
          <div key={i} className="grid h-12 grid-cols-[200px_140px_1fr_80px] items-center gap-4 border-b border-line-soft px-4">
            <div className="h-2.5 rounded-sm bg-line-soft" style={{ width: a }} />
            <div className="h-4 w-[110px] rounded bg-hover" />
            <div className="h-2.5 rounded-sm bg-line-soft" style={{ width: b }} />
            <div className="h-2.5 w-[60px] justify-self-end rounded-sm bg-line-soft" />
          </div>
        ))}
        <div role="status" className="px-4 py-2.5 text-xs text-muted">
          Loading cases…
        </div>
      </div>
    </div>
  );
}
