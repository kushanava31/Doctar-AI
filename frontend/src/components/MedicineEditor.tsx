"use client";

import type { MedicineItem } from "@/lib/api";

interface MedicineEditorProps {
  medicines: MedicineItem[];
  onChange: (medicines: MedicineItem[]) => void;
}

const emptyMedicine = (): MedicineItem => ({
  name: "",
  dosage: "",
  timing: "",
  duration: "",
  food_instructions: "",
});

export default function MedicineEditor({ medicines, onChange }: MedicineEditorProps) {
  const update = (index: number, field: keyof MedicineItem, value: string) => {
    const next = medicines.map((m, i) => (i === index ? { ...m, [field]: value } : m));
    onChange(next);
  };

  const addRow = () => onChange([...medicines, emptyMedicine()]);

  const removeRow = (index: number) => {
    onChange(medicines.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-4">
      {medicines.map((med, index) => (
        <div
          key={index}
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-semibold text-doctar-700">
              Medicine {index + 1}
            </span>
            <button
              type="button"
              onClick={() => removeRow(index)}
              className="text-sm text-red-600 hover:text-red-800"
            >
              Remove
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Medicine name"
              value={med.name}
              onChange={(v) => update(index, "name", v)}
            />
            <Field
              label="Dosage"
              value={med.dosage}
              onChange={(v) => update(index, "dosage", v)}
              placeholder="e.g. 500mg tablet"
            />
            <Field
              label="Timing (M-A-N)"
              value={med.timing}
              onChange={(v) => update(index, "timing", v)}
              placeholder="e.g. 1-0-1"
            />
            <Field
              label="Duration"
              value={med.duration}
              onChange={(v) => update(index, "duration", v)}
              placeholder="e.g. 5 days"
            />
            <Field
              label="Food instructions"
              value={med.food_instructions}
              onChange={(v) => update(index, "food_instructions", v)}
              placeholder="AC or PC"
              className="sm:col-span-2"
            />
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={addRow}
        className="w-full rounded-lg border border-dashed border-doctar-300 py-2 text-sm font-medium text-doctar-700 hover:bg-doctar-50"
      >
        + Add medicine
      </button>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-doctar-500 focus:outline-none focus:ring-1 focus:ring-doctar-500"
      />
    </label>
  );
}
