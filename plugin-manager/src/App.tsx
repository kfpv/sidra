export function App() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b border-border bg-surface px-6 py-5">
        <h1 className="text-xl font-semibold tracking-tight">Plugin Manager</h1>
      </header>
      <main
        aria-label="Plugin Manager content"
        className="min-h-0 flex-1 overflow-auto p-6"
      />
    </div>
  );
}
