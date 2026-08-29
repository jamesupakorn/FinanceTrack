import WorkspaceShell from '../../../src/frontend/components/WorkspaceShell';
import InvestmentTable from '../../../src/frontend/components/InvestmentTable';

export default function WorkspaceSavingsInvestmentPage() {
  return (
    <WorkspaceShell section="investment">
      {({ selectedMonth, refreshTrigger, registerSave, markClean }) => (
        <InvestmentTable
          selectedMonth={selectedMonth}
          onRegisterSave={registerSave}
          onSaved={markClean}
          key={`investment-${refreshTrigger}`}
        />
      )}
    </WorkspaceShell>
  );
}
