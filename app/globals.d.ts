declare module "*.css";

declare namespace JSX {
  interface IntrinsicElements {
    "s-empty-state": {
      heading?: string;
      image?: string;
      children?: React.ReactNode;
    };
  }
}
