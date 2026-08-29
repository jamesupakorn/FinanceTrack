import WorkspaceShell from '../../../src/frontend/components/WorkspaceShell';
import SavingsGoalTracker from '../../../src/frontend/components/SavingsGoalTracker';

export default function WorkspaceSavingsGoalsPage() {
  return (
    <WorkspaceShell section="goals">
      {({ selectedMonth, refreshTrigger, registerSave, markClean }) => (
        <SavingsGoalTracker
          key={selectedMonth}
          refreshTrigger={refreshTrigger}
          selectedMonth={selectedMonth}
          onRegisterSave={registerSave}
          onSaved={markClean}
        />
      )}
    </WorkspaceShell>
  );
}
