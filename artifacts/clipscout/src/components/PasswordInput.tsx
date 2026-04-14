import React, { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  description?: string;
  required?: boolean;
  showCharCount?: boolean;
  id?: string;
}

export function PasswordInput({
  value,
  onChange,
  placeholder,
  label,
  description,
  required,
  showCharCount,
  id,
}: Props) {
  const [show, setShow] = useState(false);

  return (
    <div>
      <label
        htmlFor={id}
        className="block text-sm font-medium text-gray-300 mb-2"
      >
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>
      <div className="relative">
        <input
          id={id}
          type="text"
          inputMode="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          style={{ WebkitTextSecurity: show ? "none" : "disc" } as React.CSSProperties}
          className="w-full bg-[#1a1a1a] border border-gray-700 rounded-xl px-4 py-3 pr-12 text-white placeholder-gray-500 focus:outline-none focus:border-[#22c55e] text-base"
        />
        <button
          type="button"
          onClick={() => setShow(!show)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors p-1"
          tabIndex={-1}
        >
          {show ? <EyeOff size={20} /> : <Eye size={20} />}
        </button>
      </div>
      {showCharCount && (
        <p className="mt-1 text-xs text-gray-500">{value.length} characters</p>
      )}
      {description && (
        <p className="mt-1 text-xs text-gray-500">{description}</p>
      )}
    </div>
  );
}
