declare module "*.css";

declare namespace JSX {
  interface IntrinsicElements {
    "s-empty-state": {
      heading?: string;
      image?: string;
      children?: React.ReactNode;
    };
    "s-skeleton-page": {
      children?: React.ReactNode;
    };
    "s-skeleton-display-text": {
      size?: "small" | "medium" | "large";
    };
    "s-skeleton-body-text": {
      lines?: number;
    };
    "s-checkbox": {
      id?: string;
      checked?: boolean;
      defaultChecked?: boolean;
      indeterminate?: boolean;
      label?: string;
      disabled?: boolean;
      error?: string;
      onChange?: (event: Event) => void;
      onInput?: (event: Event) => void;
    };
    "s-text": {
      variant?: "headingXs" | "headingSm" | "headingMd" | "headingLg" | "headingXl" | "heading2xl" | "heading3xl" | "bodySm" | "bodyMd" | "bodyLg";
      as?: string;
      alignment?: "start" | "center" | "end" | "justify";
      fontWeight?: "regular" | "medium" | "semibold" | "bold";
      tone?: "base" | "subdued" | "success" | "critical" | "caution" | "info" | "magic" | "text-inverse";
      children?: React.ReactNode;
    };
  }
}
