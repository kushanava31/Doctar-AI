"use client";

type Step = "upload" | "processing" | "review" | "done";

const STEPS: { id: Step; label: string }[] = [
  { id: "upload", label: "Upload" },
  { id: "processing", label: "Extract" },
  { id: "review", label: "Review" },
  { id: "done", label: "PDF" },
];

export default function StepIndicator({ current }: { current: Step }) {
  const currentIndex = STEPS.findIndex((s) => s.id === current);

  return (
    <nav className="mb-8 flex justify-center gap-2 sm:gap-4">
      {STEPS.map((step, i) => {
        const active = i === currentIndex;
        const done = i < currentIndex;
        return (
          <div key={step.id} className="flex items-center gap-2">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
                done
                  ? "bg-doctar-600 text-white"
                  : active
                    ? "bg-doctar-500 text-white ring-4 ring-doctar-100"
                    : "bg-slate-200 text-slate-500"
              }`}
            >
              {done ? "✓" : i + 1}
            </div>
            <span
              className={`hidden text-sm sm:inline ${
                active ? "font-semibold text-doctar-800" : "text-slate-500"
              }`}
            >
              {step.label}
            </span>
            {i < STEPS.length - 1 && (
              <div
                className={`mx-1 hidden h-0.5 w-6 sm:block md:w-12 ${
                  done ? "bg-doctar-400" : "bg-slate-200"
                }`}
              />
            )}
          </div>
        );
      })}
    </nav>
  );
}
