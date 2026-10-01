"use client";

export default function CasesError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="flex flex-col gap-4 px-4 py-4 md:px-8 md:py-6">
      <h1 className="text-[22px] font-semibold">Cases</h1>
      <div role="alert" className="flex items-start gap-3 rounded-lg border border-line bg-surface px-6 py-5">
        <span aria-hidden="true" className="text-base text-bad">
          ⚠︎
        </span>
        <div className="flex flex-1 flex-col gap-1.5">
          <span className="text-sm font-medium text-bad">Couldn’t load cases</span>
          <span className="text-[13px] text-ink-secondary">The server didn’t respond. Nothing has been changed.</span>
        </div>
        <button type="button" onClick={() => retry()} className="h-8 rounded border border-line-strong bg-surface px-3 text-[13px] font-medium hover:bg-hover">
          Try again
        </button>
      </div>
    </div>
  );
}
