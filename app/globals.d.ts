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
    "ui-save-bar": {
      id?: string;
      ref?: React.RefCallback<HTMLElement & { onSave?: () => void; onDiscard?: () => void }> | null;
      children?: React.ReactNode;
    };
    "s-table": {
      variant?: "list" | "table" | "auto";
      loading?: boolean;
      paginate?: boolean;
      hasPreviousPage?: boolean;
      hasNextPage?: boolean;
      children?: React.ReactNode;
    };
    "s-table-header-row": {
      children?: React.ReactNode;
    };
    "s-table-header": {
      format?: "base" | "currency" | "numeric";
      listSlot?: "primary" | "secondary" | "kicker" | "inline" | "labeled";
      children?: React.ReactNode;
    };
    "s-table-body": {
      children?: React.ReactNode;
    };
    "s-table-row": {
      clickDelegate?: string;
      children?: React.ReactNode;
    };
    "s-table-cell": {
      children?: React.ReactNode;
    };
    "s-text-field": {
      id?: string;
      label?: string;
      labelAccessibilityVisibility?: "visible" | "exclusive";
      placeholder?: string;
      value?: string;
      defaultValue?: string;
      type?: "text" | "email" | "number" | "password" | "search" | "tel" | "url";
      disabled?: boolean;
      error?: string;
      autoComplete?: string;
      maxLength?: number;
      prefix?: string;
      suffix?: string;
      icon?: string;
      clearButton?: boolean;
      onInput?: (event: Event) => void;
      onChange?: (event: Event) => void;
      onKeyDown?: (event: KeyboardEvent) => void;
      onKeyUp?: (event: KeyboardEvent) => void;
      onFocus?: (event: Event) => void;
      onBlur?: (event: Event) => void;
    };
  }
}
