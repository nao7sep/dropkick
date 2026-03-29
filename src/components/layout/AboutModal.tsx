// About dialog — shows app name, version, author, and license.

import { useEffect, useRef } from "react";
import { X, ExternalLink } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";

interface AboutModalProps {
  onClose: () => void;
}

export function AboutModal({ onClose }: AboutModalProps) {
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === backdropRef.current) onClose();
  };

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
    >
      <div className="w-full max-w-xs rounded-lg bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-800">
            About Dropkick
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 text-center">
          <p className="text-2xl font-bold text-gray-800">Dropkick</p>
          <p className="mt-1 text-sm text-gray-500">Version 0.1.0</p>
          <p className="mt-4 text-sm text-gray-600">
            A local-first task manager.
          </p>
          <div className="mt-4 flex justify-center gap-4">
            <button
              onClick={() =>
                openUrl("https://github.com/nao7sep/dropkick").catch(() => {})
              }
              className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 hover:underline"
            >
              GitHub
              <ExternalLink size={12} />
            </button>
            <button
              onClick={() =>
                openUrl("https://github.com/nao7sep/dropkick/issues").catch(
                  () => {},
                )
              }
              className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 hover:underline"
            >
              Report Issue
              <ExternalLink size={12} />
            </button>
          </div>
          <p className="mt-4 text-xs text-gray-400">
            &copy; 2026 Yoshinao Inoguchi
          </p>
          <p className="mt-1 text-xs text-gray-400">MIT License</p>
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-gray-200 px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-md border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
