import WorkspaceShell from '../../src/frontend/components/WorkspaceShell';
import DailyExpenseTable from '../../src/frontend/components/DailyExpenseTable';

export default function WorkspaceDailyPage() {
  return (
    <WorkspaceShell section="daily">
      {({ selectedMonth, refreshTrigger, registerSave, markClean }) => (
        <DailyExpenseTable
          selectedMonth={selectedMonth}
          onRegisterSave={registerSave}
          onSaved={markClean}
          key={`daily-${refreshTrigger}`}
        />
      )}
    </WorkspaceShell>
  );
}
