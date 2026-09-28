/** Shared Tailwind class sets, so pages stay consistent without repeating long class strings. */

type ButtonVariant = "primary" | "secondary" | "outline";
type ButtonSize = "sm" | "md";

const BUTTON_BASE =
  "rounded-md text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-violet-600 text-white hover:bg-violet-700",
  secondary:
    "border border-gray-300 text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800",
  outline:
    "border border-violet-300 text-violet-700 hover:bg-violet-50 dark:border-violet-700 dark:text-violet-300 dark:hover:bg-violet-900/20",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "px-4 py-2",
  md: "px-5 py-2.5",
};

export function buttonClass(variant: ButtonVariant, size: ButtonSize = "md"): string {
  return `${BUTTON_BASE} ${BUTTON_SIZES[size]} ${BUTTON_VARIANTS[variant]}`;
}

export const TEXT_INPUT_CLASS =
  "rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100";

export const SELECT_CLASS =
  "mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100";

export const FIELD_LABEL_CLASS = "flex flex-col gap-1.5 text-sm text-gray-600 dark:text-gray-400";

export const PAGE_CLASS = "max-w-2xl mx-auto mt-10 px-5";

export const PAGE_TITLE_CLASS = "text-2xl font-semibold text-gray-900 dark:text-gray-100";

export const MONO_VALUE_CLASS = "font-mono text-xs text-gray-700 dark:text-gray-300 break-all";

export const MUTED_TEXT_CLASS = "text-xs text-gray-500 dark:text-gray-400";

export const CODE_BLOCK_CLASS =
  "mt-1 overflow-auto rounded bg-gray-100 p-2 text-[11px] text-gray-700 dark:bg-gray-800 dark:text-gray-300";
