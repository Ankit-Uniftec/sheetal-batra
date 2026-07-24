import React from "react";

// Catches render-time crashes anywhere in the route tree so a single broken
// screen shows a recoverable fallback instead of white-screening the whole app.
// Must stay self-contained (no app state/context) — it renders when the app is broken.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error("Unhandled render error:", error, info?.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "12px",
          fontFamily: "inherit",
          textAlign: "center",
          padding: "24px",
        }}
      >
        <h2 style={{ margin: 0 }}>Something went wrong</h2>
        <p style={{ margin: 0, color: "#666" }}>
          Please reload the page. If this keeps happening, contact the admin.
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{
            padding: "10px 24px",
            border: "none",
            borderRadius: "6px",
            background: "#d5b85a",
            color: "#fff",
            fontSize: "15px",
            cursor: "pointer",
          }}
        >
          Reload
        </button>
      </div>
    );
  }
}
