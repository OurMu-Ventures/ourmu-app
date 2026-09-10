export default function RootLoading() {
  return (
    <main id="main" aria-busy="true" aria-label="Loading">
      <div className="route-progress" aria-hidden="true">
        <div className="route-progress-bar" />
      </div>
      <div className="container" aria-hidden="true">
        <div className="skeleton skeleton-heading" />
        <div className="skeleton skeleton-line" />
        <div className="grid">
          <div className="card skeleton-card" />
          <div className="card skeleton-card" />
          <div className="card skeleton-card" />
        </div>
      </div>
      <p className="visually-hidden" role="status">
        Loading, please wait.
      </p>
    </main>
  );
}
