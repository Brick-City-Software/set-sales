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
  }
}
