import WorkspaceShell from '../../src/frontend/components/WorkspaceShell';
import ExpenseTable from '../../src/frontend/components/ExpenseTable';

export default function WorkspaceExpensePage() {
  return (
    <WorkspaceShell section="expense">
      {({ selectedMonth, refreshTrigger, registerSave, markClean }) => (
        <ExpenseTable
          selectedMonth={selectedMonth}
          onRegisterSave={registerSave}
          onSaved={markClean}
          key={`expense-${refreshTrigger}`}
        />
      )}
    </WorkspaceShell>
  );
}
