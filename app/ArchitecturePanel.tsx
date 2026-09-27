export function ArchitecturePanel() {
  return (
    <section className="architectureOuter" aria-labelledby="architecture-title">
      <div className="architectureCard">
        <div className="architectureIntro">
          <span className="eyebrow">Safety architecture</span>
          <h2 id="architecture-title">Prediction is not the final trust boundary.</h2>
          <p>
            Foresee measures a candidate state transition, scopes human authority to that exact simulation,
            then independently verifies reality before commit.
          </p>
        </div>
        <div className="architectureFlow" aria-label="Foresee architecture flow">
          <div><span>01</span><strong>Intent</strong><small>Constrained DSL</small></div>
          <i>→</i>
          <div><span>02</span><strong>Simulate</strong><small>Real DB transaction → rollback</small></div>
          <i>→</i>
          <div><span>03</span><strong>Policy</strong><small>Risk + human decision</small></div>
          <i>→</i>
          <div><span>04</span><strong>Execute</strong><small>Fingerprint + rollback journal</small></div>
          <i>→</i>
          <div><span>05</span><strong>Verify</strong><small>Match → commit · Diverge → rollback</small></div>
        </div>
        <div className="architecturePrinciples">
          <span><b>Simulation predicts.</b> PostgreSQL is the world model.</span>
          <span><b>Policy decides.</b> Approval binds to one immutable simulation.</span>
          <span><b>Runtime verifies.</b> Divergence is blocked before commit.</span>
          <span><b>Rollback protects.</b> Recovery data is journaled before destruction.</span>
        </div>
      </div>
    </section>
  );
}
