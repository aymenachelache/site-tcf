import "./dashboard.css";
import { CandidateDashboardShell } from "@/components/candidate-dashboard-shell";

export default function DashboardLoading() {
  return (
    <CandidateDashboardShell>
      <div aria-label="Chargement du tableau de bord" aria-busy="true" className="candidate-dashboard">
        <main className="candidate-dashboard-inner">
          <div className="candidate-dashboard-skeleton" />
          <div className="candidate-summary-grid">
            {[1, 2, 3, 4].map((item) => <div className="candidate-dashboard-skeleton" key={item} />)}
          </div>
          <div className="candidate-dashboard-skeleton" />
        </main>
      </div>
    </CandidateDashboardShell>
  );
}
