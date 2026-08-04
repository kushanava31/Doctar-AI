"use client";

import { useCallback, useState } from "react";

const ACCEPT = "image/jpeg,image/png,image/jpg,application/pdf";

interface UploadZoneProps {
  onFileSelect: (file: File) => void;
  disabled?: boolean;
}

export default function UploadZone({ onFileSelect, disabled }: UploadZoneProps) {
  const [dragOver, setDragOver] = useState(false);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files?.length || disabled) return;
      const file = files[0];
      onFileSelect(file);
    },
    [onFileSelect, disabled]
  );

  return (
    <label
      className={`flex min-h-[220px] cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 transition ${
        dragOver
          ? "border-doctar-500 bg-doctar-50"
          : "border-slate-300 bg-white hover:border-doctar-400 hover:bg-doctar-50/50"
      } ${disabled ? "pointer-events-none opacity-50" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        handleFiles(e.dataTransfer.files);
      }}
    >
      <input
        type="file"
        accept={ACCEPT}
        className="hidden"
        disabled={disabled}
        onChange={(e) => handleFiles(e.target.files)}
      />
      <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-doctar-100 text-2xl">
        📋
      </div>
      <p className="text-center text-lg font-medium text-slate-800">
        Drop your prescription here
      </p>
      <p className="mt-1 text-center text-sm text-slate-500">
        or click to browse · JPG, PNG, PDF (max 10MB)
      </p>
    </label>
  );
}
