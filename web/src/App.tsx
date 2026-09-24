import { useQuery } from "@tanstack/react-query";
import { useHashRoute, type NavigateFn, type Tab } from "./hash";
import CompaniesPage from "./pages/CompaniesPage";
import PostingsPage from "./pages/PostingsPage";
import ContextPage from "./pages/ContextPage";

const TAB_ITEMS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: "postings", label: "Postings" },
  { id: "companies", label: "Companies" },
  { id: "context", label: "AI Context" },
];

function useApiHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: async (): Promise<boolean> => {
      const res = await fetch("/api/health");
      if (!res.ok) throw new Error("API returned an error response");
      const body = (await res.json()) as { ok?: unknown };
      if (body.ok !== true) throw new Error("API reported an unhealthy state");
      return true;
    },
    staleTime: 10_000,
    retry: 1,
  });
}

export default function App() {
  const [route, navigate] = useHashRoute();

  const health = useApiHealth();
  const healthLabel = health.isPending
    ? "API: checking…"
    : health.data === true
      ? "API: ok"
      : "API: unreachable";
  const healthClass =
    health.isPending ? "api-status" : health.data === true ? "api-status ok" : "api-status down";

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">Apples Tracker</h1>
        <nav className="tab-bar" aria-label="Sections">
          {TAB_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`tab-button${route.tab === item.id ? " active" : ""}`}
              aria-current={route.tab === item.id ? "page" : undefined}
              onClick={() => navigate(item.id, {}, { replace: true })}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <span className={healthClass} aria-live="polite">
          {healthLabel}
        </span>
      </header>

      <main className="app-main">
        {route.tab === "postings" && <PostingsPage params={route.params} navigate={navigate} />}
        {route.tab === "companies" && <CompaniesPage params={route.params} navigate={navigate} />}
        {route.tab === "context" && <ContextPage params={route.params} navigate={navigate} />}
      </main>
    </div>
  );
}
