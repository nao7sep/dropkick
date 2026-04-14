// About dialog — shows app name, version, author, and license.

import { ExternalLink } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { AppModal } from "../shared/AppModal";

interface AboutModalProps {
  onClose: () => void;
}

export function AboutModal({ onClose }: AboutModalProps) {
  return (
    <AppModal
      title="About Dropkick"
      onClose={onClose}
      maxWidth={320}
      bodyClassName="px-6 py-5 text-center"
      footerClassName="flex justify-end border-t border-gray-200 px-6 py-4"
      footer={
          <button
            onClick={onClose}
            className="rounded-md border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            Close
          </button>
      }
    >
      <p className="text-2xl font-bold text-gray-800">Dropkick</p>
      <p className="mt-1 text-sm text-gray-500">Version 0.1.0</p>
      <p className="mt-4 text-sm text-gray-600">
        A local-first task manager for working with plain JSON task lists
        across multiple files. Your data stays on your machine.
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
    </AppModal>
  );
}
